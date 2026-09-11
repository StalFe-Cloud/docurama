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
