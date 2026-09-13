"""
Final commercial model: trial lifecycle, read-only expiry, self-host
Enterprise-only enforcement, and the launch Stripe price mappings.

These are the PART C / PART G / PART P regression tests:

- Cloud signup creates a 14-day no-card Plus trial (TRIAL_DAYS is the
  constant; this suite pins the endpoint behaviour to it);
- After expiry the account is READ-ONLY server-side: entitlement-consuming
  writes answer 402 with the upgrade messaging, while reads, exports and
  verification stay open and nothing is deleted;
- The self-host "unlimited" plan is not grantable on a cloud deployment -
  not even by a platform admin - and Enterprise checkout is refused as
  sales-led;
- Stripe mappings resolve monthly AND annual prices to plans and intervals,
  and the webhook sync follows the billed price.
"""
import json

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy.future import select

from app.core import config
from app.core.security import create_access_token, get_password_hash
from app.models import Account, User
from app.services import billing
from app.services.pricing import TRIAL_DAYS


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def cloud_mode(monkeypatch):
    """The commercial model lives in cloud mode; self-host tests opt out."""
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")


@pytest.fixture
async def trial_account(db_session):
    account = Account(name="Trial Org", plan="plus", is_trial=True,
                      trial_ends_at=datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS))
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(
        account_id=account.id, email="owner@trial.example",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin", is_active=True,
    ))
    await db_session.commit()
    return account


async def _login(client, db_session, account) -> User:
    user = (await db_session.execute(
        select(User).where(User.account_id == account.id)
    )).scalar_one()
    token = create_access_token(user.id, claims={"role": user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", token)
    return user


# ---------------------------------------------------------------------------
# 14-day trial at signup (PART C)
# ---------------------------------------------------------------------------

async def test_signup_creates_14_day_plus_trial_no_card(client, db_session):
    """PART C: cloud signup automatically creates plan=PLUS, is_trial=true,
    trial_ends_at = now + 14 days. No credit card anywhere in the flow."""
    from datetime import datetime, timezone

    from sqlalchemy.future import select

    resp = await client.post("/api/auth/register", json={
        "email": "fresh@trial14.example",
        "password": "a-long-password-1234",
        "first_name": "Fresh",
        "last_name": "Trial",
        "age_gate_confirmed": True,
        "marketing_consent": False,
    })
    assert resp.status_code == 200, resp.text
    user = (await db_session.execute(
        select(User).where(User.email == "fresh@trial14.example")
    )).scalar_one()
    assert user.account_id
    account = (await db_session.execute(
        select(Account).where(Account.id == user.account_id)
    )).scalar_one()
    assert account.plan == "plus"
    assert account.is_trial is True
    assert account.trial_ends_at is not None
    # SQLite can round-trip naive; the service layer normalizes via _as_aware.
    te = account.trial_ends_at
    if te.tzinfo is None:
        te = te.replace(tzinfo=timezone.utc)
    remaining = (te - datetime.now(timezone.utc)).days
    assert 13 <= remaining <= 14  # 14 days, no card required, nothing charged


# ---------------------------------------------------------------------------
# read-only after expiry (PART C) - server-side, not frontend hiding
# ---------------------------------------------------------------------------

@pytest.fixture
async def expired_account(db_session):
    account = Account(name="Expired Org", plan="plus", is_trial=True,
                      trial_ends_at=datetime.now(timezone.utc) - timedelta(hours=1))
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(
        account_id=account.id, email="owner@expired.example",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin", is_active=True,
    ))
    await db_session.commit()
    return account


async def test_expired_trial_cannot_create_webhook(client, db_session, expired_account):
    await _login(client, db_session, expired_account)
    resp = await client.post("/api/webhooks", json={
        "url": "https://hooks.customer.example/notify", "events": ["envelope.completed"],
    })
    assert resp.status_code == 402
    detail = resp.json()["detail"]
    assert detail["code"] == "TRIAL_EXPIRED"
    assert "14-day Plus trial has ended" in detail["message"]
    assert "remain safe and accessible" in detail["message"]
    assert detail["cta"] == "Upgrade to Plus"


async def test_expired_trial_cannot_mint_api_key(client, db_session, expired_account):
    await _login(client, db_session, expired_account)
    resp = await client.post("/api/api-keys", json={"name": "after-trial"})
    assert resp.status_code == 402


async def test_expired_trial_cannot_create_template(client, db_session, expired_account):
    await _login(client, db_session, expired_account)
    resp = await client.post("/api/templates", data={
        "title": "After trial", "recipients_json": "[]",
    })
    assert resp.status_code == 402


async def test_expired_trial_reads_stay_open(client, db_session, expired_account):
    """Read-only means viewable and exportable - never data withholding."""
    await _login(client, db_session, expired_account)
    for path in ("/api/quotas/usage", "/api/billing/subscription", "/api/templates"):
        resp = await client.get(path)
        assert resp.status_code == 200, (path, resp.status_code)
    body = (await client.get("/api/quotas/usage")).json()
    assert body["is_trial_expired"] is True


# ---------------------------------------------------------------------------
# self-host is Enterprise only (PART B / PART P) - server-side
# ---------------------------------------------------------------------------

async def test_cloud_platform_admin_cannot_grant_unlimited(client, db_session):
    """The unlimited plan belongs to self-hosted Enterprise deployments.
    On a cloud deployment even a platform admin must not be able to grant
    it - that would be the free-self-host workaround around Cloud billing."""
    account = Account(name="Sneaky Org", plan="plus", is_trial=False)
    db_session.add(account)
    await db_session.flush()
    admin = User(email="root@admin.example", hashed_password="x", role="admin",
                 is_platform_admin=True, account_id=account.id)
    db_session.add(admin)
    await db_session.commit()
    token = create_access_token(admin.id, claims={"role": "admin", "account_id": account.id})
    client.cookies.set("_docurama_session", token)
    resp = await client.patch(f"/api/quotas/plan?account_id={account.id}",
                              json={"plan": "unlimited"})
    assert resp.status_code == 400
    assert "Enterprise" in resp.json()["detail"]
    # The paid tiers remain grantable by the platform admin.
    resp = await client.patch(f"/api/quotas/plan?account_id={account.id}",
                              json={"plan": "business"})
    assert resp.status_code == 200


async def test_selfhost_deployment_grants_unlimited(db_session, monkeypatch):
    """On a self-hosted Enterprise deployment the unlimited plan is the
    default and quota writes are unrestricted."""
    from app.services.quotas import get_effective_plan, is_account_write_allowed
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    account = Account(name="On-Prem Org", plan="unlimited", is_trial=False)
    assert get_effective_plan(account) == "unlimited"
    allowed, reason = is_account_write_allowed(account)
    assert allowed is True and reason == "ALLOWED"


# ---------------------------------------------------------------------------
# Stripe launch mappings (PART G)
# ---------------------------------------------------------------------------

def test_price_mappings_cover_all_four_prices(monkeypatch):
    monkeypatch.setattr(config.settings, "STRIPE_PRICE_PLUS_MONTHLY", "price_plus_m")
    monkeypatch.setattr(config.settings, "STRIPE_PRICE_PLUS_ANNUAL", "price_plus_a")
    monkeypatch.setattr(config.settings, "STRIPE_PRICE_BUSINESS_TEAM_MONTHLY", "price_bt_m")
    monkeypatch.setattr(config.settings, "STRIPE_PRICE_BUSINESS_TEAM_ANNUAL", "price_bt_a")
    assert billing.price_to_plan("price_plus_m") == "plus"
    assert billing.price_to_plan("price_plus_a") == "plus"
    assert billing.price_to_plan("price_bt_m") == "business"
    assert billing.price_to_plan("price_bt_a") == "business"
    assert billing.price_to_interval("price_plus_m") == "monthly"
    assert billing.price_to_interval("price_plus_a") == "annual"
    assert billing.price_to_interval("price_bt_m") == "monthly"
    assert billing.price_to_interval("price_bt_a") == "annual"
    assert billing.price_to_plan("price_unknown") is None


def test_checkout_requires_interval_price(monkeypatch):
    monkeypatch.setattr(config.settings, "BILLING_ENABLED", True)
    monkeypatch.setattr(config.settings, "STRIPE_PRICE_PLUS_MONTHLY", "price_plus_m")
    # Annual requested but only monthly configured -> honest 503, not a wrong charge.
    with pytest.raises(billing.BillingNotConfigured, match="ANNUAL"):
        billing.require_configured_price("plus", "annual")


async def test_enterprise_checkout_refused_sales_led(client, db_session, monkeypatch):
    monkeypatch.setattr(config.settings, "BILLING_ENABLED", True)
    monkeypatch.setattr(config.settings, "STRIPE_SECRET_KEY", "sk_test_dummy")
    account = Account(name="SalesLed Org", plan="plus", is_trial=False)
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(account_id=account.id, email="cto@salesled.example",
                        hashed_password=get_password_hash("a-long-password-1234"),
                        role="admin", is_active=True))
    await db_session.commit()
    await _login(client, db_session, account)
    resp = await client.post("/api/billing/checkout",
                             json={"plan": "enterprise", "interval": "annual"})
    assert resp.status_code == 503
    assert "sales" in str(resp.json()["detail"]).lower()


async def test_webhook_sync_follows_billed_price(client, db_session, monkeypatch):
    """A renewal webhook carrying the annual price must attribute the right
    plan AND the annual interval."""
    from datetime import datetime, timezone
    from sqlalchemy.future import select
    from app.models import StripeEvent

    account = Account(name="Annual Org", plan="plus", is_trial=True,
                      trial_ends_at=datetime.now(timezone.utc),
                      stripe_customer_id="cus_launch_1",
                      stripe_subscription_id="sub_launch_1")
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(account_id=account.id, email="owner@annual.example",
                        hashed_password=get_password_hash("a-long-password-1234"),
                        role="admin", is_active=True))
    await db_session.commit()

    monkeypatch.setattr(config.settings, "STRIPE_PRICE_PLUS_ANNUAL", "price_plus_a")

    event = {
        "id": "evt_launch_annual_1",
        "type": "customer.subscription.updated",
        "data": {"object": {
            "id": "sub_launch_1",
            "customer": "cus_launch_1",
            "items": {"data": [{"price": {"id": "price_plus_a"}}]},
            "cancel_at_period_end": False,
            "current_period_end": int(datetime.now(timezone.utc).timestamp()) + 86400,
        }},
    }
    from app.services import billing as billing_service

    monkeypatch.setattr(config.settings, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(config.settings, "STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")

    def _verified(self, *, payload, signature):
        return json.loads(payload.decode())

    monkeypatch.setattr(billing_service.StripeAdapter, "verify_webhook", _verified)

    resp = await client.post("/api/billing/webhook", content=json.dumps(event).encode(),
                             headers={"stripe-signature": "sig"})
    assert resp.status_code == 200
    refreshed = (await db_session.execute(
        select(Account).where(Account.id == account.id)
    )).scalar_one()
    assert refreshed.plan == "plus"
    assert refreshed.is_trial is False
    assert refreshed.billing_interval == "annual"
    ledger = (await db_session.execute(
        select(StripeEvent).where(StripeEvent.id == "evt_launch_annual_1")
    )).scalar_one()
    assert ledger.account_id == account.id
