"""
Unit tests for Docurama Plan, Quota, and Metering Service
"""
from datetime import datetime, timezone
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
)
@pytest.fixture(autouse=True)
def force_cloud_mode(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")


def test_selfhost_unlimited_behavior(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    account = Account(name="SelfHost Org", plan="free")
    assert get_effective_plan(account) == PlanTier.UNLIMITED
    assert get_envelope_limit(account) is None
    assert get_seat_limit(account) is None


def test_plan_definitions_contain_required_tiers():
    assert PlanTier.FREE in PLAN_DEFINITIONS
    assert PlanTier.PRO in PLAN_DEFINITIONS
    assert PlanTier.BUSINESS in PLAN_DEFINITIONS
    assert PlanTier.ENTERPRISE in PLAN_DEFINITIONS
    assert PlanTier.UNLIMITED in PLAN_DEFINITIONS

    free = PLAN_DEFINITIONS[PlanTier.FREE]
    assert free["envelopes_per_month"] == 5
    assert free["seats"] == 1
    assert "email_otp" in free["allowed_channels"]
    assert "sms_otp" not in free["allowed_channels"]

    pro = PLAN_DEFINITIONS[PlanTier.PRO]
    assert pro["envelopes_per_month"] == 50
    assert pro["seats"] == 5
    assert "sms_otp" in pro["allowed_channels"]


def test_billing_period_default_calendar_month():
    account = Account(name="Test Corp")
    ref = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    start, end = get_billing_period(account, ref)

    assert start == datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)


def test_billing_period_with_anchor_day():
    # Account anchor is the 10th of every month
    anchor = datetime(2026, 1, 10, 0, 0, 0, tzinfo=timezone.utc)
    account = Account(name="Test Corp", billing_cycle_anchor=anchor)

    # Reference on September 15 (after 10th)
    ref_after = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    start, end = get_billing_period(account, ref_after)
    assert start == datetime(2026, 9, 10, 0, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 10, 0, 0, 0, tzinfo=timezone.utc)

    # Reference on September 5 (before 10th)
    ref_before = datetime(2026, 9, 5, 12, 0, 0, tzinfo=timezone.utc)
    start, end = get_billing_period(account, ref_before)
    assert start == datetime(2026, 8, 10, 0, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 9, 10, 0, 0, 0, tzinfo=timezone.utc)


def test_custom_limits_override_plan():
    account = Account(
        name="Custom Corp",
        plan=PlanTier.FREE,
        custom_envelope_limit=250,
        custom_seat_limit=15,
    )
    assert get_envelope_limit(account) == 250
    assert get_seat_limit(account) == 15


@pytest.mark.asyncio
async def test_envelope_quota_checks(db_session):
    account = Account(name="Quota Test", plan=PlanTier.FREE)
    db_session.add(account)
    await db_session.flush()

    # Initially 0 envelopes created
    allowed, used, limit = await check_envelope_quota(account, db_session)
    assert allowed is True
    assert used == 0
    assert limit == 5

    # Add 5 envelopes in current cycle
    now = datetime.now(timezone.utc)
    for i in range(5):
        env = Envelope(
            account_id=account.id,
            title=f"Env {i}",
            original_pdf_path="/tmp/test.pdf",
            status="sent",
            created_at=now,
        )
        db_session.add(env)
    await db_session.commit()

    allowed, used, limit = await check_envelope_quota(account, db_session)
    assert allowed is False  # 5/5 used
    assert used == 5
    assert limit == 5

    # Usage summary
    summary = await get_usage_summary(account, db_session)
    assert summary["is_quota_exceeded"] is True
    assert summary["envelopes_remaining"] == 0
    assert summary["envelopes_used"] == 5
