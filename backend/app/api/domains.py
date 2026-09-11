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
    DomainAuthValidateRequest, DomainAuthValidateResponse
)
from app.services.domain_verifier import verify_client_domain

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
        verified_at=domain_rec.verified_at
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
