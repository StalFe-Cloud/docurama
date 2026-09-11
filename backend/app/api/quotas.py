"""
Quotas, Metering & Subscription Plan Endpoints
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import settings
from app.api.auth import get_current_user
from app.models.models import User, Account
from app.schemas.schemas import AccountUsageOut, AccountPlanUpdateIn
from app.services.quotas import (
    PlanTier,
    PLAN_DEFINITIONS,
    get_usage_summary,
)

router = APIRouter(prefix="/quotas", tags=["quotas"])


@router.get("/usage", response_model=AccountUsageOut)
async def get_account_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve active plan, quota limits, current monthly consumption, and billing cycle info.
    """
    account_id = current_user.account_id
    if not account_id:
        raise HTTPException(status_code=400, detail="User is not associated with an active workspace.")

    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Workspace account not found.")

    summary = await get_usage_summary(account, db)
    return AccountUsageOut(**summary)


@router.patch("/plan", response_model=AccountUsageOut)
async def update_account_plan(
    payload: AccountPlanUpdateIn,
    account_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update an account's plan tier or custom envelope/seat limits.
    Restricted to platform administrators.
    """
    if not getattr(current_user, "is_platform_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform administrator privileges required to adjust subscription plans.",
        )

    target_id = account_id or current_user.account_id
    if not target_id:
        raise HTTPException(status_code=400, detail="Target account ID must be specified.")

    account = await db.get(Account, target_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")

    plan_norm = (payload.plan or "").strip().lower()
    if plan_norm not in PLAN_DEFINITIONS:
        valid_plans = ", ".join(PLAN_DEFINITIONS.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan '{payload.plan}'. Must be one of: {valid_plans}.",
        )

    account.plan = plan_norm
    if payload.plan_expires_at is not None:
        account.plan_expires_at = payload.plan_expires_at
    if payload.custom_envelope_limit is not None:
        account.custom_envelope_limit = payload.custom_envelope_limit
    if payload.custom_seat_limit is not None:
        account.custom_seat_limit = payload.custom_seat_limit
    if payload.billing_cycle_anchor is not None:
        account.billing_cycle_anchor = payload.billing_cycle_anchor

    await db.commit()
    await db.refresh(account)

    summary = await get_usage_summary(account, db)
    return AccountUsageOut(**summary)
