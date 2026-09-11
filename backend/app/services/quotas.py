"""
Docurama Quota, Metering & Plan Service

Enforces envelope volume quotas, active seat limits, trial lifecycle,
and feature availability across Plus (7-Day Trial), Business Team,
Enterprise, and Self-Host Unlimited deployments.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, List, Dict, Any
import calendar
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Account, AccountMembership, Envelope, User


class PlanTier:
    PLUS = "plus"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"
    UNLIMITED = "unlimited"
    # Legacy compatibility aliases
    FREE = "free"
    PRO = "pro"


PLAN_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    PlanTier.PLUS: {
        "display_name": "Plus",
        "envelopes_per_month": 30,
        "seats": 1,
        "allowed_channels": ["none", "email_otp", "sms_otp"],
        "can_use_custom_domain": False,
        "can_use_api_keys": False,
    },
    PlanTier.BUSINESS: {
        "display_name": "Business Team",
        "envelopes_per_month": 250,
        "seats": 3,
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
# Backward compatibility aliases
PLAN_DEFINITIONS[PlanTier.FREE] = PLAN_DEFINITIONS[PlanTier.PLUS]
PLAN_DEFINITIONS[PlanTier.PRO] = PLAN_DEFINITIONS[PlanTier.PLUS]


def get_effective_plan(account: Account) -> str:
    """
    Resolve the active plan for an account.
    In self-host mode, accounts default to unlimited unless explicitly set to a paid tier.
    In cloud mode, accounts default to plus.
    """
    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"
    plan = getattr(account, "plan", None)
    if not is_cloud:
        if not plan or plan in (PlanTier.PLUS, PlanTier.FREE, PlanTier.PRO, PlanTier.UNLIMITED, ""):
            return PlanTier.UNLIMITED
        return plan

    if not plan or plan in (PlanTier.FREE, PlanTier.PRO):
        return PlanTier.PLUS
    return plan


def is_trial_active(account: Account, ref_date: Optional[datetime] = None) -> bool:
    """
    Check if the account is currently within its 7-day trial window.
    """
    if not getattr(account, "is_trial", False):
        return False
    trial_ends = getattr(account, "trial_ends_at", None)
    if not trial_ends:
        return False
    now = ref_date or datetime.now(timezone.utc)
    return now < trial_ends


def is_account_write_allowed(account: Account, ref_date: Optional[datetime] = None) -> Tuple[bool, str]:
    """
    Verify if the account is permitted to perform write operations (creating envelopes, inviting members).
    Self-host mode is always allowed.
    In cloud mode:
    - If is_trial is True, must not be expired.
    - If paid plan, must not be expired if plan_expires_at is set.
    Returns (is_allowed, reason_code).
    """
    is_cloud = (settings.DEPLOYMENT_MODE or "").strip().lower() == "cloud"
    if not is_cloud:
        return True, "ALLOWED"

    now = ref_date or datetime.now(timezone.utc)
    if getattr(account, "is_trial", False):
        trial_ends = getattr(account, "trial_ends_at", None)
        if trial_ends and now >= trial_ends:
            return False, "TRIAL_EXPIRED"
        return True, "TRIAL_ACTIVE"

    expires_at = getattr(account, "plan_expires_at", None)
    if expires_at and now >= expires_at:
        return False, "PLAN_EXPIRED"

    return True, "ACTIVE"


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
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.PLUS])
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
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.PLUS])
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
    allowed_write, reason = is_account_write_allowed(account)
    limit = get_envelope_limit(account)
    cycle_start, cycle_end = get_billing_period(account)
    used = await count_envelopes_in_period(account.id, cycle_start, cycle_end, db)

    if not allowed_write:
        return False, used, limit

    if limit is None:
        return True, used, None

    return used < limit, used, limit


async def check_seat_quota(account: Account, db: AsyncSession) -> Tuple[bool, int, Optional[int]]:
    """
    Validate whether the account can add/invite another team member.
    Returns (is_allowed, seats_used, seat_limit).
    """
    allowed_write, reason = is_account_write_allowed(account)
    limit = get_seat_limit(account)
    used = await count_active_seats(account.id, db)

    if not allowed_write:
        return False, used, limit

    if limit is None:
        return True, used, None

    return used < limit, used, limit


async def get_usage_summary(account: Account, db: AsyncSession) -> Dict[str, Any]:
    """
    Compute a comprehensive usage and quota report for the account.
    """
    plan = get_effective_plan(account)
    defn = PLAN_DEFINITIONS.get(plan, PLAN_DEFINITIONS[PlanTier.PLUS])
    cycle_start, cycle_end = get_billing_period(account)
    now = datetime.now(timezone.utc)

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

    is_trial = getattr(account, "is_trial", False)
    trial_ends = getattr(account, "trial_ends_at", None)
    is_trial_expired = is_trial and bool(trial_ends and now >= trial_ends)
    trial_days_remaining = (
        max(0, (trial_ends - now).days) if is_trial and trial_ends and not is_trial_expired else 0
    ) if is_trial else None

    is_envelope_capped = envelopes_limit is not None and envelopes_used >= envelopes_limit
    is_seat_capped = seats_limit is not None and seats_used > seats_limit
    is_quota_exceeded = is_envelope_capped or is_seat_capped or is_trial_expired

    return {
        "account_id": account.id,
        "account_name": getattr(account, "name", "Workspace"),
        "plan": plan,
        "plan_display_name": defn["display_name"],
        "plan_expires_at": getattr(account, "plan_expires_at", None),
        "is_trial": is_trial,
        "trial_ends_at": trial_ends,
        "trial_days_remaining": trial_days_remaining,
        "is_trial_expired": is_trial_expired,
        "billing_interval": getattr(account, "billing_interval", "monthly"),
        "envelopes_used": envelopes_used,
        "envelopes_limit": envelopes_limit,
        "envelopes_remaining": envelopes_remaining,
        "seats_used": seats_used,
        "seats_limit": seats_limit,
        "seats_remaining": seats_remaining,
        "cycle_start": cycle_start,
        "cycle_end": cycle_end,
        "days_remaining_in_cycle": max(0, (cycle_end - now).days),
        "allowed_channels": defn["allowed_channels"],
        "can_use_custom_domain": defn["can_use_custom_domain"],
        "can_use_api_keys": defn["can_use_api_keys"],
        "is_quota_exceeded": is_quota_exceeded,
    }
