import pytest
from sqlalchemy.future import select

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, DomainVerification, User


@pytest.fixture
async def member_and_admin(db_session):
    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    admin = User(account_id=account.id, email="admin@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    member = User(account_id=account.id, email="member@example.com",
                  hashed_password=get_password_hash("a-long-password-1234"),
                  role="member", is_active=True)
    db_session.add_all([admin, member])
    await db_session.flush()
    db_session.add_all([
        AccountMembership(user_id=admin.id, account_id=account.id, role="admin"),
        AccountMembership(user_id=member.id, account_id=account.id, role="member"),
    ])
    domain = DomainVerification(
        account_id=account.id, domain="acme.example", status="verified",
        verification_token="dcr_vfy_abc123", verification_method="dns_txt",
        txt_record_host="_docurama-challenge.acme.example",
        txt_record_value="docurama-verification=dcr_vfy_abc123",
        cname_record_host="docurama.acme.example", cname_target="docurama.stalfe.com",
    )
    db_session.add(domain)
    await db_session.commit()
    return account, admin, member, domain


@pytest.fixture
async def owner_with_membership(db_session):
    account = Account(name="Owner Co")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner@ownerco.example",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="owner", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()
    return account, owner


async def _login(client, email, password="a-long-password-1234"):
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_member_cannot_toggle_domain_enforcement(client, member_and_admin):
    account, admin, member, domain = member_and_admin
    await _login(client, "member@example.com")
    resp = await client.post(f"/api/domains/{domain.id}/toggle-enforcement")
    assert resp.status_code == 403


async def test_admin_can_toggle_domain_enforcement(client, member_and_admin):
    account, admin, member, domain = member_and_admin
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/domains/{domain.id}/toggle-enforcement")
    assert resp.status_code == 200
    assert resp.json()["enforce_domain_auth"] is True


async def test_validate_authentication_requires_session(client, member_and_admin):
    resp = await client.post("/api/domains/validate-authentication",
                             json={"email": "someone@acme.example"})
    assert resp.status_code == 401


async def test_validate_authentication_never_returns_the_token(client, member_and_admin):
    await _login(client, "member@example.com")
    resp = await client.post("/api/domains/validate-authentication",
                             json={"email": "someone@acme.example"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_authenticated"] is True
    assert "verification_token" not in body


async def test_public_status_reveals_no_organization(client, member_and_admin):
    resp = await client.get("/api/domains/status/acme.example")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"domain": "acme.example", "is_verified": True}


async def test_create_domain_registers_pending_domain(client, owner_with_membership):
    account, owner = owner_with_membership
    await _login(client, "owner@ownerco.example")
    resp = await client.post("/api/domains", json={"domain": "acme.example"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["domain"] == "acme.example"
    assert body["status"] == "pending"
