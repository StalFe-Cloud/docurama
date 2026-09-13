import pytest

from app.core import config


@pytest.fixture
def registration_env(monkeypatch, tmp_path):
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    monkeypatch.delenv("DOCURAMA_PUBLIC_REGISTRATION", raising=False)
    config.settings.registration_open  # property reads env lazily; nothing to prime
    return None


async def test_registration_closed_on_selfhost(client, registration_env):
    resp = await client.post("/api/auth/register", json={
        "email": "newuser@example.com",
        "password": "a-long-enough-password-123",
        "first_name": "New",
    })
    assert resp.status_code == 403
    assert "Registration is closed" in resp.json()["detail"]


async def test_registration_open_flag_allows_signup(client, registration_env, monkeypatch):
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")
    resp = await client.post("/api/auth/register", json={
        "email": "newuser@example.com",
        "password": "a-long-enough-password-123",
        "first_name": "New",
        # Sprint 3: registration carries the age statement; consent fields are
        # optional and default to a truthful "no".
        "age_gate_confirmed": True,
    })
    assert resp.status_code == 200


async def test_registration_rejects_short_password(client, registration_env, monkeypatch):
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")
    resp = await client.post("/api/auth/register", json={
        "email": "short@example.com",
        "password": "short",
        "first_name": "Short",
    })
    assert resp.status_code == 422


async def test_cloud_mode_refuses_registration_from_tenant_hosts(client, registration_env,
                                                                  db_session, monkeypatch):
    from app.core import config
    from app.models import Account

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    db_session.add(Account(name="Acme", subdomain="acme"))
    await db_session.commit()

    resp = await client.post("/api/auth/register", json={
        "email": "stray@example.com",
        "password": "a-long-enough-password-123",
    }, headers={"Host": f"acme.{config.settings.CLOUD_DOMAIN}"})
    assert resp.status_code == 403
    assert f"app.{config.settings.CLOUD_DOMAIN}" in resp.json()["detail"]


async def test_cloud_mode_allows_registration_on_platform_hosts(client, registration_env,
                                                                 monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    monkeypatch.setattr(config.settings, "APP_URL", f"https://app.{config.settings.CLOUD_DOMAIN}")
    resp = await client.post("/api/auth/register", json={
        "email": "legit@example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": True,
    }, headers={"Host": f"app.{config.settings.CLOUD_DOMAIN}"})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Sprint 3 — neutral age gate (P1-7). The gate records a statement; the
# operator can switch it off where even the statement is wrong to ask.
# ---------------------------------------------------------------------------

async def test_age_gate_blocks_unconfirmed_signup(client, registration_env, monkeypatch):
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")
    resp = await client.post("/api/auth/register", json={
        "email": "gateblock@example.com",
        "password": "a-long-enough-password-123",
        # age_gate_confirmed omitted -> the statement was never made
    })
    assert resp.status_code == 400
    assert "age statement" in resp.json()["detail"]


async def test_age_gate_is_operator_disableable(client, registration_env, monkeypatch):
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")
    monkeypatch.setattr(config.settings, "AGE_GATE_REQUIRED", False)
    resp = await client.post("/api/auth/register", json={
        "email": "gateoff@example.com",
        "password": "a-long-enough-password-123",
        # no age_gate_confirmed, but the gate is off
    })
    assert resp.status_code == 200


async def test_age_gate_false_confirmed_is_not_accepted(client, registration_env, monkeypatch):
    """A false confirmation is not a confirmation: the statement must be true."""
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")
    resp = await client.post("/api/auth/register", json={
        "email": "gatefalse@example.com",
        "password": "a-long-enough-password-123",
        "age_gate_confirmed": False,
    })
    assert resp.status_code == 400
