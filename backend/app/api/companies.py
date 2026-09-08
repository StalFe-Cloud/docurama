import uuid
import re
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.security import create_access_token
from app.api.auth import get_current_user
from app.models import User, Account, AccountMembership, DomainVerification
from app.schemas import (
    CompanyCreate, CompanyOut, CompanyUpdate, CompanyMemberOut, CompanySwitchResponse
)

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
        if m.account:
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
    db: AsyncSession = Depends(get_db)
):
    clean_name = company_in.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Company name cannot be blank.")

    subdomain = company_in.subdomain or f"{slugify(clean_name)}-{uuid.uuid4().hex[:6]}"

    # Create new account
    new_account = Account(
        name=clean_name,
        subdomain=subdomain,
        timezone=company_in.timezone or "(GMT+00:00) UTC",
        enforce_domain_auth=False
    )
    db.add(new_account)
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
            cname_target="docurama.example.com",
            web_confirmation_url=f"https://{clean_domain}/.well-known/docurama-verification"
        )
        db.add(domain_rec)

    await db.commit()
    await db.refresh(new_account)

    # Refresh session cookie with new account_id
    token = create_access_token(
        subject=current_user.id,
        claims={"role": current_user.role, "email": current_user.email, "account_id": new_account.id}
    )
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return await format_company_out(new_account, current_user.id, new_account.id, db, user_role="owner")

@router.post("/{company_id}/switch", response_model=CompanySwitchResponse)
async def switch_company(
    company_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
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
        claims={"role": current_user.role, "email": current_user.email, "account_id": company_id}
    )
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
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
    query = select(AccountMembership).where(
        AccountMembership.user_id == current_user.id,
        AccountMembership.account_id == company_id,
        AccountMembership.is_active == True
    ).options(selectinload(AccountMembership.account))
    res = await db.execute(query)
    membership = res.scalar_one_or_none()
    if not membership or not membership.account or membership.role not in ["owner", "admin"]:
        raise HTTPException(status_code=403, detail="Only company owners and administrators can modify settings.")

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
