"""
Quotas, Metering & Subscription Plan Endpoints

Also hosts the shared `require_paid_write` dependency: the single server-side
read-only gate for expired 14-day trials and expired paid plans. Routes that
create billable entitlements (envelopes, templates, invites, webhooks, API
keys, signing certificates) hang it on their mutating endpoints so a
read-only account stays read-only no matter what the frontend hides.
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
    is_account_write_allowed,
)

router = APIRouter(prefix="/quotas", tags=["quotas"])


# ---------------------------------------------------------------------------
# Read-only enforcement (final commercial model)
#
# After the 14-day no-card trial ends - or when a paid plan lapses - the
# account becomes READ-ONLY. Nothing is ever deleted: documents, envelopes,
# templates, audit trails and signing history all stay viewable and
# exportable. What is refused, with 402 Payment Required, is any write that
# would consume a paid entitlement. The check is server-side by design;
# hiding buttons in the frontend is not enforcement.
# ---------------------------------------------------------------------------

TRIAL_EXPIRED_MESSAGE = (
    "Your 14-day Plus trial has ended. "
    "Your documents remain safe and accessible. Upgrade to continue sending."
)
PLAN_EXPIRED_MESSAGE = (
    "Your plan has expired. "
    "Your documents remain safe and accessible. Upgrade to continue sending."
)


def _payment_required(reason: str) -> HTTPException:
    detail = TRIAL_EXPIRED_MESSAGE if reason == "TRIAL_EXPIRED" else PLAN_EXPIRED_MESSAGE
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={"code": reason, "message": detail, "cta": "Upgrade to Plus"},
    )


async def require_paid_write(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency: refuse entitlement-consuming writes for expired accounts.

    Reads, downloads, verification, exports and account settings stay open on
    purpose - read-only means exactly that, not data withholding."""
    if not current_user.account_id:
        return current_user  # no workspace: route's own 400/404 handling governs
    account = await db.get(Account, current_user.account_id)
    if account is None:
        return current_user
    allowed, reason = is_account_write_allowed(account)
    if not allowed:
        raise _payment_required(reason)
    return current_user


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
    # Self-host is Enterprise only (final commercial model). The "unlimited"
    # plan belongs to self-hosted deployments; on a cloud deployment it must
    # never be grantable - not even by a platform admin - because that would
    # be a free self-host workaround around Cloud billing.
    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"
    if is_cloud and plan_norm == PlanTier.UNLIMITED:
        raise HTTPException(
            status_code=400,
            detail="Self-host is an Enterprise deployment mode and cannot be granted on a cloud deployment.",
        )

    account.plan = plan_norm
    if payload.is_trial is not None:
        account.is_trial = payload.is_trial
    if payload.trial_ends_at is not None:
        account.trial_ends_at = payload.trial_ends_at
    if payload.billing_interval is not None:
        account.billing_interval = payload.billing_interval
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
