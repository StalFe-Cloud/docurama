"""
Docurama Quota, Metering & Plan Service

Enforces envelope volume quotas, active seat limits, and feature availability
across Free, Pro, Business, Enterprise, and Self-Host deployments.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, List, Dict, Any
import calendar
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Account, AccountMembership, Envelope, User


class PlanTier:
    FREE = "free"
    PRO = "pro"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"
    UNLIMITED = "unlimited"


PLAN_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    PlanTier.FREE: {
        "display_name": "Free",
        "envelopes_per_month": 5,
        "seats": 1,
        "allowed_channels": ["none", "email_otp"],
        "can_use_custom_domain": False,
        "can_use_api_keys": False,
    },
    PlanTier.PRO: {
        "display_name": "Pro",
        "envelopes_per_month": 50,
        "seats": 5,
        "allowed_channels": ["none", "email_otp", "sms_otp", "whatsapp_otp", "telegram_otp"],
        "can_use_custom_domain": False,
        "can_use_api_keys": True,
    },
    PlanTier.BUSINESS: {
        "display_name": "Business",
        "envelopes_per_month": 500,
        "seats": 20,
        "allowed_channels": ["none", "email_otp", "sms_otp", "whatsapp_otp", "telegram_otp"],
        "can_use_custom_domain": True,
        "can_use_api_keys": True,
    },
    PlanTier.ENTERPRISE: {
        "display_name": "Enterprise",
        "envelopes_per_month": 10000,
        "seats": 100,
        "allowed_channels": ["none", "email_otp", "sms_otp", "whatsapp_otp", "telegram_otp"],
        "can_use_custom_domain": True,
        "can_use_api_keys": True,
    },
    PlanTier.UNLIMITED: {
        "display_name": "Self-Host Unlimited",
        "envelopes_per_month": None,
        "seats": None,
        "allowed_channels": ["none", "email_otp", "sms_otp", "whatsapp_otp", "telegram_otp"],
        "can_use_custom_domain": True,
        "can_use_api_keys": True,
    },
}


def get_effective_plan(account: Account) -> str:
    """
    Resolve the active plan for an account.
    In self-host mode, accounts default to unlimited unless explicitly set to a paid tier.
    In cloud mode, accounts default to free.
    """
    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"
    plan = getattr(account, "plan", None)
    if not is_cloud:
        if not plan or plan in (PlanTier.FREE, PlanTier.UNLIMITED, ""):
            return PlanTier.UNLIMITED
        return plan

    if not plan:
        return PlanTier.FREE
    return plan


def get_billing_period(account: Account, ref_date: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """
    Calculates the start and end timestamps (in UTC) for the current billing cycle.
    Supports accounts with a custom billing_cycle_anchor day of month.
    """
    now = ref_date or datetime.now(timezone.utc)
    anchor = getattr(account, "billing_cycle_anchor", None)
    anchor_day = anchor.day if anchor else 1

    # Clamp anchor day to valid range for target month
    max_days_current_month = calendar.monthrange(now.year, now.month)[1]
    target_day = min(anchor_day, max_days_current_month)

    if now.day >= target_day:
        # Current cycle started this month
        cycle_start = datetime(now.year, now.month, target_day, 0, 0, 0, tzinfo=timezone.utc)
        # Next cycle starts next month
        if now.month == 12:
            next_year, next_month = now.year + 1, 1
        else:
            next_year, next_month = now.year, now.month + 1
        max_days_next = calendar.monthrange(next_year, next_month)[1]
        cycle_end = datetime(next_year, next_month, min(anchor_day, max_days_next), 0, 0, 0, tzinfo=timezone.utc)
    else:
        # Current cycle started last month
        if now.month == 1:
            prev_year, prev_month = now.year - 1, 12
        else:
            prev_year, prev_month = now.year, now.month - 1
        max_days_prev = calendar.monthrange(prev_year, prev_month)[1]
        cycle_start = datetime(prev_year, prev_month, min(anchor_day, max_days_prev), 0, 0, 0, tzinfo=timezone.utc)
        cycle_end = datetime(now.year, now.month, target_day, 0, 0, 0, tzinfo=timezone.utc)

    return cycle_start, cycle_end


def get_envelope_limit(account: Account) -> Optional[int]:
    """
    Determine the monthly envelope limit.
    Custom envelope limit takes precedence over plan tier.
    Returns None if unlimited.
    """
    if getattr(account, "custom_envelope_limit", None) is not None:
        return account.custom_envelope_limit

    plan = get_effective_plan(account)
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.FREE])
    return defn["envelopes_per_month"]


def get_seat_limit(account: Account) -> Optional[int]:
    """
    Determine the active member/seat limit.
    Custom seat limit takes precedence over plan tier.
    Returns None if unlimited.
    """
    if getattr(account, "custom_seat_limit", None) is not None:
        return account.custom_seat_limit

    plan = get_effective_plan(account)
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.FREE])
    return defn["seats"]


async def count_envelopes_in_period(account_id: str, start: datetime, end: datetime, db: AsyncSession) -> int:
    """
    Count envelopes dispatched by this account within the active billing period.
    """
    query = select(func.count(Envelope.id)).where(
        Envelope.account_id == account_id,
        Envelope.created_at >= start,
        Envelope.created_at < end,
    )
    result = await db.execute(query)
    return result.scalar() or 0


async def count_active_seats(account_id: str, db: AsyncSession) -> int:
    """
    Count active memberships in this account.
    Falls back to user count if memberships are not populated.
    """
    query_members = select(func.count(AccountMembership.id)).where(
        AccountMembership.account_id == account_id,
        AccountMembership.is_active == True,
    )
    res_members = (await db.execute(query_members)).scalar() or 0
    if res_members > 0:
        return res_members

    # Fallback to direct account_id on User
    query_users = select(func.count(User.id)).where(
        User.account_id == account_id,
        User.is_active == True,
    )
    return (await db.execute(query_users)).scalar() or 1


async def check_envelope_quota(account: Account, db: AsyncSession) -> Tuple[bool, int, Optional[int]]:
    """
    Validate whether the account can create another envelope.
    Returns (is_allowed, envelopes_used, envelope_limit).
    """
    limit = get_envelope_limit(account)
    cycle_start, cycle_end = get_billing_period(account)
    used = await count_envelopes_in_period(account.id, cycle_start, cycle_end, db)

    if limit is None:
        return True, used, None

    return used < limit, used, limit


async def check_seat_quota(account: Account, db: AsyncSession) -> Tuple[bool, int, Optional[int]]:
    """
    Validate whether the account can add/invite another team member.
    Returns (is_allowed, seats_used, seat_limit).
    """
    limit = get_seat_limit(account)
    used = await count_active_seats(account.id, db)

    if limit is None:
        return True, used, None

    return used < limit, used, limit


async def get_usage_summary(account: Account, db: AsyncSession) -> Dict[str, Any]:
    """
    Compute a comprehensive usage and quota report for the account.
    """
    plan = get_effective_plan(account)
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.FREE])
    cycle_start, cycle_end = get_billing_period(account)

    envelopes_used = await count_envelopes_in_period(account.id, cycle_start, cycle_end, db)
    envelopes_limit = get_envelope_limit(account)
    envelopes_remaining = (
        max(0, envelopes_limit - envelopes_used) if envelopes_limit is not None else None
    )

    seats_used = await count_active_seats(account.id, db)
    seats_limit = get_seat_limit(account)
    seats_remaining = (
        max(0, seats_limit - seats_used) if seats_limit is not None else None
    )

    now = datetime.now(timezone.utc)
    days_remaining = max(0, (cycle_end - now).days)

    is_quota_exceeded = (
        (envelopes_limit is not None and envelopes_used >= envelopes_limit) or
        (seats_limit is not None and seats_used > seats_limit)
    )

    return {
        "account_id": account.id,
        "account_name": account.name,
        "plan": plan,
        "plan_display_name": defn["display_name"],
        "plan_expires_at": getattr(account, "plan_expires_at", None),
        "envelopes_used": envelopes_used,
        "envelopes_limit": envelopes_limit,
        "envelopes_remaining": envelopes_remaining,
        "seats_used": seats_used,
        "seats_limit": seats_limit,
        "seats_remaining": seats_remaining,
        "cycle_start": cycle_start,
        "cycle_end": cycle_end,
        "days_remaining_in_cycle": days_remaining,
        "allowed_channels": defn["allowed_channels"],
        "can_use_custom_domain": defn["can_use_custom_domain"],
        "can_use_api_keys": defn["can_use_api_keys"],
        "is_quota_exceeded": is_quota_exceeded,
    }
