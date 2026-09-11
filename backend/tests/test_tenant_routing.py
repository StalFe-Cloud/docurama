"""
Tenant routing end to end: host headers resolve to tenants, unknown tenants get
404, and a session bound to account A cannot read account B by pointing a
request at B's hostname.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, Envelope, Template, User

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def two_tenant_world(db_session):
    acme = Account(name="Acme", subdomain="acme")
    globex = Account(name="Globex", subdomain="globex")
    db_session.add_all([acme, globex])
    await db_session.flush()

    alice = User(account_id=acme.id, email="alice@example.com",
                 hashed_password=get_password_hash(PASSWORD), role="admin",
                 is_active=True)
    bob = User(account_id=globex.id, email="bob@example.com",
               hashed_password=get_password_hash(PASSWORD), role="admin",
               is_active=True)
    db_session.add_all([alice, bob])
    await db_session.flush()
    db_session.add_all([
        AccountMembership(user_id=alice.id, account_id=acme.id, role="owner"),
        AccountMembership(user_id=bob.id, account_id=globex.id, role="owner"),
    ])
    acme_env = Envelope(account_id=acme.id, created_by_user_id=alice.id,
                        title="Acme Secret", status="draft",
                        original_pdf_path="/tmp/acme.pdf")
    globex_env = Envelope(account_id=globex.id, created_by_user_id=bob.id,
                          title="Globex Secret", status="draft",
                          original_pdf_path="/tmp/globex.pdf")
    db_session.add_all([acme_env, globex_env])
    await db_session.commit()
    return acme, globex, acme_env, globex_env


async def _login(client, email):
    resp = await client.post("/api/auth/login",
                             json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


async def test_middleware_records_host_on_state(client):
    # The probe uses a unique path and stays registered on the shared app on
    # purpose: Starlette appends routes, so the brief's routes.pop(0) would
    # remove the app's first real route rather than the probe. Asserting on the
    # response body keeps the check self-contained.
    from fastapi import Request

    from app.main import app

    if not any(getattr(r, "path", None) == "/api/_tenant_probe"
               for r in app.router.routes):

        @app.get("/api/_tenant_probe")
        async def probe(request: Request):
            return {"host": getattr(request.state, "tenant_host", None)}

    resp = await client.get("/api/_tenant_probe",
                            headers={"Host": "acme.docurama.eu"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["host"] == "acme.docurama.eu"


async def test_unknown_tenant_gets_404(client, db_session, two_tenant_world, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    _, _, _, globex_env = two_tenant_world
    await _login(client, "bob@example.com")
    resp = await client.get(f"/api/envelopes/{globex_env.id}",
                            headers={"Host": "ghost.docurama.eu"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Unknown workspace."


async def test_cross_tenant_host_is_403(client, db_session, two_tenant_world,
                                        monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    _, _, acme_env, _ = two_tenant_world
    await _login(client, "bob@example.com")  # Globex session
    resp = await client.get(f"/api/envelopes/{acme_env.id}",
                            headers={"Host": "acme.docurama.eu"})
    assert resp.status_code == 403


async def test_own_tenant_host_passes(client, db_session, two_tenant_world,
                                      monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    _, _, _, globex_env = two_tenant_world
    await _login(client, "bob@example.com")
    resp = await client.get(f"/api/envelopes/{globex_env.id}",
                            headers={"Host": "globex.docurama.eu"})
    assert resp.status_code == 200


async def test_platform_host_never_raises(client, db_session, two_tenant_world,
                                          monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    _, _, _, globex_env = two_tenant_world
    await _login(client, "bob@example.com")
    resp = await client.get(f"/api/envelopes/{globex_env.id}",
                            headers={"Host": "app.docurama.eu"})
    assert resp.status_code == 200


async def test_selfhost_mode_ignores_host_entirely(client, db_session,
                                                   two_tenant_world):
    from app.core import config

    assert config.settings.DEPLOYMENT_MODE == "selfhost"  # the default
    _, _, acme_env, _ = two_tenant_world
    await _login(client, "alice@example.com")
    resp = await client.get(f"/api/envelopes/{acme_env.id}",
                            headers={"Host": "anything.example"})
    # Alice's own envelope must come back: an arbitrary host is not a workspace
    # boundary here, and if tenant routing ever leaked into self-host this host
    # would resolve to unknown and turn this same request into a 404.
    assert resp.status_code == 200


def test_cloud_cors_regex_covers_tenant_hosts():
    from app.main import build_cors_policy
    from app.core import config

    monkeysettings = config.settings
    original_mode, original_url = monkeysettings.DEPLOYMENT_MODE, monkeysettings.APP_URL
    try:
        monkeysettings.DEPLOYMENT_MODE = "cloud"
        monkeysettings.APP_URL = "https://app.docurama.eu"
        origins, regex = build_cors_policy(monkeysettings)
        assert regex is not None
        assert regex.fullmatch("https://acme.docurama.eu")
        assert regex.fullmatch("https://app.docurama.eu")
        assert not regex.fullmatch("https://acme.docurama.eu.evil.io")
        assert origins == []  # cloud relies on the regex plus credentials
    finally:
        monkeysettings.DEPLOYMENT_MODE = original_mode
        monkeysettings.APP_URL = original_url


def test_selfhost_cors_keeps_the_fixed_list():
    from app.main import build_cors_policy
    from app.core.config import settings

    origins, regex = build_cors_policy(settings)
    assert regex is None
    assert "http://localhost:3000" in origins
