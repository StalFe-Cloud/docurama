"""
Subdomain rules: in cloud mode the subdomain becomes a routable hostname, so it
must be a safe label, never a platform host, and never a collision.
"""
import pytest


def test_accepts_a_normal_label():
    from app.services.tenancy import subdomain_error

    assert subdomain_error("acme") is None
    assert subdomain_error("acme-eu") is None


def test_rejects_reserved_platform_hosts():
    from app.services.tenancy import subdomain_error

    for reserved in ("www", "app", "api", "admin", "staging"):
        assert subdomain_error(reserved) is not None


def test_rejects_bad_shapes():
    from app.services.tenancy import subdomain_error

    for bad in ("", "a", "-lead", "trail-", "has.dots", "has space", "UPPER", "x" * 41):
        assert subdomain_error(bad) is not None, bad


async def test_create_company_rejects_reserved_subdomain(client, db_session):
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    account = Account(name="Seed")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "owner@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies", json={"name": "Acme", "subdomain": "api"})
    assert resp.status_code == 400
    assert "reserved" in resp.json()["detail"]


async def test_create_company_rejects_taken_subdomain(client, db_session):
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    account = Account(name="Seed", subdomain="taken-name")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner2@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "owner2@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies",
                             json={"name": "Acme", "subdomain": "taken-name"})
    assert resp.status_code == 409
    assert "already taken" in resp.json()["detail"]


async def test_create_company_autogenerates_when_subdomain_absent(client, db_session):
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    account = Account(name="Seed")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner3@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "owner3@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies", json={"name": "Globex"})
    assert resp.status_code == 200
    assert resp.json()["subdomain"]


@pytest.mark.parametrize("candidate", ["Good-name", "  Good-name  "])
def test_normalization_is_not_the_caller_problem(candidate):
    from app.services.tenancy import subdomain_error

    # Callers may pass loosely; validation judges the normalized form.
    assert subdomain_error(candidate.strip().lower()) is None


async def test_autogen_subdomain_never_violates_the_rules(client, db_session,
                                                          monkeypatch):
    from app.api import companies as companies_api
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User
    from app.services.tenancy import subdomain_error

    # A company name that slugifies to nothing must not produce an invalid label.
    monkeypatch.setattr(companies_api, "slugify", lambda text: "")
    account = Account(name="Seed")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="autogen@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "autogen@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies", json={"name": "!!!"})
    assert resp.status_code == 200
    generated = resp.json()["subdomain"]
    assert subdomain_error(generated) is None


async def test_subdomain_race_returns_409(client, db_session, monkeypatch):
    from app.api import companies as companies_api
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    account = Account(name="Seed", subdomain="race-name")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="racer@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()

    # Simulate the race: the availability pre-check passes (the rival row was not
    # visible yet), then the insert hits the unique constraint on commit.
    async def available(db, candidate):
        return True
    monkeypatch.setattr(companies_api, "subdomain_available", available)

    login = await client.post("/api/auth/login",
                              json={"email": "racer@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies", json={"name": "Rival",
                                                     "subdomain": "race-name"})
    assert resp.status_code == 409
