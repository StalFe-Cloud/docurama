"""
Unit tests for Docurama Plan, Quota, Trial and Metering Service
"""
from datetime import datetime, timezone, timedelta
import pytest
from app.models.models import Account, Envelope, User, AccountMembership
from app.services.quotas import (
    PlanTier,
    PLAN_DEFINITIONS,
    get_billing_period,
    get_envelope_limit,
    get_seat_limit,
    get_effective_plan,
    check_envelope_quota,
    check_seat_quota,
    get_usage_summary,
    is_trial_active,
    is_account_write_allowed,
)


@pytest.fixture(autouse=True)
def force_cloud_mode(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")


def test_selfhost_unlimited_behavior(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    account = Account(name="SelfHost Org", plan="unlimited")
    assert get_effective_plan(account) == PlanTier.UNLIMITED
    assert get_envelope_limit(account) is None
    assert get_seat_limit(account) is None


def test_plan_definitions_contain_premium_tiers():
    assert PlanTier.PLUS in PLAN_DEFINITIONS
    assert PlanTier.BUSINESS in PLAN_DEFINITIONS
    assert PlanTier.ENTERPRISE in PLAN_DEFINITIONS
    assert PlanTier.UNLIMITED in PLAN_DEFINITIONS

    plus = PLAN_DEFINITIONS[PlanTier.PLUS]
    assert plus["envelopes_per_month"] == 30
    assert plus["seats"] == 1
    assert "email_otp" in plus["allowed_channels"]
    assert "sms_otp" in plus["allowed_channels"]
    assert plus["can_use_custom_domain"] is False

    business = PLAN_DEFINITIONS[PlanTier.BUSINESS]
    assert business["envelopes_per_month"] == 250
    assert business["seats"] == 3
    assert "whatsapp_otp" in business["allowed_channels"]
    assert "telegram_otp" in business["allowed_channels"]
    assert business["can_use_custom_domain"] is True
    assert business["can_use_api_keys"] is True

    enterprise = PLAN_DEFINITIONS[PlanTier.ENTERPRISE]
    assert enterprise["envelopes_per_month"] == 10000
    assert enterprise["seats"] == 100
    assert enterprise["can_use_custom_domain"] is True


def test_trial_lifecycle_active_and_expired():
    now = datetime.now(timezone.utc)
    
    # 1. Active 7-day trial
    active_trial = Account(
        name="Trial Corp",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=5),
    )
    assert is_trial_active(active_trial, now) is True
    allowed, code = is_account_write_allowed(active_trial, now)
    assert allowed is True
    assert code == "TRIAL_ACTIVE"

    # 2. Expired trial
    expired_trial = Account(
        name="Expired Corp",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now - timedelta(hours=1),
    )
    assert is_trial_active(expired_trial, now) is False
    allowed, code = is_account_write_allowed(expired_trial, now)
    assert allowed is False
    assert code == "TRIAL_EXPIRED"


def test_billing_period_default_calendar_month():
    account = Account(name="Test Corp")
    ref = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    start, end = get_billing_period(account, ref)

    assert start == datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)


def test_custom_limits_override_plan():
    account = Account(
        name="Custom Corp",
        plan=PlanTier.PLUS,
        custom_envelope_limit=500,
        custom_seat_limit=15,
    )
    assert get_envelope_limit(account) == 500
    assert get_seat_limit(account) == 15


@pytest.mark.asyncio
async def test_envelope_quota_and_trial_expiration(db_session):
    now = datetime.now(timezone.utc)
    account = Account(
        name="Plus Trial Account",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=6),
    )
    db_session.add(account)
    await db_session.flush()

    # Active trial can create envelopes up to 30
    allowed, used, limit = await check_envelope_quota(account, db_session)
    assert allowed is True
    assert used == 0
    assert limit == 30

    # Expire the trial
    account.trial_ends_at = now - timedelta(minutes=5)
    await db_session.commit()

    allowed, used, limit = await check_envelope_quota(account, db_session)
    assert allowed is False  # Blocked because trial expired!
