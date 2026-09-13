"""
Platform administration API (Sprint 3, §8 admin console v1).

Every route is platform-admin gated. Impersonation is deliberately absent: an
operator entering a tenant's workspace without an audit trail of their own is
a bigger compliance risk than slow support, so the console answers questions
with data rather than by borrowing identities.

Tenant inventory is aggregated in SQL, not in Python loops, so the console
does not become the N+1 engine that slows production down as tenancy grows.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.auth import get_current_user
from app.api.legal import _require_platform_admin
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import get_password_hash, create_access_token
from app.models import Account, AccountMembership, User, Envelope, LegalNotice

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/tenants")
async def tenant_inventory(
    q: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Workspace inventory with member and envelope counts, name-searchable."""
    await _require_platform_admin(current_user)

    name_filter = f"%{q.strip().lower()}%"
    member_counts = (
        select(
            AccountMembership.account_id,
            func.count(AccountMembership.id).label("members"),
        )
        .where(AccountMembership.is_active == True)  # noqa: E712
        .group_by(AccountMembership.account_id)
        .subquery()
    )
    envelope_counts = (
        select(Envelope.account_id, func.count(Envelope.id).label("envelopes"))
        .group_by(Envelope.account_id)
        .subquery()
    )

    query = (
        select(
            Account,
            func.coalesce(member_counts.c.members, 0),
            func.coalesce(envelope_counts.c.envelopes, 0),
        )
        .outerjoin(member_counts, member_counts.c.account_id == Account.id)
        .outerjoin(envelope_counts, envelope_counts.c.account_id == Account.id)
        .order_by(Account.created_at.desc())
        .limit(200)
    )
    if q.strip():
        query = query.where(func.lower(Account.name).like(name_filter))

    rows = (await db.execute(query)).all()
    return [
        {
            "id": account.id,
            "name": account.name,
            "plan": account.plan,
            "is_trial": bool(getattr(account, "is_trial", False)),
            "created_at": account.created_at.isoformat() if account.created_at else None,
            "member_count": int(members or 0),
            "envelope_count": int(envelopes or 0),
        }
        for account, members, envelopes in rows
    ]


@router.get("/tenants/{account_id}")
async def tenant_detail(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One workspace with its member roster."""
    await _require_platform_admin(current_user)
    account = (await db.execute(
        select(Account).where(Account.id == account_id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    members = (await db.execute(
        select(User, AccountMembership)
        .join(AccountMembership, AccountMembership.user_id == User.id)
        .where(AccountMembership.account_id == account_id)
        .order_by(AccountMembership.created_at.asc())
        .limit(500)
    )).all()

    return {
        "id": account.id,
        "name": account.name,
        "plan": account.plan,
        "is_trial": bool(getattr(account, "is_trial", False)),
        "billing_interval": getattr(account, "billing_interval", None),
        "created_at": account.created_at.isoformat() if account.created_at else None,
        "members": [
            {
                "user_id": user.id,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "membership_role": membership.role,
                "membership_active": bool(membership.is_active),
                "user_active": bool(getattr(user, "is_active", True)),
            }
            for user, membership in members
        ],
    }


@router.get("/dsr/dmca")
async def legal_queue(
    ticket_status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alias of the legal notice queue under the admin console surface."""
    await _require_platform_admin(current_user)
    from app.api.legal import list_notices as _list

    return await _list(
        ticket_status=ticket_status, current_user=current_user, db=db
    )


@router.post("/dsr/dmca/{notice_id}/resolve")
async def resolve_legal_queue_item(
    notice_id: str,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resolve a notice from the admin console queue."""
    await _require_platform_admin(current_user)
    from app.api.legal import NoticeResolution, resolve_notice as _resolve

    try:
        body = NoticeResolution(
            resolution=str(payload.get("resolution", "")),
            new_status=str(payload.get("new_status", "resolved")),
        )
    except Exception:
        raise HTTPException(status_code=422, detail="resolution (min 4 chars) is required.")
    return await _resolve(
        notice_id=notice_id, payload=body, current_user=current_user, db=db
    )


class AdminSetupInput(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    email: EmailStr
    password: str
    organization_name: Optional[str] = None


@router.get("/setup/status")
async def get_admin_setup_status(db: AsyncSession = Depends(get_db)):
    """Check whether initial platform administrator setup is required."""
    admin_count = (await db.execute(
        select(func.count(User.id)).where(User.is_platform_admin == True, User.is_active == True)  # noqa: E712
    )).scalar() or 0
    return {
        "needs_setup": admin_count == 0,
        "admin_count": admin_count,
        "deployment_mode": settings.DEPLOYMENT_MODE,
        "platform_domain": settings.CLOUD_DOMAIN or "docurama",
    }


@router.post("/setup")
@limiter.limit("5/minute")
async def setup_platform_admin(
    request: Request,
    payload: AdminSetupInput,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Initial platform administrator setup.
    Only permitted when no active platform administrator exists in the system.
    """
    admin_count = (await db.execute(
        select(func.count(User.id)).where(User.is_platform_admin == True, User.is_active == True)  # noqa: E712
    )).scalar() or 0

    if admin_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial platform administrator has already been configured for this deployment.",
        )

    password = payload.password or ""
    if len(password) < 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator password must be at least 12 characters long.",
        )

    clean_email = str(payload.email).strip().lower()
    first_name = payload.first_name.strip()
    if not first_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="First name is required.",
        )

    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"

    existing = (await db.execute(select(User).where(User.email == clean_email))).scalar_one_or_none()
    if existing:
        existing.is_platform_admin = True
        existing.is_active = True
        existing.role = "admin"
        existing.hashed_password = get_password_hash(password)
        user = existing
        account = (await db.execute(select(Account).where(Account.id == user.account_id))).scalar_one_or_none()
        if not account:
            account = Account(
                name=payload.organization_name or f"{first_name}'s Administration",
                plan="unlimited" if not is_cloud else "enterprise",
                is_trial=False,
            )
            db.add(account)
            await db.flush()
            user.account_id = account.id
    else:
        account = Account(
            name=payload.organization_name or f"{first_name}'s Administration",
            plan="unlimited" if not is_cloud else "enterprise",
            is_trial=False,
        )
        db.add(account)
        await db.flush()

        user = User(
            account_id=account.id,
            email=clean_email,
            hashed_password=get_password_hash(password),
            first_name=first_name,
            last_name=(payload.last_name or "").strip(),
            role="admin",
            is_platform_admin=True,
            is_active=True,
        )
        db.add(user)
        await db.flush()

        membership = AccountMembership(
            user_id=user.id,
            account_id=account.id,
            role="owner",
            is_active=True,
        )
        db.add(membership)

    await db.commit()
    await db.refresh(user)

    try:
        from app.services.audit_chain import append_security_event
        await append_security_event(
            db,
            user_id=user.id,
            account_id=user.account_id,
            event_type="initial_platform_admin_setup",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            details={"email": user.email},
        )
        await db.commit()
    except Exception:
        pass

    token = create_access_token(
        subject=user.id,
        claims={
            "purpose": "session",
            "role": user.role,
            "email": user.email,
            "account_id": user.account_id,
            "is_platform_admin": True,
            "ver": user.token_version or 0,
        },
    )

    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    from app.api.auth import build_user_out
    enriched_user = await build_user_out(user, db)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": enriched_user,
    }

