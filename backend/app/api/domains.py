import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models import User, DomainVerification, Account, AccountMembership
from app.schemas import (
    DomainCreate, DomainOut, DomainVerifyResponse, DomainPublicStatus,
    DomainAuthValidateRequest, DomainAuthValidateResponse,
    CloudflareTokenRequest,
)
from app.services.domain_verifier import verify_client_domain, summarize_checks
from app.services.dns_provider import detect_provider

router = APIRouter(prefix="/domains", tags=["domains"])

def utcnow():
    return datetime.now(timezone.utc)

def sanitize_domain(d: str) -> str:
    cleaned = d.strip().lower()
    cleaned = cleaned.replace("https://", "").replace("http://", "")
    cleaned = cleaned.split("/")[0].split(":")[0]
    return cleaned

@router.get("", response_model=List[DomainOut])
async def list_domains(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(DomainVerification).where(
        DomainVerification.account_id == current_user.account_id
    ).order_by(DomainVerification.created_at.desc())
    
    result = await db.execute(query)
    domains = result.scalars().all()
    
    # If no domain exists and user email is from a corporate domain (e.g. example.com), auto-provision domain
    if not domains and current_user.email and "@" in current_user.email:
        user_domain = sanitize_domain(current_user.email.split("@")[1])
        if user_domain not in ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]:
            token = f"dcr_vfy_{uuid.uuid4().hex[:16]}"
            new_domain = DomainVerification(
                account_id=current_user.account_id,
                domain=user_domain,
                status="pending",
                verification_token=token,
                verification_method="dns_subdomain_pointer",
                txt_record_host=f"_docurama-challenge.{user_domain}",
                txt_record_value=f"docurama-verification={token}",
                cname_record_host=f"docurama.{user_domain}",
                cname_target=settings.CNAME_TARGET,
                web_confirmation_url=f"https://{user_domain}/.well-known/docurama-verification"
            )
            # Check if immediately verifiable
            is_v, method, details, msg = await verify_client_domain(user_domain, token)
            if is_v:
                new_domain.status = "verified"
                new_domain.verification_method = method
                new_domain.verified_at = utcnow()
            new_domain.last_checked_at = utcnow()
            new_domain.dns_check_details = details
            
            db.add(new_domain)
            await db.commit()
            await db.refresh(new_domain)
            return [new_domain]

    return domains

@router.post("", response_model=DomainOut)
async def create_domain(
    domain_in: DomainCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    clean_domain = sanitize_domain(domain_in.domain)
    if not clean_domain or "." not in clean_domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid corporate domain (e.g. example.com)"
        )

    # Check if domain already registered
    query = select(DomainVerification).where(
        DomainVerification.domain == clean_domain
    )
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        if existing.account_id == current_user.account_id:
            return existing
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Domain {clean_domain} is already registered by another organization."
        )

    token = f"dcr_vfy_{uuid.uuid4().hex[:16]}"
    domain_rec = DomainVerification(
        account_id=current_user.account_id,
        domain=clean_domain,
        status="pending",
        verification_token=token,
        verification_method="dns_txt",
        txt_record_host=f"_docurama-challenge.{clean_domain}",
        txt_record_value=f"docurama-verification={token}",
        cname_record_host=f"docurama.{clean_domain}",
        cname_target=settings.CNAME_TARGET,
        web_confirmation_url=f"https://{clean_domain}/.well-known/docurama-verification"
    )

    db.add(domain_rec)
    await db.commit()
    await db.refresh(domain_rec)
    return domain_rec

@router.post("/{domain_id}/verify", response_model=DomainVerifyResponse)
async def verify_domain(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(DomainVerification).where(
        DomainVerification.id == domain_id,
        DomainVerification.account_id == current_user.account_id
    )
    domain_rec = (await db.execute(query)).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain verification record not found"
        )

    is_verified, method, details, message = await verify_client_domain(
        domain_rec.domain,
        domain_rec.verification_token
    )

    domain_rec.last_checked_at = utcnow()
    domain_rec.dns_check_details = details

    if is_verified:
        domain_rec.status = "verified"
        domain_rec.verification_method = method
        if not domain_rec.verified_at:
            domain_rec.verified_at = utcnow()
    else:
        domain_rec.status = "pending"

    await db.commit()
    await db.refresh(domain_rec)

    return DomainVerifyResponse(
        success=is_verified,
        domain=domain_rec.domain,
        status=domain_rec.status,
        message=message,
        method_matched=domain_rec.verification_method if is_verified else None,
        dns_details=details,
        verified_at=domain_rec.verified_at,
        checks=summarize_checks(
            domain_rec.domain,
            domain_rec.verification_token,
            details,
            method
        )
    )

@router.delete("/{domain_id}")
async def delete_domain(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(DomainVerification).where(
        DomainVerification.id == domain_id,
        DomainVerification.account_id == current_user.account_id
    )
    domain_rec = (await db.execute(query)).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain record not found"
        )

    await db.delete(domain_rec)
    await db.commit()
    return {"success": True, "message": f"Domain {domain_rec.domain} removed."}

@router.post("/{domain_id}/toggle-enforcement")
async def toggle_domain_enforcement(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(DomainVerification).where(
        DomainVerification.id == domain_id,
        DomainVerification.account_id == current_user.account_id
    )
    domain_rec = (await db.execute(query)).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    membership = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == current_user.id,
            AccountMembership.account_id == current_user.account_id,
            AccountMembership.is_active == True,
        )
    )).scalar_one_or_none()
    if not membership or membership.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners and admins can change domain authentication enforcement.",
        )

    act_query = select(Account).where(Account.id == current_user.account_id)
    account = (await db.execute(act_query)).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")

    account.enforce_domain_auth = not bool(getattr(account, "enforce_domain_auth", False))
    await db.commit()
    await db.refresh(account)

    return {
        "success": True,
        "domain": domain_rec.domain,
        "enforce_domain_auth": account.enforce_domain_auth,
        "message": f"Enterprise domain authentication requirement is now {'enforced' if account.enforce_domain_auth else 'optional'} for {domain_rec.domain}."
    }

@router.get("/{domain_id}/setup")
async def domain_setup_guidance(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    guidance = await detect_provider(domain_rec.domain)
    return {
        "domain": domain_rec.domain,
        "provider": guidance["provider"],
        "nameservers": guidance["nameservers"],
        "steps": guidance["steps"],
        "records": [
            {"type": "TXT",
             "host": domain_rec.txt_record_host,
             "value": domain_rec.txt_record_value},
        ],
        "web_confirmation_url": domain_rec.web_confirmation_url,
    }

@router.post("/{domain_id}/it-email")
async def domain_it_email_draft(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A ready-to-send draft for the customer's IT team. The server never sends it."""
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    account = (await db.execute(
        select(Account).where(Account.id == current_user.account_id)
    )).scalar_one_or_none()
    org = account.name if account else "our organization"

    subject = f"Action needed: add one DNS record to verify {domain_rec.domain} for Docurama"
    body = (
        "Hi team,\n\n"
        f"To use {domain_rec.domain} with Docurama ({org}), our DNS needs one TXT record "
        "so Docurama can verify that we control the domain.\n\n"
        "Please add this DNS record:\n"
        f"  Type:  TXT\n"
        f"  Host:  {domain_rec.txt_record_host}\n"
        f"  Value: {domain_rec.txt_record_value}\n\n"
        "Leave the TTL at its default. If our DNS is managed by another team or provider, "
        "please forward this to them.\n\n"
        "Once the record is saved, verification is done from Docurama under "
        "Settings, Domains (press Verify). New DNS records can take from a few minutes "
        "to an hour to become visible.\n\n"
        "Thanks!"
    )
    return {"subject": subject, "body": body}


@router.post("/{domain_id}/cloudflare")
async def create_cloudflare_challenge(
    domain_id: str,
    payload: CloudflareTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.api.companies import require_company_admin
    from app.services.cloudflare_dns import create_challenge_record

    await require_company_admin(current_user.account_id, current_user, db)
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    result = await create_challenge_record(
        payload.api_token, domain_rec.domain,
        domain_rec.txt_record_host, domain_rec.txt_record_value,
    )
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {
        "success": True,
        "record_id": result["record_id"],
        "message": (f"TXT record created at {domain_rec.txt_record_host}. "
                    "Cloudflare changes usually appear within a minute or two; "
                    "press Verify."),
    }


@router.post("/validate-authentication", response_model=DomainAuthValidateResponse)
async def validate_domain_authentication(
    req: DomainAuthValidateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Validate an additional authentication tier using cryptographic DNS domain verification.
    Verifies that the email domain has an active, verified DNS challenge record.
    """
    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Invalid email format.")

    email_domain = sanitize_domain(req.email.split("@")[1])
    query = (
        select(DomainVerification)
        .where(
            DomainVerification.domain == email_domain,
            DomainVerification.status == "verified"
        )
        .options(selectinload(DomainVerification.account))
    )
    rec = (await db.execute(query)).scalar_one_or_none()

    if rec:
        org_name = rec.account.name if rec.account else "Verified Enterprise"
        return DomainAuthValidateResponse(
            is_authenticated=True,
            domain=email_domain,
            assurance_level="enterprise_domain_verified",
            txt_record_host=rec.txt_record_host,
            verified_at=rec.verified_at,
            organization_name=org_name,
            message=f"Cryptographic domain authentication confirmed for @{email_domain}. Verified via DNS challenge record ({rec.txt_record_host}) resolving through DNS-over-HTTPS."
        )

    return DomainAuthValidateResponse(
        is_authenticated=False,
        domain=email_domain,
        assurance_level="standard",
        txt_record_host=f"_docurama-challenge.{email_domain}",
        verified_at=None,
        organization_name=None,
        message=f"Domain @{email_domain} does not have an active verified DNS challenge record. Default standard identity assurance applies."
    )

@router.get("/status/{domain}", response_model=DomainPublicStatus)
async def get_public_domain_status(
    domain: str,
    db: AsyncSession = Depends(get_db)
):
    clean = sanitize_domain(domain)
    query = (
        select(DomainVerification)
        .where(DomainVerification.domain == clean)
        .options(selectinload(DomainVerification.account))
    )
    rec = (await db.execute(query)).scalar_one_or_none()
    
    if not rec:
        return DomainPublicStatus(domain=clean, is_verified=False)

    return DomainPublicStatus(domain=rec.domain, is_verified=(rec.status == "verified"))


# ---------------------------------------------------------------------------
# Enterprise domain activation (§18) — join modes and the approval queue.
# Only a VERIFIED domain may carry a join mode: an unverified domain record is
# a claim about ownership, and enabling auto-join on an unproven claim would
# let anyone sign up as that organisation.
# ---------------------------------------------------------------------------

VALID_JOIN_MODES = ("none", "auto_join", "approval")


async def _require_workspace_admin(current_user: User, db: AsyncSession) -> AccountMembership:
    membership = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == current_user.id,
            AccountMembership.account_id == current_user.account_id,
            AccountMembership.is_active == True,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not membership or membership.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace owners and admins can manage domain join settings.",
        )
    return membership


@router.post("/{domain_id}/join-mode")
async def set_join_mode(
    domain_id: str,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Set how signups with an email on this verified domain join the workspace:
    'none' (default, registration untouched), 'auto_join' (membership at
    activation) or 'approval' (workspace admin approves each join).
    """
    await _require_workspace_admin(current_user, db)
    mode = str((payload or {}).get("mode", "")).strip()
    if mode not in VALID_JOIN_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"mode must be one of: {', '.join(VALID_JOIN_MODES)}.",
        )

    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")
    if domain_rec.status != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Domain join modes can only be enabled on a verified domain.",
        )

    domain_rec.join_mode = mode
    await db.commit()
    return {
        "success": True,
        "domain": domain_rec.domain,
        "join_mode": mode,
        "message": {
            "none": f"Signups with @{domain_rec.domain} addresses create their own workspaces.",
            "auto_join": f"New @{domain_rec.domain} signups join this workspace after confirming their email.",
            "approval": f"New @{domain_rec.domain} signups join after an admin approves them.",
        }[mode],
    }


@router.get("/joins/pending")
async def pending_domain_joins(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The workspace's activation queue: confirmed users awaiting approval."""
    await _require_workspace_admin(current_user, db)
    from app.models import DomainJoinRequest

    joins = (await db.execute(
        select(DomainJoinRequest)
        .where(
            DomainJoinRequest.account_id == current_user.account_id,
            DomainJoinRequest.status == "pending",
        )
        .order_by(DomainJoinRequest.created_at.asc())
        .limit(200)
    )).scalars().all()
    return [
        {
            "id": j.id,
            "user_id": j.user_id,
            "user_email": j.user_email,
            "domain_id": j.domain_id,
            "status": j.status,
            "created_at": j.created_at.isoformat() if j.created_at else None,
        }
        for j in joins
    ]


@router.post("/joins/{join_id}/approve")
async def approve_domain_join(
    join_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant membership to an approved requester; the decision is on the record."""
    await _require_workspace_admin(current_user, db)
    from app.models import DomainJoinRequest

    join_req = (await db.execute(
        select(DomainJoinRequest).where(
            DomainJoinRequest.id == join_id,
            DomainJoinRequest.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not join_req:
        raise HTTPException(status_code=404, detail="Join request not found.")
    if join_req.status != "pending":
        raise HTTPException(status_code=400, detail="This request has already been decided.")

    join_req.status = "approved"
    join_req.decided_by = current_user.email
    join_req.decided_at = utcnow()

    existing_membership = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == join_req.user_id,
            AccountMembership.account_id == join_req.account_id,
        )
    )).scalar_one_or_none()
    if existing_membership is None:
        db.add(AccountMembership(
            user_id=join_req.user_id,
            account_id=join_req.account_id,
            role="member",
            is_active=True,
        ))
    else:
        existing_membership.is_active = True

    await db.commit()
    return {"success": True, "join_id": join_req.id, "status": join_req.status}
