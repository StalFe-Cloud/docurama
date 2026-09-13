"""
Sprint 3 - Cloud launch surfaces.

Covers the security headers (S-1), the API 404 correctness fix (S-2),
security.txt (RFC 9116), the storage backend seam, the pub/sub bus, the honest
billing scaffold, the enterprise domain-activation flow (§18), registration
hardening (consent records), and the legal intake.
"""
import asyncio
from datetime import datetime, timezone

import pytest

from app.core import config
from app.core.security import create_access_token, get_password_hash
from app.models import (
    Account, User, AccountMembership, DomainVerification, AuditEvent,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

async def _make_user(db_session, email: str, role: str = "admin", platform_admin: bool = False):
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password=get_password_hash("a-long-enough-password-123"),
        first_name="Test",
        role=role,
        account_id=account.id,
        is_platform_admin=platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user, account


def _auth(user: User) -> dict:
    token = create_access_token(
        subject=user.id,
        claims={"purpose": "session", "role": user.role, "email": user.email,
                "account_id": user.account_id, "ver": user.token_version or 0},
    )
    return {"Authorization": f"Bearer {token}"}


def _registration_env(monkeypatch):
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")


# ---------------------------------------------------------------------------
# S-1 security headers / S-2 API 404 / security.txt
# ---------------------------------------------------------------------------

async def test_security_headers_present_on_api(client):
    resp = await client.get("/api/billing/plans")
    assert resp.status_code == 200
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in resp.headers["permissions-policy"]
    csp = resp.headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp


async def test_no_hsts_over_plain_http(client):
    resp = await client.get("/healthz")
    assert "strict-transport-security" not in {k.lower() for k in resp.headers}


async def test_hsts_over_tls_proxy_header(client):
    resp = await client.get("/healthz", headers={"X-Forwarded-Proto": "https"})
    assert resp.headers["strict-transport-security"].startswith("max-age=")


async def test_unmatched_api_path_returns_real_404(client):
    resp = await client.get("/api/not-a-route-xyz")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Not Found"}


async def test_unmatched_ws_path_returns_real_404(client):
    resp = await client.get("/ws/not-a-socket")
    assert resp.status_code == 404


async def test_security_txt_served(client):
    resp = await client.get("/.well-known/security.txt")
    assert resp.status_code == 200
    assert resp.text.startswith("Contact: ")
    assert "Expires:" in resp.text
    assert "Policy:" in resp.text


# ---------------------------------------------------------------------------
# storage backend
# ---------------------------------------------------------------------------

def test_storage_key_validation_rejects_traversal():
    from app.services.storage_backend import validate_key, StorageError

    for bad in ("../escape", "a/../../escape", "/abs", "C:\\win", "a\0b", "..", ""):
        with pytest.raises(StorageError):
            validate_key(bad)
    assert validate_key("accounts/a/envelope/b/original.pdf") == (
        "accounts/a/envelope/b/original.pdf"
    )


def test_storage_local_roundtrip_and_containment(tmp_path):
    from app.services.storage_backend import LocalBackend, StorageError

    backend = LocalBackend(root=str(tmp_path))
    handle = backend.save("org/doc.pdf", b"%PDF-1.4 test")
    assert handle == str((tmp_path / "org" / "doc.pdf").resolve())
    assert backend.open(handle) == b"%PDF-1.4 test"
    # A handle outside the root (e.g. a tampered DB row) must never read.
    with pytest.raises(StorageError):
        backend.open("/etc/passwd")
    assert backend.presign(handle) is None


def test_storage_s3_stub_roundtrip_and_presign_clamp():
    class FakeS3:
        def __init__(self):
            self.objects = {}
            self.presign_ttl = None

        def put_object(self, Bucket, Key, Body, **kwargs):
            self.objects[Key] = bytes(Body)

        def get_object(self, Bucket, Key):
            return {"Body": type("B", (), {"read": lambda self: self._d(self)})}

        def generate_presigned_url(self, op, Params, ExpiresIn):
            self.presign_ttl = ExpiresIn
            return f"https://s3.invalid/{Params['Bucket']}/{Params['Key']}"

    # make get_object's Body.read() return the stored bytes
    def _read_factory(fake, key):
        return fake.objects[key]

    fake = FakeS3()
    def get_object(self, Bucket, Key):
        data = self.objects[Key]
        return {"Body": type("B", (), {"read": staticmethod(lambda: data)})()}
    import types
    fake.get_object = types.MethodType(get_object, fake)

    from app.services.storage_backend import S3Backend
    backend = S3Backend(bucket="test-bucket", client=fake)
    handle = backend.save("org/doc.pdf", b"%PDF-1.4 s3")
    assert handle.startswith("s3://test-bucket/docurama/")
    assert backend.open(handle) == b"%PDF-1.4 s3"
    url = backend.presign(handle, ttl_seconds=99999)
    assert url.startswith("https://s3.invalid/")
    # TTL is clamped to a short window; a leaked link must expire quickly.
    assert fake.presign_ttl == 900


def test_storage_backend_selection(monkeypatch, tmp_path):
    from app.services import storage_backend as sb

    monkeypatch.setattr(config.settings, "STORAGE_BACKEND", "local")
    assert sb.get_backend().name == "local"
    monkeypatch.setattr(config.settings, "STORAGE_BACKEND", "s3")
    monkeypatch.setenv("DOCURAMA_S3_BUCKET", "some-bucket")
    assert sb.get_backend().name == "s3"
    # Unknown names fail closed to the compatible default.
    monkeypatch.setattr(config.settings, "STORAGE_BACKEND", "carrier-pigeon")
    assert sb.get_backend().name == "local"


# ---------------------------------------------------------------------------
# pub/sub
# ---------------------------------------------------------------------------

async def test_inmemory_pubsub_delivery_and_unsubscribe():
    from app.core.pubsub import InMemoryPubSub

    bus = InMemoryPubSub()
    seen = []
    unsub = bus.subscribe("ws:tok", lambda ch, m: seen.append(m) or asyncio.sleep(0))
    # callback must be awaitable
    async def cb(channel, message):
        seen.append(message)
    unsub()
    unsub2 = bus.subscribe("ws:tok", cb)
    await bus.publish("ws:tok", {"type": "SIGNATURE_PROGRESS", "progress": 50})
    await asyncio.sleep(0.05)
    assert seen == [{"type": "SIGNATURE_PROGRESS", "progress": 50}]
    unsub2()
    await bus.publish("ws:tok", {"type": "SIGNATURE_PROGRESS", "progress": 90})
    await asyncio.sleep(0.05)
    assert len(seen) == 1  # nothing delivered after unsubscribe


async def test_redis_down_degrades_without_raising():
    from app.core.pubsub import RedisPubSub

    bus = RedisPubSub(url="redis://127.0.0.1:1/0")  # nothing listens there
    async def cb(channel, message):
        pass
    bus.subscribe("ws:x", cb)
    ok = await bus.publish("ws:x", {"type": "PING"})
    assert ok is False  # degraded, not raised
    await bus.aclose()


# ---------------------------------------------------------------------------
# billing scaffold
# ---------------------------------------------------------------------------

async def test_plan_catalog_is_honest_while_unconfigured(client):
    resp = await client.get("/api/billing/plans")
    assert resp.status_code == 200
    body = resp.json()
    assert body["billing_enabled"] is False
    ids = {p["id"] for p in body["plans"]}
    assert {"plus", "business", "enterprise"} <= ids
    assert all(p["configured_price_id"] == "" for p in body["plans"])


async def test_checkout_answers_503_while_unconfigured(client, db_session):
    user, _ = await _make_user(db_session, "buyer@example.com")
    resp = await client.post("/api/billing/checkout", json={"plan": "plus"}, headers=_auth(user))
    assert resp.status_code == 503
    assert "STRIPE" in resp.json()["detail"]


async def test_subscription_state_reflects_account(client, db_session):
    user, account = await _make_user(db_session, "subbed@example.com")
    resp = await client.get("/api/billing/subscription", headers=_auth(user))
    assert resp.status_code == 200
    body = resp.json()
    assert body["billing_enabled"] is False
    assert body["is_trial"] is False


async def test_webhook_refuses_unsigned_payload_when_configured(client, monkeypatch):
    monkeypatch.setattr(config.settings, "STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(config.settings, "STRIPE_WEBHOOK_SECRET", "whsec_dummy")
    resp = await client.post(
        "/api/billing/webhook",
        content=b'{"type": "customer.subscription.updated"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400  # no stripe-signature header, no processing


async def test_webhook_answers_503_while_unconfigured(client):
    resp = await client.post("/api/billing/webhook", content=b"{}", headers={
        "Content-Type": "application/json", "stripe-signature": "t=1,v1=x"})
    assert resp.status_code == 503


def test_stripe_event_mapping_is_pure():
    from app.services.billing import map_stripe_event

    attach = map_stripe_event({"type": "checkout.session.completed", "data": {"object": {
        "customer": "cus_1", "subscription": "sub_1",
        "metadata": {"account_id": "acc1", "plan": "business"}}}})
    assert attach["action"] == "attach_customer"
    assert attach["customer_id"] == "cus_1"

    sync = map_stripe_event({"type": "customer.subscription.updated", "data": {"object": {
        "cancel_at_period_end": True, "current_period_end": 1767225600,
        "items": {"data": [{"price": {"id": "price_business"}}]}}}})
    assert sync["action"] == "sync_subscription"
    assert sync["cancel_at_period_end"] is True
    from datetime import datetime as dt
    assert sync["current_period_end"] == dt.fromtimestamp(1767225600, tz=timezone.utc)

    assert map_stripe_event({"type": "invoice.paid"}) == {"action": "ignore"}
    assert map_stripe_event({}) == {"action": "ignore"}


def test_unconfigured_adapter_raises_billing_not_configured(monkeypatch):
    from app.services.billing import StripeAdapter, BillingNotConfigured

    monkeypatch.setattr(config.settings, "STRIPE_SECRET_KEY", "")
    monkeypatch.setattr(config.settings, "STRIPE_WEBHOOK_SECRET", "")
    adapter = StripeAdapter()
    with pytest.raises(BillingNotConfigured):
        adapter._stripe()
    with pytest.raises(BillingNotConfigured):
        adapter.verify_webhook(payload=b"x", signature="y")


# ---------------------------------------------------------------------------
# enterprise domain activation (§18)
# ---------------------------------------------------------------------------

async def _seed_joinable_domain(db_session, domain: str, join_mode: str):
    account = Account(name=f"{domain} workspace")
    db_session.add(account)
    await db_session.flush()
    db_session.add(DomainVerification(
        account_id=account.id,
        domain=domain,
        status="verified",
        verification_token="tok-123",
        verification_method="dns_txt",
        txt_record_host="_docurama." + domain,
        txt_record_value="docurama-verification=tok-123",
        cname_record_host="sign." + domain,
        join_mode=join_mode,
        verified_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()
    return account


async def test_domain_join_end_to_end(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    await _seed_joinable_domain(db_session, "join-e2e.example.com", "auto_join")

    resp = await client.post("/api/auth/register", json={
        "email": "newhire@join-e2e.example.com",
        "password": "a-long-enough-password-123",
        "first_name": "New", "last_name": "Hire",
        "age_gate_confirmed": True,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending_activation"
    assert body["join_mode"] == "auto_join"
    token = body["activation_token"]
    assert token

    # Pending accounts are refused at login even with the right password.
    blocked = await client.post("/api/auth/login", json={
        "email": "newhire@join-e2e.example.com", "password": "a-long-enough-password-123"})
    assert blocked.status_code == 403

    # Activation confirms the email and grants membership (auto_join).
    activated = await client.post("/api/auth/domain-join/activate", json={"token": token})
    assert activated.status_code == 200
    assert activated.json()["membership"] == "active"

    # Single-use: a replayed token fails even inside its validity window.
    replay = await client.post("/api/auth/domain-join/activate", json={"token": token})
    assert replay.status_code == 400
    assert "already been used" in replay.json()["detail"]

    # A normal session now works.
    session = await client.post("/api/auth/login", json={
        "email": "newhire@join-e2e.example.com", "password": "a-long-enough-password-123"})
    assert session.status_code == 200


async def test_join_token_is_never_a_session(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    await _seed_joinable_domain(db_session, "tokonly.example.com", "auto_join")
    resp = await client.post("/api/auth/register", json={
        "email": "tok@tokonly.example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": True,
    })
    token = resp.json()["activation_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 401  # purpose=domain_join is not a session purpose


async def test_join_mode_requires_verified_domain(client, db_session):
    user, account = await _make_user(db_session, "owner@vmode.example.com")
    db_session.add(AccountMembership(user_id=user.id, account_id=account.id,
                                     role="admin", is_active=True))
    domain = DomainVerification(
        account_id=account.id, domain="unverified.example.com", status="pending",
        verification_token="tok-2",
        txt_record_host="_docurama.unverified.example.com", txt_record_value="v",
        cname_record_host="sign.unverified.example.com",
    )
    db_session.add(domain)
    await db_session.commit()

    resp = await client.post(f"/api/domains/{domain.id}/join-mode",
                             json={"mode": "auto_join"}, headers=_auth(user))
    assert resp.status_code == 403
    assert "verified" in resp.json()["detail"]


async def test_join_mode_rejects_unknown_values(client, db_session):
    user, account = await _make_user(db_session, "owner@vmode2.example.com")
    db_session.add(AccountMembership(user_id=user.id, account_id=account.id,
                                     role="admin", is_active=True))
    domain = DomainVerification(
        account_id=account.id, domain="mode.example.com", status="verified",
        verification_token="tok-3",
        txt_record_host="_docurama.mode.example.com", txt_record_value="v",
        cname_record_host="sign.mode.example.com",
        verified_at=datetime.now(timezone.utc),
    )
    db_session.add(domain)
    await db_session.commit()
    resp = await client.post(f"/api/domains/{domain.id}/join-mode",
                             json={"mode": "self_serve_everyone"}, headers=_auth(user))
    assert resp.status_code == 422


async def test_approval_mode_queues_and_admin_approves(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    owner, account = await _make_user(db_session, "boss@approval.example.com")
    # the owner must be a member of the SAME account the domain belongs to
    account2 = await _seed_joinable_domain(db_session, "approval.example.com", "approval")
    owner.account_id = account2.id
    owner.role = "admin"
    db_session.add(AccountMembership(user_id=owner.id, account_id=account2.id,
                                     role="admin", is_active=True))
    await db_session.commit()

    resp = await client.post("/api/auth/register", json={
        "email": "waiter@approval.example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": True,
    })
    body = resp.json()
    assert body["join_mode"] == "approval"
    token = body["activation_token"]

    activated = await client.post("/api/auth/domain-join/activate", json={"token": token})
    assert activated.status_code == 200
    assert activated.json()["membership"] == "pending_approval"

    queue = await client.get("/api/domains/joins/pending", headers=_auth(owner))
    assert queue.status_code == 200
    pending = [j for j in queue.json() if j["user_email"] == "waiter@approval.example.com"]
    assert len(pending) == 1

    approve = await client.post(f"/api/domains/joins/{pending[0]['id']}/approve",
                                headers=_auth(owner))
    assert approve.status_code == 200
    assert approve.json()["status"] == "approved"


# ---------------------------------------------------------------------------
# registration hardening: consent records (GDPR Art. 7)
# ---------------------------------------------------------------------------

async def test_marketing_consent_recorded_with_timestamp(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    resp = await client.post("/api/auth/register", json={
        "email": "consent-yes@example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": True,
        "marketing_consent": True,
    })
    assert resp.status_code == 200
    from sqlalchemy.future import select as fut_select
    row = (await db_session.execute(
        fut_select(User).where(User.email == "consent-yes@example.com")
    )).scalar_one()
    assert row.marketing_consent is True
    assert row.marketing_consent_at is not None


async def test_marketing_consent_absent_means_no_consent(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    resp = await client.post("/api/auth/register", json={
        "email": "consent-no@example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": True,
    })
    assert resp.status_code == 200
    from sqlalchemy.future import select as fut_select
    row = (await db_session.execute(
        fut_select(User).where(User.email == "consent-no@example.com")
    )).scalar_one()
    assert row.marketing_consent is False
    assert row.marketing_consent_at is None


# ---------------------------------------------------------------------------
# legal intake
# ---------------------------------------------------------------------------

async def test_dmca_intake_accepts_verbatim_statement(client):
    resp = await client.post("/api/legal/dmca", json={
        "kind": "dmca",
        "reporter_name": "Rights Holder",
        "reporter_email": "rh@example.com",
        "content_location": "https://example.com/infringing-doc",
        "original_work_reference": "My registered work, certificate #12345",
        "description": "The linked document reproduces my work without authorisation.",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "dmca"
    assert body["status"] == "pending"
    assert body["sla"] == "5 business days"


async def test_take_it_down_intake_carries_48h_sla(client):
    resp = await client.post("/api/legal/dmca", json={
        "kind": "take_it_down",
        "reporter_name": "Depicted Person",
        "reporter_email": "dp@example.com",
        "content_location": "verification code AB12CD34",
        "original_work_reference": "I am the individual depicted",
        "description": "I demand removal of the material depicting me without consent.",
    })
    assert resp.status_code == 201
    assert resp.json()["sla"] == "48 hours"


async def test_legal_intake_rejects_unknown_kind(client):
    resp = await client.post("/api/legal/dmca", json={
        "kind": "angry_petition",
        "reporter_name": "Anyone",
        "reporter_email": "a@example.com",
        "content_location": "somewhere",
        "original_work_reference": "something of mine",
        "description": "This is my complaint in enough detail.",
    })
    assert resp.status_code == 422


async def test_legal_queue_is_platform_admin_only(client, db_session):
    user, _ = await _make_user(db_session, "plain@queue.test")
    resp = await client.get("/api/legal/notices", headers=_auth(user))
    assert resp.status_code == 403
    admin, _ = await _make_user(db_session, "admin@queue.test", platform_admin=True)
    resp = await client.get("/api/legal/notices", headers=_auth(admin))
    assert resp.status_code == 200
