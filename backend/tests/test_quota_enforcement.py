"""
Integration tests for Plan Quotas, Metering, Trial and Tier Enforcements
"""
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import User, Account, AccountMembership, Envelope
from app.services.quotas import PlanTier, check_envelope_quota, check_seat_quota


@pytest.fixture(autouse=True)
def force_cloud_mode(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")


@pytest.mark.asyncio
async def test_selfhost_bypasses_quota_limits(db_session: AsyncSession, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    account = Account(name="SelfHost Corp", plan="unlimited")
    db_session.add(account)
    await db_session.flush()

    allowed_env, _, limit_env = await check_envelope_quota(account, db_session)
    assert allowed_env is True
    assert limit_env is None

    allowed_seat, _, limit_seat = await check_seat_quota(account, db_session)
    assert allowed_seat is True
    assert limit_seat is None


@pytest.mark.asyncio
async def test_get_account_usage_endpoint(client: AsyncClient, db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    account = Account(
        name="SaaS Tenant",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=7),
    )
    db_session.add(account)
    await db_session.flush()

    user = User(
        email="owner@tenant.com",
        hashed_password="hashed_test_password",
        first_name="Alice",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.flush()

    mem = AccountMembership(account_id=account.id, user_id=user.id, role="owner")
    db_session.add(mem)
    await db_session.commit()

    # Login / session
    from app.core.security import create_access_token
    token = create_access_token(user.id, claims={"role": user.role, "email": user.email, "account_id": account.id})
    client.cookies.set("_docurama_session", token)

    res = await client.get("/api/quotas/usage")
    assert res.status_code == 200
    data = res.json()
    assert data["account_id"] == account.id
    assert data["plan"] == "plus"
    assert data["is_trial"] is True
    assert data["is_trial_expired"] is False
    assert data["envelopes_limit"] == 30
    assert data["envelopes_used"] == 0
    assert data["seats_limit"] == 1
    assert data["seats_used"] == 1
    assert data["is_quota_exceeded"] is False


@pytest.mark.asyncio
async def test_patch_account_plan_permissions(client: AsyncClient, db_session: AsyncSession):
    account = Account(name="Test Org", plan=PlanTier.PLUS)
    db_session.add(account)
    await db_session.flush()

    # Normal user (not platform admin)
    normal_user = User(
        email="regular@test.com",
        hashed_password="hashed_test_password",
        role="admin",
        is_platform_admin=False,
        account_id=account.id,
    )
    # Platform admin user
    platform_admin = User(
        email="superadmin@stalfe.com",
        hashed_password="hashed_test_password",
        role="admin",
        is_platform_admin=True,
        account_id=account.id,
    )
    db_session.add_all([normal_user, platform_admin])
    await db_session.commit()

    from app.core.security import create_access_token

    # 1. Normal user should be rejected (403)
    normal_token = create_access_token(normal_user.id, claims={"role": normal_user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", normal_token)
    res_forbidden = await client.patch(
        f"/api/quotas/plan?account_id={account.id}",
        json={"plan": "business"}
    )
    assert res_forbidden.status_code == 403

    # 2. Platform admin succeeds (200)
    admin_token = create_access_token(platform_admin.id, claims={"role": platform_admin.role, "account_id": account.id})
    client.cookies.set("_docurama_session", admin_token)
    res_ok = await client.patch(
        f"/api/quotas/plan?account_id={account.id}",
        json={"plan": "business", "custom_envelope_limit": 500}
    )
    assert res_ok.status_code == 200
    data = res_ok.json()
    assert data["plan"] == "business"
    assert data["envelopes_limit"] == 500


@pytest.mark.asyncio
async def test_envelope_creation_blocked_when_quota_exhausted(client: AsyncClient, db_session: AsyncSession, tmp_path):
    now = datetime.now(timezone.utc)
    account = Account(
        name="Quota Capped Org",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=7),
    )
    db_session.add(account)
    await db_session.flush()

    user = User(
        email="sender@capped.com",
        hashed_password="hashed_test_password",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.flush()

    # Pre-fill 30 envelopes in current billing cycle
    for i in range(30):
        db_session.add(Envelope(
            account_id=account.id,
            created_by_user_id=user.id,
            title=f"Prior Envelope {i}",
            original_pdf_path=str(tmp_path / f"test_{i}.pdf"),
            status="sent",
            created_at=now,
        ))
    await db_session.commit()

    from app.core.security import create_access_token
    token = create_access_token(user.id, claims={"role": user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", token)

    # Attempt to create 31st envelope -> 402 Payment Required
    pdf_content = b"%PDF-1.4 test document content"
    files = {"file": ("contract.pdf", pdf_content, "application/pdf")}
    data = {
        "title": "Thirty-first Envelope",
        "recipients_json": '[{"name": "Signer", "email": "signer@example.com", "role": "Signer"}]',
        "fields_json": "[]",
    }
    res = await client.post("/api/envelopes", data=data, files=files)
    assert res.status_code == 402
    assert "Monthly envelope quota reached" in res.json()["detail"]


@pytest.mark.asyncio
async def test_envelope_creation_blocked_when_trial_expired(client: AsyncClient, db_session: AsyncSession, tmp_path):
    now = datetime.now(timezone.utc)
    account = Account(
        name="Expired Org",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now - timedelta(days=1),  # Expired yesterday
    )
    db_session.add(account)
    await db_session.flush()

    user = User(
        email="sender@expired.com",
        hashed_password="hashed_test_password",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()

    from app.core.security import create_access_token
    token = create_access_token(user.id, claims={"role": user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", token)

    pdf_content = b"%PDF-1.4 test document content"
    files = {"file": ("contract.pdf", pdf_content, "application/pdf")}
    data = {
        "title": "Envelope on Expired Trial",
        "recipients_json": '[{"name": "Signer", "email": "signer@example.com", "role": "Signer"}]',
        "fields_json": "[]",
    }
    res = await client.post("/api/envelopes", data=data, files=files)
    assert res.status_code == 402
    assert "trial has expired" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_whatsapp_verification_channel_rejected_on_plus_tier(client: AsyncClient, db_session: AsyncSession, tmp_path):
    now = datetime.now(timezone.utc)
    account = Account(
        name="Plus Org",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=7),
    )
    db_session.add(account)
    await db_session.flush()

    user = User(
        email="sender@plusorg.com",
        hashed_password="hashed_test_password",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()

    from app.core.security import create_access_token
    token = create_access_token(user.id, claims={"role": user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", token)

    pdf_content = b"%PDF-1.4 test document content"
    files = {"file": ("contract.pdf", pdf_content, "application/pdf")}
    data = {
        "title": "WhatsApp Envelope on Plus Tier",
        "recipients_json": '[{"name": "Signer", "email": "signer@example.com", "role": "Signer", "verification_channel": "whatsapp_otp", "phone": "+33612345678"}]',
        "fields_json": "[]",
    }
    res = await client.post("/api/envelopes", data=data, files=files)
    assert res.status_code == 402
    assert "not available on your Plus plan" in res.json()["detail"]


@pytest.mark.asyncio
async def test_team_member_invite_blocked_when_seat_limit_reached(client: AsyncClient, db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    account = Account(
        name="Solo Org",
        plan=PlanTier.PLUS,
        is_trial=True,
        trial_ends_at=now + timedelta(days=7),
    )
    db_session.add(account)
    await db_session.flush()

    user = User(
        email="founder@solo.com",
        hashed_password="hashed_test_password",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.flush()

    mem = AccountMembership(account_id=account.id, user_id=user.id, role="owner", is_active=True)
    db_session.add(mem)
    await db_session.commit()

    from app.core.security import create_access_token
    token = create_access_token(user.id, claims={"role": user.role, "account_id": account.id})
    client.cookies.set("_docurama_session", token)

    # Plus plan allows 1 seat. 1 seat is already occupied by founder.
    # Attempting to invite second member should return 402 Payment Required.
    invite_payload = {
        "email": "teammate@solo.com",
        "first_name": "Bob",
        "role": "member",
    }
    res = await client.post(f"/api/companies/{account.id}/members", json=invite_payload)
    assert res.status_code == 402
    assert "Team seat limit reached" in res.json()["detail"]
