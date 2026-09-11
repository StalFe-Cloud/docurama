"""
Regression lock on tenant isolation for the core listings.

Each test seeds two accounts with data, signs in as one, and asserts the other
account's rows are invisible. If one of these fails, an endpoint lost its
account filter and that is a data boundary breach, not a cosmetic bug.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, Envelope, Template, User

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def two_accounts(db_session, tmp_path):
    acme = Account(name="Acme")
    globex = Account(name="Globex")
    db_session.add_all([acme, globex])
    await db_session.flush()

    # The login schema validates EmailStr, which rejects the reserved .test TLD,
    # so the seeded users use the documentation .example TLD like the rest of the suite.
    alice = User(account_id=acme.id, email="alice@acme.example",
                 hashed_password=get_password_hash(PASSWORD), role="admin", is_active=True)
    bob = User(account_id=globex.id, email="bob@globex.example",
               hashed_password=get_password_hash(PASSWORD), role="admin", is_active=True)
    db_session.add_all([alice, bob])
    await db_session.flush()
    db_session.add_all([
        AccountMembership(user_id=alice.id, account_id=acme.id, role="owner"),
        AccountMembership(user_id=bob.id, account_id=globex.id, role="owner"),
    ])

    acme_envelope = Envelope(
        account_id=acme.id, created_by_user_id=alice.id, title="Acme NDA",
        status="draft", original_pdf_path=str(tmp_path / "acme.pdf"),
    )
    globex_envelope = Envelope(
        account_id=globex.id, created_by_user_id=bob.id, title="Globex NDA",
        status="draft", original_pdf_path=str(tmp_path / "globex.pdf"),
    )
    acme_template = Template(account_id=acme.id, title="Acme template")
    globex_template = Template(account_id=globex.id, title="Globex template")
    db_session.add_all([acme_envelope, globex_envelope, acme_template, globex_template])
    await db_session.commit()
    return acme, globex, alice, bob


async def _login(client, email):
    resp = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


async def test_envelope_listing_is_account_scoped(client, two_accounts):
    acme, globex, alice, bob = two_accounts
    await _login(client, "alice@acme.example")
    resp = await client.get("/api/envelopes")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Acme NDA" in titles
    assert "Globex NDA" not in titles


async def test_template_listing_is_account_scoped(client, two_accounts):
    acme, globex, alice, bob = two_accounts
    await _login(client, "bob@globex.example")
    resp = await client.get("/api/templates")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Globex template" in titles
    assert "Acme template" not in titles


async def test_cross_account_envelope_fetch_is_not_found(client, two_accounts):
    acme, globex, alice, bob = two_accounts
    await _login(client, "bob@globex.example")
    target = (await client.get("/api/envelopes")).json()[0]["id"]
    await client.post("/api/auth/logout")
    await _login(client, "alice@acme.example")
    resp = await client.get(f"/api/envelopes/{target}")
    assert resp.status_code == 404
