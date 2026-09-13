import asyncio
import uuid
import re
import logging
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, generate_secure_token
from app.api.auth import get_current_user, require_interactive_session
from app.api.quotas import require_paid_write
from app.services.tenancy import subdomain_available, subdomain_error
from app.services import mailer, smtp_config
from app.services import password_reset as password_reset_service
from app.services.quotas import check_seat_quota
from app.models import (
    User, Account, AccountMembership, DomainVerification,
    Template, TemplateFolder, Envelope, Webhook, ApiKey, AccountSetting,
    PasswordResetToken,
)
from app.schemas import (
    CompanyCreate, CompanyOut, CompanyUpdate, CompanyMemberOut, CompanySwitchResponse,
    CompanyInviteRequest, CompanyInviteResponse,
    WorkspaceDeleteRequest, WorkspaceDeleteResult
)

logger = logging.getLogger("docurama.companies")

router = APIRouter(prefix="/companies", tags=["companies"])

def utcnow():
    return datetime.now(timezone.utc)

def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r'[^a-z0-9\-]', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')[:40]

async def ensure_membership_exists(user: User, db: AsyncSession):
    """Ensure user has at least one AccountMembership for backward compatibility."""
    if not user.account_id:
        return
    query = select(AccountMembership).where(
        AccountMembership.user_id == user.id,
        AccountMembership.account_id == user.account_id
    )
    res = await db.execute(query)
    m = res.scalar_one_or_none()
    if not m:
        m = AccountMembership(
            user_id=user.id,
            account_id=user.account_id,
            role="owner" if user.role == "admin" else "member",
            is_active=True
        )
        db.add(m)
        await db.commit()

async def format_company_out(account: Account, user_id: str, active_account_id: str, db: AsyncSession, user_role: str = "member") -> CompanyOut:
    # Get members count
    cnt_query = select(func.count()).select_from(AccountMembership).where(
        AccountMembership.account_id == account.id,
        AccountMembership.is_active == True
    )
    cnt_res = await db.execute(cnt_query)
    member_count = cnt_res.scalar() or 1

    # Get verified domain if any
    dom_query = select(DomainVerification).where(
        DomainVerification.account_id == account.id
    ).order_by(DomainVerification.created_at.desc())
    dom_res = await db.execute(dom_query)
    domain_rec = dom_res.scalars().first()

    return CompanyOut(
        id=account.id,
        name=account.name,
        subdomain=account.subdomain,
        timezone=getattr(account, "timezone", "(GMT+00:00) UTC"),
        enforce_domain_auth=bool(getattr(account, "enforce_domain_auth", False)),
        is_active_company=(account.id == active_account_id),
        role=user_role,
        members_count=member_count,
        verified_domain=domain_rec.domain if domain_rec else None,
        domain_verification_status=domain_rec.status if domain_rec else "unverified",
        created_at=account.created_at
    )

VALID_MEMBER_ROLES = ["owner", "admin", "manager", "member"]

async def require_company_admin(company_id: str, current_user: User, db: AsyncSession) -> AccountMembership:
    """Resolve the caller's membership and assert owner/admin privileges on the company."""
    query = select(AccountMembership).where(
        AccountMembership.user_id == current_user.id,
        AccountMembership.account_id == company_id,
        AccountMembership.is_active == True
    ).options(selectinload(AccountMembership.account))
    membership = (await db.execute(query)).scalar_one_or_none()
    if not membership or not membership.account:
        raise HTTPException(status_code=403, detail="Access denied to this company.")
    if membership.role not in ["owner", "admin"]:
        raise HTTPException(
            status_code=403,
            detail="Only company owners and administrators can manage members."
        )
    return membership

@router.get("", response_model=List[CompanyOut])
async def list_user_companies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await ensure_membership_exists(current_user, db)

    # Fetch all memberships for this user
    query = (
        select(AccountMembership)
        .where(
            AccountMembership.user_id == current_user.id,
            AccountMembership.is_active == True
        )
        .options(selectinload(AccountMembership.account))
    )
    res = await db.execute(query)
    memberships = res.scalars().all()

    companies: List[CompanyOut] = []
    for m in memberships:
        # A deleted workspace keeps its row so completed envelopes still resolve at the
        # verification portal, but it must not appear as somewhere you can work.
        if m.account and getattr(m.account, "deleted_at", None) is None:
            comp_out = await format_company_out(
                m.account, current_user.id, current_user.account_id, db, user_role=m.role
            )
            companies.append(comp_out)

    return companies

@router.post("", response_model=CompanyOut)
async def create_company(
    company_in: CompanyCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db)
):
    clean_name = company_in.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Company name cannot be blank.")

    if company_in.subdomain:
        subdomain = company_in.subdomain.strip().lower()
        problem = subdomain_error(subdomain)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if not await subdomain_available(db, subdomain):
            raise HTTPException(
                status_code=409,
                detail=f"The subdomain '{subdomain}' is already taken.",
            )
    else:
        slug = slugify(clean_name)
        subdomain = f"{slug}-{uuid.uuid4().hex[:6]}"
        if subdomain_error(subdomain):
            subdomain = f"company-{uuid.uuid4().hex[:10]}"

    # Create new account
    new_account = Account(
        name=clean_name,
        subdomain=subdomain,
        timezone=company_in.timezone or "(GMT+00:00) UTC",
        enforce_domain_auth=False
    )
    db.add(new_account)

    try:
        await db.flush()

        # Create membership as owner
        membership = AccountMembership(
            user_id=current_user.id,
            account_id=new_account.id,
            role="owner",
            is_active=True
        )
        db.add(membership)

        # Set as active account for current user
        current_user.account_id = new_account.id

        # If domain provided, register DomainVerification
        if company_in.domain:
            clean_domain = company_in.domain.strip().lower()
            token = f"dcr_vfy_{uuid.uuid4().hex[:16]}"
            domain_rec = DomainVerification(
                account_id=new_account.id,
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
    except IntegrityError:
        # The availability pre-check passed, but another request claimed the
        # subdomain first: the unique constraint decided the race instead.
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="That subdomain was just claimed by another workspace. Pick another.",
        )
    await db.refresh(new_account)

    # Refresh session cookie with new account_id
    token = create_access_token(
        subject=current_user.id,
        claims={"purpose": "session", "role": current_user.role, "email": current_user.email, "account_id": new_account.id, "ver": current_user.token_version or 0}
    )
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return await format_company_out(new_account, current_user.id, new_account.id, db, user_role="owner")

@router.post("/{company_id}/switch", response_model=CompanySwitchResponse)
async def switch_company(
    company_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db)
):
    # Verify membership
    query = (
        select(AccountMembership)
        .where(
            AccountMembership.user_id == current_user.id,
            AccountMembership.account_id == company_id,
            AccountMembership.is_active == True
        )
        .options(selectinload(AccountMembership.account))
    )
    res = await db.execute(query)
    membership = res.scalar_one_or_none()
    if not membership or not membership.account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have active access to this company."
        )

    # Update active company
    current_user.account_id = company_id
    await db.commit()
    await db.refresh(current_user)

    # Create new JWT
    token = create_access_token(
        subject=current_user.id,
        claims={"purpose": "session", "role": current_user.role, "email": current_user.email, "account_id": company_id, "ver": current_user.token_version or 0}
    )
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    comp_out = await format_company_out(
        membership.account, current_user.id, company_id, db, user_role=membership.role
    )

    return CompanySwitchResponse(
        success=True,
        active_company_id=company_id,
        company=comp_out,
        access_token=token,
        user={
            "id": current_user.id,
            "email": current_user.email,
            "first_name": current_user.first_name,
            "last_name": current_user.last_name,
            "role": current_user.role,
            "account_id": company_id,
            "account_name": membership.account.name
        }
    )

@router.get("/{company_id}", response_model=CompanyOut)
async def get_company_details(
    company_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(AccountMembership).where(
        AccountMembership.user_id == current_user.id,
        AccountMembership.account_id == company_id,
        AccountMembership.is_active == True
    ).options(selectinload(AccountMembership.account))
    res = await db.execute(query)
    membership = res.scalar_one_or_none()
    if not membership or not membership.account:
        raise HTTPException(status_code=403, detail="Access denied to this company.")

    return await format_company_out(
        membership.account, current_user.id, current_user.account_id, db, user_role=membership.role
    )

@router.put("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: str,
    company_in: CompanyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    membership = await require_company_admin(company_id, current_user, db)

    account = membership.account
    if company_in.name is not None and company_in.name.strip():
        account.name = company_in.name.strip()
    if company_in.timezone is not None:
        account.timezone = company_in.timezone
    if company_in.enforce_domain_auth is not None:
        account.enforce_domain_auth = company_in.enforce_domain_auth

    await db.commit()
    await db.refresh(account)

    return await format_company_out(
        account, current_user.id, current_user.account_id, db, user_role=membership.role
    )

@router.get("/{company_id}/members", response_model=List[CompanyMemberOut])
async def list_company_members(
    company_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify current user is a member
    mem_check = select(AccountMembership).where(
        AccountMembership.user_id == current_user.id,
        AccountMembership.account_id == company_id,
        AccountMembership.is_active == True
    )
    if not (await db.execute(mem_check)).scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Access denied.")

    query = (
        select(AccountMembership)
        .where(AccountMembership.account_id == company_id)
        .options(selectinload(AccountMembership.user))
        .order_by(AccountMembership.created_at.asc())
    )
    res = await db.execute(query)
    memberships = res.scalars().all()

    out = []
    for m in memberships:
        u = m.user
        out.append(CompanyMemberOut(
            id=m.id,
            user_id=m.user_id,
            email=u.email if u else "unknown@user",
            name=f"{u.first_name} {u.last_name}".strip() if u else "Member",
            role=m.role,
            is_active=m.is_active,
            created_at=m.created_at
        ))
    return out

@router.post("/{company_id}/members", response_model=CompanyInviteResponse, status_code=status.HTTP_201_CREATED)
async def invite_company_member(
    company_id: str,
    invite_in: CompanyInviteRequest,
    current_user: User = Depends(require_paid_write),
    db: AsyncSession = Depends(get_db)
):
    """
    Invite a user to the company. Creates the user account when the email is unknown,
    then grants an active membership with the requested role. The invitee sets their
    own password from an emailed single-use link; no temporary password is issued.
    """
    caller = await require_company_admin(company_id, current_user, db)

    role = (invite_in.role or "member").strip().lower()
    if role not in VALID_MEMBER_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Must be one of: {', '.join(VALID_MEMBER_ROLES)}."
        )
    if role == "owner" and caller.role != "owner":
        raise HTTPException(status_code=403, detail="Only a company owner can grant the owner role.")

    email = invite_in.email.strip().lower()

    # Enforce team seat limit
    account = caller.account
    if account:
        allowed, used, limit = await check_seat_quota(account, db)
        if not allowed:
            cloud_domain = settings.CLOUD_DOMAIN
            raise HTTPException(
                status_code=402,
                detail=f"Team seat limit reached ({used}/{limit}). Please upgrade your plan at https://{cloud_domain} to add more members.",
            )

    # Enforce domain authentication policy when the company requires it
    if getattr(account, "enforce_domain_auth", False):
        invitee_domain = email.split("@")[1] if "@" in email else ""
        dom_q = select(DomainVerification).where(
            DomainVerification.account_id == company_id,
            DomainVerification.domain == invitee_domain,
            DomainVerification.status == "verified"
        )
        if not (await db.execute(dom_q)).scalars().first():
            raise HTTPException(
                status_code=403,
                detail=(
                    f"This company enforces DNS domain authentication. "
                    f"The address @{invitee_domain} is not covered by a verified corporate domain."
                )
            )

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    is_new_user = False
    if not user:
        is_new_user = True
        # The invitee sets their own password from the emailed link. The seeded
        # hash is of a long random value nobody is ever told, so the account is
        # unusable until the link is redeemed.
        seeded = generate_secure_token(32)
        user = User(
            account_id=company_id,
            email=email,
            hashed_password=get_password_hash(seeded),
            first_name=invite_in.first_name or "",
            last_name=invite_in.last_name or "",
            role="admin" if role in ["owner", "admin"] else "member",
            is_active=True,
        )
        db.add(user)
        await db.flush()

    # A single-use set-password link is staged for every invitee. For a new user it
    # is the only way into the account; for an existing user it is an ordinary
    # self-service reset delivered to their own address, so rejoining the company
    # never depends on remembering an old password. Only the hash is stored.
    plaintext_token, hashed_token = password_reset_service.generate_token()
    db.add(PasswordResetToken(
        user_id=user.id,
        hashed_token=hashed_token,
        expires_at=password_reset_service.expiry_from_now(),
    ))

    existing = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == user.id,
            AccountMembership.account_id == company_id
        )
    )).scalar_one_or_none()

    if existing and existing.is_active:
        raise HTTPException(status_code=409, detail="This user is already a member of the company.")

    if existing:
        # Reactivate a previously archived membership
        existing.is_active = True
        existing.role = role
        membership = existing
    else:
        membership = AccountMembership(
            user_id=user.id,
            account_id=company_id,
            role=role,
            is_active=True
        )
        db.add(membership)

    await db.commit()
    await db.refresh(membership)

    invite_link = password_reset_service.reset_url(settings.APP_URL, plaintext_token)
    config = await smtp_config.resolve(db, company_id)
    sender_name = f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email
    subject, html, text = mailer.team_invite(
        invite_in.first_name or email, account.name, invite_link,
        sender_name, membership.role,
    )
    result = await asyncio.to_thread(
        mailer.send_email, config, email, invite_in.first_name or email,
        subject, html, text,
    )
    # Only a send the mail server accepted counts as delivered. A missing or
    # malformed result counts as not delivered, so the admin is always left with
    # a way to pass the link on rather than a silently stranded invitee.
    invite_link_delivered = bool(getattr(result, "sent", False))
    if not invite_link_delivered:
        logger.warning("invite mail not delivered to %s: %s", email, getattr(result, "error", None))

    return CompanyInviteResponse(
        success=True,
        membership_id=membership.id,
        user_id=user.id,
        email=user.email,
        role=membership.role,
        is_new_user=is_new_user,
        temporary_password=None,
        invite_link_delivered=invite_link_delivered if is_new_user else True,
        fallback_invite_link=(invite_link if is_new_user and not invite_link_delivered else None),
        message=(
            f"Created account for {user.email} and emailed them a set-password link."
            if is_new_user else
            f"Granted {user.email} {membership.role} access to this company."
        )
    )

@router.delete("/{company_id}/members/{user_id}", status_code=status.HTTP_200_OK)
async def remove_company_member(
    company_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Archive a member's access to the company. Membership rows are deactivated rather than
    deleted so that historical audit trails remain resolvable.
    """
    await require_company_admin(company_id, current_user, db)

    target = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == user_id,
            AccountMembership.account_id == company_id
        ).options(selectinload(AccountMembership.user))
    )).scalar_one_or_none()

    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail="Active membership not found for this company.")

    if target.role == "owner":
        owner_count = (await db.execute(
            select(func.count()).select_from(AccountMembership).where(
                AccountMembership.account_id == company_id,
                AccountMembership.role == "owner",
                AccountMembership.is_active == True
            )
        )).scalar() or 0
        if owner_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove the last remaining owner. Transfer ownership first."
            )

    target.is_active = False

    # If this was the removed user's active company, move them to another membership
    removed_user = target.user
    if removed_user and removed_user.account_id == company_id:
        fallback = (await db.execute(
            select(AccountMembership).where(
                AccountMembership.user_id == user_id,
                AccountMembership.account_id != company_id,
                AccountMembership.is_active == True
            ).order_by(AccountMembership.created_at.asc())
        )).scalars().first()
        removed_user.account_id = fallback.account_id if fallback else None

    await db.commit()

    return {
        "success": True,
        "user_id": user_id,
        "company_id": company_id,
        "message": f"Removed {removed_user.email if removed_user else user_id} from this company."
    }


@router.delete("/{company_id}", response_model=WorkspaceDeleteResult)
async def delete_company(
    company_id: str,
    payload: WorkspaceDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Remove a workspace while keeping the evidence it produced.

    Templates, folders, drafts, webhooks, API keys, settings and memberships go. Every
    completed envelope stays, with its hashes, its audit trail and its sealed file.

    That asymmetry is deliberate. A verification code printed on a certificate of
    completion has been handed to counterparties who had no part in this decision, and
    the platform's whole claim is that such a code keeps resolving. Deleting a
    workspace must not silently invalidate someone else's evidence.

    The account row survives for the same reason: envelopes reference it, and the
    portal reports issuer domain attestation from it. It is marked deleted and
    detached instead.
    """
    membership = await require_company_admin(company_id, current_user, db)
    if membership.role != "owner":
        raise HTTPException(
            status_code=403,
            detail="Only a company owner can delete the workspace.",
        )

    account = membership.account
    if getattr(account, "deleted_at", None) is not None:
        raise HTTPException(status_code=400, detail="This workspace has already been deleted.")

    # Typing the name is the confirmation. A checkbox is too easy to click through for
    # something with no undo.
    if (payload.confirm_name or "").strip() != (account.name or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Type the workspace name exactly to confirm deletion.",
        )

    completed_statuses = ("completed", "signed")
    retained = (await db.execute(
        select(func.count()).select_from(Envelope).where(
            Envelope.account_id == company_id,
            Envelope.status.in_(completed_statuses),
        )
    )).scalar() or 0

    # Drafts and in-flight envelopes carry no evidentiary weight: nobody has been
    # given a verification code for a document that was never completed.
    unfinished = (await db.execute(
        select(Envelope).where(
            Envelope.account_id == company_id,
            Envelope.status.notin_(completed_statuses),
        )
    )).scalars().all()
    for envelope in unfinished:
        await db.delete(envelope)

    templates = (await db.execute(
        select(Template).where(Template.account_id == company_id)
    )).scalars().all()
    templates_removed = len(templates)
    for template in templates:
        await db.delete(template)

    for model in (TemplateFolder, Webhook, ApiKey, AccountSetting, DomainVerification):
        rows = (await db.execute(
            select(model).where(model.account_id == company_id)
        )).scalars().all()
        for row in rows:
            await db.delete(row)

    # Detach every member, moving each to another workspace they belong to so that
    # deleting one does not strand someone with no active account.
    memberships = (await db.execute(
        select(AccountMembership)
        .where(AccountMembership.account_id == company_id)
        .options(selectinload(AccountMembership.user))
    )).scalars().all()

    for member in memberships:
        user = member.user
        member.is_active = False
        if user and user.account_id == company_id:
            fallback = (await db.execute(
                select(AccountMembership).where(
                    AccountMembership.user_id == user.id,
                    AccountMembership.account_id != company_id,
                    AccountMembership.is_active == True  # noqa: E712 - SQL expression
                ).order_by(AccountMembership.created_at.asc())
            )).scalars().first()
            user.account_id = fallback.account_id if fallback else None

    account.deleted_at = utcnow()
    await db.commit()

    return WorkspaceDeleteResult(
        success=True,
        templates_removed=templates_removed,
        envelopes_retained=retained,
        message=(
            f"Workspace deleted. {retained} completed document(s) were kept so their "
            "verification codes continue to resolve."
        ),
    )
