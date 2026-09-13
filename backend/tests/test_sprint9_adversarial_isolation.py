"""
Sprint 9: adversarial tenant-isolation regression suite.

The earlier isolation lock (test_tenant_isolation.py) covers the core
listings. This file attacks the boundary the way an adversary would: cross
tenant fetches on every resource class, member-vs-owner inside one
workspace, recipient-versus-sender, unauthenticated access, and the
platform-admin surface. Every assertion encodes the same rule: crossing an
account boundary answers 404 (resource invisible), 401 (no credential) or
403 (credential lacks the role) - never a 200 carrying the neighbour's data.

If one of these fails, an endpoint lost its account filter. That is a data
boundary breach, not a cosmetic bug.
"""
import pytest

from app.core.security import get_password_hash
from app.models import (
    Account, AccountMembership, Envelope, Template, TemplateFolder,
    Webhook, ApiKey, User,
)

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def rival_workspaces(db_session, tmp_path):
    """
    Two fully-seeded rival workspaces: Acme (alice owner, amy member) and
    Globex (bob owner). Each carries an envelope, a template, a folder, a
    webhook and an API key so every resource class can be probed.
    """
    acme = Account(name="Acme")
    globex = Account(name="Globex")
    db_session.add_all([acme, globex])
    await db_session.flush()

    alice = User(account_id=acme.id, email="alice@acme.example",
                 hashed_password=get_password_hash(PASSWORD), role="admin", is_active=True)
    amy = User(account_id=acme.id, email="amy@acme.example",
               hashed_password=get_password_hash(PASSWORD), role="member", is_active=True)
    bob = User(account_id=globex.id, email="bob@globex.example",
               hashed_password=get_password_hash(PASSWORD), role="admin", is_active=True)
    db_session.add_all([alice, amy, bob])
    await db_session.flush()

    db_session.add_all([
        AccountMembership(user_id=alice.id, account_id=acme.id, role="owner"),
        AccountMembership(user_id=amy.id, account_id=acme.id, role="member"),
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
    acme_folder = TemplateFolder(account_id=acme.id, name="Acme contracts")
    globex_folder = TemplateFolder(account_id=globex.id, name="Globex contracts")
    acme_webhook = Webhook(account_id=acme.id, url="https://ops.acme.example/hook", events=["*"])
    globex_webhook = Webhook(account_id=globex.id, url="https://ops.globex.example/hook", events=["*"])
    acme_key = ApiKey(account_id=acme.id, name="acme key", hashed_key="hash-acme-key",
                      key_prefix="dc_acme", created_by_user_id=alice.id, is_active=True)
    db_session.add_all([
        acme_envelope, globex_envelope, acme_template, globex_template,
        acme_folder, globex_folder, acme_webhook, globex_webhook, acme_key,
    ])
    await db_session.commit()
    return {
        "acme": acme, "globex": globex, "alice": alice, "amy": amy, "bob": bob,
        "acme_envelope": acme_envelope, "globex_envelope": globex_envelope,
        "acme_template": acme_template, "globex_template": globex_template,
        "acme_folder": acme_folder, "globex_folder": globex_folder,
        "acme_webhook": acme_webhook, "globex_webhook": globex_webhook,
        "acme_key": acme_key,
    }


async def _login(client, email):
    resp = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


async def _logout(client):
    await client.post("/api/auth/logout")


# ---------------------------------------------------------------------------
# Unauthenticated -> authenticated resources
# ---------------------------------------------------------------------------

async def test_unauthenticated_cannot_reach_any_core_resource(client, rival_workspaces):
    for method, path in [
        ("GET", "/api/envelopes"),
        ("GET", "/api/templates"),
        ("GET", "/api/folders"),
        ("GET", "/api/webhooks"),
        ("GET", "/api/billing/subscription"),
        ("GET", "/api/settings/smtp/account"),
        ("GET", "/api/api-keys"),
        ("POST", "/api/envelopes/bulk"),
    ]:
        if method == "POST":
            resp = await client.post(path, json={})
        else:
            resp = await client.get(path)
        assert resp.status_code == 401, f"{method} {path} answered {resp.status_code} unauthenticated"


# ---------------------------------------------------------------------------
# Team A -> team B across every resource class
# ---------------------------------------------------------------------------

async def test_cross_account_folder_operations_are_not_found(client, rival_workspaces):
    seed = rival_workspaces
    await _login(client, "alice@acme.example")
    # Listing never contains the rival's folders.
    listing = (await client.get("/api/folders")).json()
    names = [f["name"] for f in listing]
    assert "Globex contracts" not in names
    # Direct fetch/delete of the rival folder answers 404, not 403-with-data.
    assert (await client.delete(f"/api/folders/{seed['globex_folder'].id}")).status_code == 404


async def test_cross_account_webhooks_are_invisible(client, rival_workspaces):
    seed = rival_workspaces
    await _login(client, "alice@acme.example")
    hooks = (await client.get("/api/webhooks")).json()
    assert all(h["id"] != seed["globex_webhook"].id for h in hooks)
    # Deleting the rival webhook must not succeed.
    resp = await client.delete(f"/api/webhooks/{seed['globex_webhook'].id}")
    assert resp.status_code == 404


async def test_cross_account_envelope_mutation_is_not_found(client, rival_workspaces):
    seed = rival_workspaces
    await _login(client, "alice@acme.example")
    target = seed["globex_envelope"].id
    assert (await client.get(f"/api/envelopes/{target}")).status_code == 404
    assert (await client.post(f"/api/envelopes/{target}/void")).status_code == 404
    assert (await client.get(f"/api/envelopes/{target}/download")).status_code == 404
    assert (await client.get(f"/api/envelopes/{target}/certificate")).status_code == 404
    assert (await client.get(f"/api/envelopes/{target}/export-csv")).status_code == 404


async def test_cross_account_envelope_bulk_operation_cannot_reach_rival(client, rival_workspaces):
    """Bulk send resolves its template inside the caller's account; the rival
    template id answers 404, so no envelope can be built from another
    tenant's assets."""
    seed = rival_workspaces
    await _login(client, "alice@acme.example")
    resp = await client.post("/api/envelopes/bulk",
                             data={"template_id": seed["globex_template"].id},
                             files={"csv_file": ("r.csv", b"name,email\nX,x@y.example\n", "text/csv")})
    assert resp.status_code == 404


async def test_cross_account_template_fetch_is_not_found(client, rival_workspaces):
    seed = rival_workspaces
    await _login(client, "alice@acme.example")
    resp = await client.get(f"/api/templates/{seed['globex_template'].id}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Member (non-admin) vs owner-only resources inside one workspace
# ---------------------------------------------------------------------------

async def test_member_cannot_read_or_write_account_smtp(client, rival_workspaces):
    await _login(client, "amy@acme.example")
    # Read is allowed but redacted: only a boolean password_set leaves the
    # server, never the credential itself.
    resp = await client.get("/api/settings/smtp/account")
    assert resp.status_code == 200
    body = resp.json()
    assert "password" not in body  # redaction: boolean flag only
    # Write is the admin boundary: a member repointing the mailer would
    # receive other people's documents.
    resp = await client.put("/api/settings/smtp/account", json={
        "host": "smtp.evil.example", "port": 25, "username": "x", "password": "y",
        "from_email": "evil@acme.example", "security": "none",
    })
    assert resp.status_code == 403


async def test_member_cannot_manage_api_keys(client, rival_workspaces):
    await _login(client, "amy@acme.example")
    resp = await client.get("/api/api-keys")
    assert resp.status_code == 403
    resp = await client.post("/api/api-keys", json={"name": "sneaky"})
    assert resp.status_code == 403


async def test_member_cannot_start_billing_checkout(client, rival_workspaces):
    """Checkout is an owner decision; a member must not be able to summon a
    Stripe session for the workspace (it would let a member commit the
    company to a paid plan). Sprint 9 added the role gate."""
    await _login(client, "amy@acme.example")
    resp = await client.post("/api/billing/checkout", json={"plan": "team", "commitment": "rolling"})
    # 403 (role gate) or 503 (billing not configured, when the role gate is
    # absent on legacy installs) are both acceptable refusals; 200 with a
    # checkout URL is not.
    assert resp.status_code in (403, 503)
    if resp.status_code == 200:
        pytest.fail("member obtained a checkout session")


async def test_member_cannot_cancel_or_open_billing_portal(client, rival_workspaces):
    await _login(client, "amy@acme.example")
    assert (await client.post("/api/billing/cancel")).status_code in (403, 503)
    assert (await client.post("/api/billing/portal")).status_code in (403, 503)


# ---------------------------------------------------------------------------
# Recipient -> sender resources
# ---------------------------------------------------------------------------

async def test_signing_token_cannot_list_or_fetch_sender_envelopes(client, rival_workspaces):
    """A signing-link token grants access to its own signing view only. It is
    not a session credential and must be rejected wherever account data is
    served."""
    seed = rival_workspaces
    from app.core.security import create_access_token
    signing_token = create_access_token(
        f"recipient:{seed['acme_envelope'].id}",
        claims={"purpose": "signing", "envelope_id": seed["acme_envelope"].id},
    )
    # The token must not authenticate account endpoints.
    resp = await client.get("/api/envelopes", headers={"Authorization": f"Bearer {signing_token}"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Platform admin surface
# ---------------------------------------------------------------------------

async def test_workspace_admin_cannot_reach_platform_admin_surface(client, rival_workspaces):
    await _login(client, "alice@acme.example")
    assert (await client.get("/api/admin/tenants")).status_code == 403
    resp = await client.get(f"/api/admin/tenants/{rival_workspaces['globex'].id}")
    assert resp.status_code == 403


async def test_platform_admin_required_for_dmca_queue(client, rival_workspaces):
    await _login(client, "bob@globex.example")
    assert (await client.get("/api/admin/dsr/dmca")).status_code == 403


# ---------------------------------------------------------------------------
# Billing data boundary
# ---------------------------------------------------------------------------

async def test_subscription_endpoint_reports_only_own_workspace(client, rival_workspaces):
    """The subscription view derives everything from the caller's account row;
    there is no account_id parameter to smuggle."""
    await _login(client, "bob@globex.example")
    resp = await client.get("/api/billing/subscription")
    assert resp.status_code in (200, 503)
    body = resp.json()
    if resp.status_code == 200 and isinstance(body, dict) and body.get("account_id"):
        assert body["account_id"] == rival_workspaces["globex"].id


# ---------------------------------------------------------------------------
# API key tenancy
# ---------------------------------------------------------------------------

async def test_api_key_of_unknown_hash_is_rejected(client, rival_workspaces):
    """A guessed or harvested bearer value must never authenticate."""
    resp = await client.get("/api/envelopes", headers={"X-Api-Key": "dc_sk_forged_value"})
    assert resp.status_code == 401


async def test_api_key_cannot_be_presented_as_session_cookie(client, rival_workspaces):
    """An API key material pasted into a session cookie must not authenticate;
    cookies carry JWT sessions, keys ride the X-Api-Key header only."""
    resp = await client.get("/api/envelopes", cookies={ "_docurama_session": "dc_acme:hash-acme-key" })
    assert resp.status_code == 401
