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

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.auth import get_current_user
from app.api.legal import _require_platform_admin
from app.core.database import get_db
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
