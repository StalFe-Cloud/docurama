# Phase 1 Slice 3: Domain Trust and DNS UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make domain verification workable for non-technical users: detect their DNS provider and show exact steps, generate an email their IT team can act on, report found-vs-expected diagnostics, offer Cloudflare one-click, and clear the recorded pre-cloud-launch hardening debt.

**Architecture:** A new `dns_provider` service maps NS records (queried through the existing DoH helper) to provider-specific tutorials; a `cloudflare_dns` service performs the one-click record creation with a user-supplied scoped token that is used once and never stored. The domains API gains `/setup`, `/it-email`, `/cloudflare`, and a `checks` summary on verification results. Task 1 clears the recorded debt (NULL-account write fallbacks, subdomain autogen guard, collision 409, folder uniqueness).

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 async, Alembic, pytest harness; React 18 + TS frontend verified by `npm run build`.

## Global Constraints

- Clean-room audit gate: `python scripts/audit_clean_room.py` must pass after every task; no em dash (U+2014) or en dash (U+2013) anywhere; never name a specific competitor product.
- Tests bootstrap with `DOCURAMA_ENV=development` and `DOCURAMA_COOKIE_SECURE=false`; never weaken that.
- Commit style: `feat(domain): ...`, `fix(scope): ...`, `test(scope): ...`, one logical change per commit.
- Backend tasks are TDD (red then green). The frontend task is verified by `cd frontend && npm run build` plus a written smoke checklist.
- Self-host behavior must not change: provider detection and Cloudflare one-click are opt-in per account; the debt fixes must preserve current success paths.
- Honest reporting: diagnostics report what was found and what was expected; a failed lookup is never presented as a verified absence; the Cloudflare token is never stored or logged.

---

### Task 1: Pre-cloud-launch hardening debt

**Files:**
- Modify: `backend/app/services/storage_layout.py`
- Modify: `backend/app/api/envelopes.py` (bulk-send writer), `backend/app/api/templates.py` (public-start writer; upload/create sites already guard via `current_user.account_id` 400s - verify)
- Modify: `backend/app/api/companies.py` (autogen guard, IntegrityError 409)
- Modify: `backend/app/models/models.py` (TemplateFolder UniqueConstraint)
- Create: `backend/alembic/versions/0007_template_folder_unique_name.py`
- Test: `backend/tests/test_storage_layout.py` (append), `backend/tests/test_tenancy_rules.py` (append), `backend/tests/test_onboarding.py` (append)

**Interfaces:**
- Produces: `best_effort_artifact_path(storage_dir: str, account_id, filename: str) -> str` in `storage_layout.py` - namespaced path when `account_id` is valid, legacy flat path when it is None/invalid (preserving pre-slice-1 behavior for legacy rows); autogen subdomains always pass `subdomain_error`; duplicate subdomain races return 409; duplicate folder names per account are impossible at the schema level.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_storage_layout.py`:

```python
def test_best_effort_path_falls_back_to_flat_for_none_account():
    from app.services.storage_layout import best_effort_artifact_path

    path = best_effort_artifact_path("/data", None, "env_original.pdf")
    assert path == os.path.join("/data", "env_original.pdf")


def test_best_effort_path_namespaces_valid_accounts():
    from app.services.storage_layout import best_effort_artifact_path

    path = best_effort_artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                                     "env_original.pdf")
    assert os.path.join("accounts", "0b5a9a4e-1111-4222-8333-444455556666") in path
```

Append to `backend/tests/test_tenancy_rules.py`:

```python
async def test_autogen_subdomain_never_violates_the_rules(client, db_session,
                                                          monkeypatch):
    from app.services import tenancy
    from app.services.tenancy import subdomain_error

    # A company name that slugifies to nothing must not produce an invalid label.
    subdomain = tenancy  # placeholder replaced below; see step 3
    from app.api import companies as companies_api

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

    from app.services import tenancy
    monkeypatch.setattr(tenancy, "subdomain_available", lambda db, c: _truthy())

    def _truthy():
        return True

    # Patch must be async: replace with a coroutine-returning stub.
    async def available(db, candidate):
        return True
    monkeypatch.setattr(tenancy, "subdomain_available", available)

    login = await client.post("/api/auth/login",
                              json={"email": "racer@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.post("/api/companies", json={"name": "Rival",
                                                     "subdomain": "race-name"})
    assert resp.status_code == 409
```

Remove the stray first monkeypatch line and the sync `_truthy` stub from the draft; the final test keeps only the async `available` patch (write it plainly).

Append to `backend/tests/test_onboarding.py`:

```python
async def test_duplicate_folder_names_are_rejected_by_schema(db_session, owner_world):
    from sqlalchemy.exc import IntegrityError

    from app.models import TemplateFolder

    account, owner = owner_world
    db_session.add(TemplateFolder(account_id=account.id, name="Employment & HR"))
    await db_session.commit()
    db_session.add(TemplateFolder(account_id=account.id, name="Employment & HR"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_storage_layout.py tests/test_tenancy_rules.py tests/test_onboarding.py -q`
Expected: FAIL - `best_effort_artifact_path` does not exist; the autogen test gets a 200 with an invalid `-xxxxxx` subdomain; the race test gets a 500; the duplicate-folder test passes only if the constraint already exists (it does not, so it fails).

- [ ] **Step 3: Implement**

In `backend/app/services/storage_layout.py`, add:

```python
def best_effort_artifact_path(storage_dir: str, account_id, filename: str) -> str:
    """
    Namespaced path when the row has an account, legacy flat path when it does
    not. Legacy NULL-account rows must keep writing where they always wrote
    instead of failing the whole request.
    """
    if account_id and is_valid_account_id(account_id):
        return artifact_path(storage_dir, account_id, filename)
    return os.path.join(storage_dir, filename)
```

In `backend/app/api/envelopes.py` (bulk-send writer AND the multipart upload writer) and `backend/app/api/templates.py` (public-start writer AND the template-upload writer): replace every `artifact_path(...)` call with `best_effort_artifact_path(...)` (keeping `ensure_dir(os.path.dirname(pdf_path))`). The account argument stays whatever is there today (`current_user.account_id` on the upload/create sites, `template.account_id` on bulk/public-start) - both are nullable, and a None now falls back to the legacy flat path instead of a 500. `signing.py` keeps its own `_envelope_artifact_path` fallback (already shipped).

In `backend/app/api/companies.py` `create_company`: replace the autogen line with:

```python
    else:
        slug = slugify(clean_name)
        subdomain = f"{slug}-{uuid.uuid4().hex[:6]}"
        if subdomain_error(subdomain):
            subdomain = f"company-{uuid.uuid4().hex[:10]}"
```

Wrap the `await db.commit()` in `create_company` with an IntegrityError translation:

```python
    from sqlalchemy.exc import IntegrityError

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="That subdomain was just claimed by another workspace. Pick another.",
        )
```

(The import belongs at the top of the file with the others.)

In `backend/app/models/models.py` `TemplateFolder.__table_args__`, add:

```python
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_template_folder_account_name"),
    )
```

Create `backend/alembic/versions/0007_template_folder_unique_name.py` (read `0006_reset_totp_stamps.py` first for the file style and current head revision id; wire `down_revision` to it):

```python
"""Deduplicate template folder names per account, then enforce uniqueness.

Revision ID: 0007_template_folder_unique_name
Revises: <head of 0006>
"""
from alembic import op

revision = "0007_template_folder_unique_name"
down_revision = "<head of 0006>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep the oldest folder per (account_id, name); reassign nothing - later
    # duplicates are deleted, which is safe because folders only group templates.
    op.execute(
        """
        DELETE FROM template_folders a
        USING template_folders b
        WHERE a.account_id = b.account_id
          AND a.name = b.name
          AND a.created_at > b.created_at
        """
    )
    op.create_unique_constraint(
        "uq_template_folder_account_name", "template_folders",
        ["account_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_template_folder_account_name", "template_folders",
                       type_="unique")
```

Read 0006 first: if its style uses `op.get_bind()` / different helpers, match it; if `created_at` can tie, add `AND a.id > b.id` as the tiebreaker.

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_storage_layout.py tests/test_tenancy_rules.py tests/test_onboarding.py tests/test_tenant_isolation.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py`, then:

```bash
git add backend/app/services/storage_layout.py backend/app/api/envelopes.py backend/app/api/templates.py backend/app/api/companies.py backend/app/models/models.py backend/alembic/versions/0007_template_folder_unique_name.py backend/tests/
git commit -m "fix(cloud): legacy-write fallbacks, subdomain guards, unique folder names"
```

---

### Task 2: DNS provider detection with provider-specific tutorials

**Files:**
- Create: `backend/app/services/dns_provider.py`
- Test: `backend/tests/test_dns_provider.py` (new)

**Interfaces:**
- Consumes: `doh_query(name, record_type)` from `app.services.domain_verifier` (returns list of answer dicts with `data`/`TTL`).
- Produces: from `app.services.dns_provider`:
  - `detect_provider(domain: str) -> dict` returning `{"provider": Optional[str], "nameservers": List[str], "steps": List[str]}` - NS lookup via DoH, matched against `PROVIDER_NS_SUFFIXES`; unknown providers get `provider: None` and generic steps.
  - `PROVIDER_NS_SUFFIXES: Dict[str, tuple]` mapping provider key to NS hostname suffixes; `PROVIDER_TUTORIALS: Dict[str, List[str]]` with concrete per-provider steps; `GENERIC_STEPS: List[str]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_dns_provider.py`:

```python
"""
DNS provider detection: NS records tell us where the customer manages DNS, so
the instructions can name the exact screens instead of generic DNS advice.
"""
import pytest

from app.services import dns_provider


def _ns_answers(hosts):
    return [{"data": h} for h in hosts]


async def test_cloudflare_detected_by_nameservers(monkeypatch):
    async def fake_doh(name, rtype):
        return _ns_answers(["ns1.cloudflare.com", "ns2.cloudflare.com"])

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] == "cloudflare"
    assert result["steps"] and "Cloudflare" in result["steps"][0]
    assert any("_docurama-challenge" in s for s in result["steps"])


async def test_unknown_provider_gets_generic_steps(monkeypatch):
    async def fake_doh(name, rtype):
        return _ns_answers(["ns1.some-obscure-dns.example"])

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] is None
    assert result["steps"] == dns_provider.GENERIC_STEPS


async def test_failed_lookup_is_reported_not_guessed(monkeypatch):
    async def fake_doh(name, rtype):
        return []

    monkeypatch.setattr(dns_provider, "doh_query", fake_doh)
    result = await dns_provider.detect_provider("acme.example")
    assert result["provider"] is None
    assert result["nameservers"] == []
    assert result["steps"] == dns_provider.GENERIC_STEPS


def test_tutorials_reference_the_challenge_host_pattern():
    for key, steps in dns_provider.PROVIDER_TUTORIALS.items():
        assert steps, key
        assert any("TXT" in s for s in steps), key
        assert any("_docurama-challenge" in s or "challenge host" in s for s in steps), key
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_dns_provider.py -q`
Expected: FAIL on import.

- [ ] **Step 3: Implement**

Create `backend/app/services/dns_provider.py`:

```python
"""
DNS provider detection and setup tutorials.

NS records tell us where the customer actually manages DNS, so the setup steps
can name real screens instead of generic DNS advice. Detection is best effort:
an unknown or unresolvable provider falls back to accurate generic steps and is
reported as None, never guessed.
"""
from typing import Dict, List

from app.services.domain_verifier import doh_query

PROVIDER_NS_SUFFIXES: Dict[str, tuple] = {
    "cloudflare": ("ns.cloudflare.com",),
    "godaddy": ("domaincontrol.com",),
    "namecheap": ("registrar-servers.com",),
    "ovh": ("ovh.net", "ovh.ca"),
    "hetzner": ("hetzner.com", "hetzner.de"),
    "gandi": ("gandi.net",),
    "googledns": ("googledomains.com", "dns.google"),
    "aws": ("awsdns.net",),
    "digitalocean": ("digitalocean.com",),
    "porkbun": ("porkbun.com",),
}

GENERIC_STEPS: List[str] = [
    "Sign in to the service that manages DNS for your domain (your registrar or DNS host).",
    "Open the DNS records editor for your domain.",
    "Add a TXT record with the host shown below and the value shown below (leave TTL at its default).",
    "Save the record, then come back here and press Verify. New records can take a few minutes to an hour to appear.",
]

PROVIDER_TUTORIALS: Dict[str, List[str]] = {
    "cloudflare": [
        "Sign in to Cloudflare and select your domain (Cloudflare acts as the DNS host).",
        "Go to DNS, then Records, and press Add record.",
        "Choose Type TXT. In Name, enter the challenge host shown below without the domain (Cloudflare appends it automatically).",
        "Paste the value shown below into Content, keep TTL on Auto, and press Save.",
        "Return here and press Verify. Cloudflare changes usually appear within a minute or two.",
    ],
    "godaddy": [
        "Sign in to GoDaddy and open My Products, then DNS next to your domain.",
        "In the DNS Records list press Add New Record.",
        "Choose Type TXT. In Name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and press Save.",
        "Return here and press Verify. GoDaddy records usually appear within the hour.",
    ],
    "namecheap": [
        "Sign in to Namecheap, open Domain List, then Manage next to your domain.",
        "Open the Advanced DNS tab and press Add New Record.",
        "Choose Record Type TXT Record. In Host, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and save with the green check.",
        "Return here and press Verify. Namecheap changes usually appear within a few minutes.",
    ],
    "ovh": [
        "Sign in to the OVHcloud manager and open Web Cloud, then your domain under Domains.",
        "Open the DNS records tab and press Add an entry.",
        "Choose TXT. For Sub-domain, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value and confirm.",
        "Return here and press Verify. OVH changes can take up to an hour to propagate.",
    ],
    "hetzner": [
        "Sign in to Hetzner Cloud Console and open your zone under Networks, DNS.",
        "Press Add record and choose Type TXT.",
        "In Name, enter the challenge host shown below without the zone name.",
        "Paste the value shown below into Value and save.",
        "Return here and press Verify. Hetzner zones usually update quickly.",
    ],
    "gandi": [
        "Sign in to Gandi, open your domain, then the DNS Records tab.",
        "Press Add record and choose TXT.",
        "In Name, enter the challenge host shown below without the domain (Gandi appends the domain automatically).",
        "Paste the value shown below into the text value field and save.",
        "Return here and press Verify. Gandi changes usually appear within minutes.",
    ],
    "googledns": [
        "Sign in to Google Domains (or Google Cloud DNS) and open your domain's DNS records.",
        "Add a record of type TXT.",
        "For Host name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into the TXT value and save.",
        "Return here and press Verify. Google DNS usually updates within minutes.",
    ],
    "aws": [
        "Sign in to the AWS console, open Route 53, then Hosted zones, and select your domain.",
        "Press Create record. Choose Record type TXT.",
        "In Record name, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Value. Route 53 requires TXT values in quotes; wrap the value in double quotes if the console has not done it.",
        "Create the record, return here, and press Verify. Route 53 usually propagates within a minute or two.",
    ],
    "digitalocean": [
        "Sign in to DigitalOcean and open Networking, Domains, then your domain.",
        "Under Create new record choose TXT.",
        "Enter the challenge host shown below into Hostname without the domain.",
        "Paste the value shown below into the message field and press Create Record.",
        "Return here and press Verify. DigitalOcean changes usually appear quickly.",
    ],
    "porkbun": [
        "Sign in to Porkbun and open your domain's Detailed records.",
        "Press Add and choose Record Type TXT.",
        "In Host, enter the challenge host shown below without the domain.",
        "Paste the value shown below into Content and save.",
        "Return here and press Verify. Porkbun changes usually appear within minutes.",
    ],
}


def _provider_for(nameserver: str):
    lowered = (nameserver or "").lower()
    for key, suffixes in PROVIDER_NS_SUFFIXES.items():
        if any(lowered.endswith(sfx) for sfx in suffixes):
            return key
    return None


async def detect_provider(domain: str) -> dict:
    clean = (domain or "").strip().lower()
    answers = await doh_query(clean, "NS")
    nameservers = [str(a.get("data", "")).strip(".").lower() for a in answers]

    provider = None
    for ns in nameservers:
        provider = _provider_for(ns)
        if provider:
            break

    return {
        "provider": provider,
        "nameservers": nameservers,
        "steps": list(PROVIDER_TUTORIALS[provider]) if provider else list(GENERIC_STEPS),
    }
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_dns_provider.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

```bash
git add backend/app/services/dns_provider.py backend/tests/test_dns_provider.py
git commit -m "feat(domain): detect DNS providers and serve provider-specific setup steps"
```

---

### Task 3: Domains API: setup guidance, IT-team email draft, verification checks

**Files:**
- Modify: `backend/app/api/domains.py` (new endpoints; verify endpoint gains checks)
- Modify: `backend/app/schemas/schemas.py` (DomainSetupGuidance, ItEmailDraft, DomainVerifyResponse.checks)
- Test: `backend/tests/test_domain_endpoints.py` (append)

**Interfaces:**
- Consumes: `detect_provider` (Task 2); `verify_client_domain` (exists); the seeded `DomainVerification` fixture in the test file.
- Produces:
  - `GET /api/domains/{id}/setup` -> `{"domain", "provider", "nameservers", "steps", "records": [{"host", "value", "type"}], "web_confirmation_url"}` (account-scoped).
  - `POST /api/domains/{id}/it-email` -> `{"subject", "body"}` - a ready-to-send draft (the frontend opens a mailto:; the server never sends it).
  - `DomainVerifyResponse` gains `checks: List[{"method", "expected", "found", "ok"}]` summarizing found-vs-expected for TXT, subdomain pointer, and web confirmation.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_domain_endpoints.py` (the `member_and_admin` fixture and `_login` helper exist there):

```python
async def test_setup_returns_provider_guidance_and_records(client, member_and_admin,
                                                           monkeypatch):
    from app.services import dns_provider

    async def fake_detect(domain):
        return {"provider": "cloudflare", "nameservers": ["ns1.cloudflare.com"],
                "steps": ["Step one"]}

    monkeypatch.setattr(dns_provider, "detect_provider", fake_detect)
    monkeypatch.setattr("app.api.domains.detect_provider", fake_detect)

    account, admin, member, domain = member_and_admin
    await _login(client, "member@example.com")
    resp = await client.get(f"/api/domains/{domain.id}/setup")
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "cloudflare"
    assert body["records"][0]["host"] == "_docurama-challenge.acme.example"
    assert body["records"][0]["value"] == "docurama-verification=dcr_vfy_abc123"
    assert body["records"][0]["type"] == "TXT"


async def test_it_email_draft_contains_records_and_is_not_sent(client, member_and_admin,
                                                               monkeypatch):
    sent = []
    monkeypatch.setattr("app.api.domains.mailer.send_email",
                        lambda *a, **k: sent.append(a))
    account, admin, member, domain = member_and_admin
    await _login(client, "member@example.com")
    resp = await client.post(f"/api/domains/{domain.id}/it-email")
    assert resp.status_code == 200
    body = resp.json()
    assert "Acme" in body["subject"] or "acme.example" in body["subject"]
    assert "_docurama-challenge.acme.example" in body["body"]
    assert "docurama-verification=dcr_vfy_abc123" in body["body"]
    assert sent == []  # a draft only; nothing was sent


async def test_verify_response_includes_checks_summary(client, member_and_admin,
                                                       monkeypatch):
    from app.services import domain_verifier

    async def fake_verify(d, token):
        return False, "none", {"txt_records": []}, "Verification pending."

    monkeypatch.setattr("app.api.domains.verify_client_domain", fake_verify)
    account, admin, member, domain = member_and_admin
    await _login(client, "member@example.com")
    resp = await client.post(f"/api/domains/{domain.id}/verify")
    assert resp.status_code == 200
    checks = resp.json()["checks"]
    assert checks, "expected at least one check"
    txt = next(c for c in checks if c["method"] == "dns_txt")
    assert txt["expected"] == "docurama-verification=dcr_vfy_abc123"
    assert txt["ok"] is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_domain_endpoints.py -q`
Expected: FAIL (404s for the two new routes; `checks` missing from verify response).

- [ ] **Step 3: Implement**

In `backend/app/api/domains.py`, add imports: `from app.services.dns_provider import detect_provider` and (for the draft) plain string building - no mailer import is needed; the test's monkeypatch target exists only to prove nothing is sent, so keep `mailer` unimported and adjust the test's patch target to a harmless attribute instead if importing mailer solely for the test feels wrong. Prefer: drop the mailer monkeypatch from the test and assert only on the response body (the endpoint cannot send mail - it returns a dict). Simplify the test accordingly.

New endpoints (place after `toggle_domain_enforcement`), using the existing account-scoping query pattern:

```python
@router.get("/{domain_id}/setup")
async def domain_setup_guidance(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    guidance = await detect_provider(domain_rec.domain)
    return {
        "domain": domain_rec.domain,
        "provider": guidance["provider"],
        "nameservers": guidance["nameservers"],
        "steps": guidance["steps"],
        "records": [
            {"type": "TXT",
             "host": domain_rec.txt_record_host,
             "value": domain_rec.txt_record_value},
        ],
        "web_confirmation_url": domain_rec.web_confirmation_url,
    }


@router.post("/{domain_id}/it-email")
async def domain_it_email_draft(
    domain_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A ready-to-send draft for the customer's IT team. The server never sends it."""
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    account = (await db.execute(
        select(Account).where(Account.id == current_user.account_id)
    )).scalar_one_or_none()
    org = account.name if account else "our organization"

    subject = f"Action needed: add one DNS record to verify {domain_rec.domain} for Docurama"
    body = (
        "Hi team,\n\n"
        f"To use {domain_rec.domain} with Docurama ({org}), our DNS needs one TXT record "
        "so Docurama can verify that we control the domain.\n\n"
        "Please add this DNS record:\n"
        f"  Type:  TXT\n"
        f"  Host:  {domain_rec.txt_record_host}\n"
        f"  Value: {domain_rec.txt_record_value}\n\n"
        "Leave the TTL at its default. If our DNS is managed by another team or provider, "
        "please forward this to them.\n\n"
        "Once the record is saved, verification is done from Docurama under "
        "Settings, Domains (press Verify). New DNS records can take from a few minutes "
        "to an hour to become visible.\n\n"
        "Thanks!"
    )
    return {"subject": subject, "body": body}
```

For the checks summary, add a pure helper at the bottom of `backend/app/services/domain_verifier.py`:

```python
def summarize_checks(domain: str, verification_token: str,
                     dns_details: Dict[str, Any], method_matched: str) -> List[Dict[str, Any]]:
    """
    Found-vs-expected for each verification path, so the UI can show what was
    looked for and what was actually there instead of a raw DNS dump.
    """
    expected_txt = f"docurama-verification={verification_token}"
    found_txt = [r.get("data", "") for r in dns_details.get("txt_records", [])]
    txt_ok = method_matched == "dns_txt"
    pointer_ok = method_matched == "dns_subdomain_pointer"
    web_ok = method_matched == "web_confirmation"
    return [
        {"method": "dns_txt",
         "expected": f"TXT at _docurama-challenge.{domain} containing {expected_txt}",
         "found": found_txt or "no TXT records found",
         "ok": txt_ok},
        {"method": "dns_subdomain_pointer",
         "expected": "docurama.<domain> or sign.<domain> serving the Docurama service",
         "found": dns_details.get("subdomain_pointers", {}),
         "ok": pointer_ok},
        {"method": "web_confirmation",
         "expected": "the token published under /.well-known/docurama-verification",
         "found": dns_details.get("web_confirmation", {}),
         "ok": web_ok},
    ]
```

In `verify_domain` (domains.py), after `is_verified, method, details, message = await verify_client_domain(...)`, attach `checks=summarize_checks(domain_rec.domain, domain_rec.verification_token, details, method)` to the `DomainVerifyResponse(...)` construction; import `summarize_checks` alongside `verify_client_domain`. In `backend/app/schemas/schemas.py`, add `checks: List[Dict[str, Any]] = []` to `DomainVerifyResponse` (and `from typing import Any, Dict, List` if absent).

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_domain_endpoints.py tests/test_registration_gate.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

```bash
git add backend/app/api/domains.py backend/app/services/domain_verifier.py backend/app/schemas/schemas.py backend/tests/test_domain_endpoints.py
git commit -m "feat(domain): setup guidance, IT-team email draft and found-vs-expected checks"
```

---

### Task 4: Cloudflare one-click record creation

**Files:**
- Create: `backend/app/services/cloudflare_dns.py`
- Modify: `backend/app/api/domains.py` (new endpoint, admin-gated)
- Test: `backend/tests/test_cloudflare_dns.py` (new)

**Interfaces:**
- Consumes: `require_company_admin` from `app.api.companies` (exists; returns the membership).
- Produces: from `app.services.cloudflare_dns`: `async def create_challenge_record(api_token: str, zone_name: str, host: str, value: str) -> dict` returning `{"ok": bool, "record_id": Optional[str], "error": Optional[str]}` against the Cloudflare API v4 (`GET zones?name=`, `POST zones/{id}/dns_records`); endpoint `POST /api/domains/{id}/cloudflare` with body `{"api_token": str}` -> `{"success", "record_id", "message"}`; the token is used for the request and never stored, logged, or echoed.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_cloudflare_dns.py`:

```python
"""
Cloudflare one-click: a DNS-scoped API token the customer pastes is used once to
create the challenge TXT record, then discarded. The token is never stored.
"""
import pytest

from app.services import cloudflare_dns


class _Resp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _raise_from_status(resp):
    resp.raise_for_status = lambda: None
    return resp


async def test_creates_txt_record(monkeypatch):
    calls = []

    async def fake_get(url, **kw):
        calls.append(("GET", url))
        return _Resp(200, {"success": True, "result": [{"id": "zone123"}]})

    async def fake_post(url, **kw):
        calls.append(("POST", url, kw.get("json")))
        return _Resp(200, {"success": True,
                           "result": {"id": "rec456"}})

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get",
                        lambda self, url, **kw: fake_get(url, **kw))
    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "post",
                        lambda self, url, **kw: fake_post(url, **kw))

    result = await cloudflare_dns.create_challenge_record(
        "tok", "acme.example", "_docurama-challenge.acme.example", "docurama-verification=abc")
    assert result["ok"] is True
    assert result["record_id"] == "rec456"
    assert any("zones?name=acme.example" in c[1] for c in calls if c[0] == "GET")
    post_call = next(c for c in calls if c[0] == "POST")
    assert post_call[2]["type"] == "TXT"
    assert post_call[2]["name"] == "_docurama-challenge.acme.example"


async def test_unknown_zone_fails_cleanly(monkeypatch):
    async def fake_get(url, **kw):
        return _Resp(200, {"success": True, "result": []})

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get",
                        lambda self, url, **kw: fake_get(url, **kw))

    result = await cloudflare_dns.create_challenge_record(
        "tok", "not-there.example", "x", "y")
    assert result["ok"] is False
    assert result["record_id"] is None
    assert "not found" in (result["error"] or "").lower()


async def test_bad_token_fails_without_echoing_it(monkeypatch):
    async def fake_get(url, **kw):
        return _Resp(403, {"success": False, "errors": [{"message": "Authentication error"}]})

    monkeypatch.setattr(cloudflare_dns.httpx.AsyncClient, "get",
                        lambda self, url, **kw: fake_get(url, **kw))

    result = await cloudflare_dns.create_challenge_record(
        "sekrit-token", "acme.example", "x", "y")
    assert result["ok"] is False
    assert "sekrit-token" not in str(result)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_cloudflare_dns.py -q`
Expected: FAIL on import.

- [ ] **Step 3: Implement**

Create `backend/app/services/cloudflare_dns.py`:

```python
"""
One-click Cloudflare DNS records.

The customer creates a DNS-scoped API token in their Cloudflare dashboard and
pastes it here; it authorizes exactly this record creation and is then
discarded. It is never stored, logged, or echoed back.
"""
from typing import Optional

import httpx

API_BASE = "https://api.cloudflare.com/client/v4"
TIMEOUT = 15.0


async def create_challenge_record(api_token: str, zone_name: str, host: str,
                                  value: str) -> dict:
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            zone_resp = await client.get(
                f"{API_BASE}/zones", params={"name": zone_name}, headers=headers)
            zone_resp.raise_for_status()
            zones = zone_resp.json().get("result") or []
            if not zones:
                return {"ok": False, "record_id": None,
                        "error": f"Zone {zone_name} not found in this Cloudflare account. "
                                 "Confirm the token's account includes this domain."}

            record_resp = await client.post(
                f"{API_BASE}/zones/{zones[0]['id']}/dns_records",
                headers=headers,
                json={"type": "TXT", "name": host, "content": value, "ttl": 1},
            )
            record_resp.raise_for_status()
            record = record_resp.json().get("result") or {}
            return {"ok": True, "record_id": record.get("id"), "error": None}
        except httpx.HTTPStatusError as exc:
            # Surface Cloudflare's own message; never the token.
            detail = "Cloudflare rejected the request"
            try:
                errors = exc.response.json().get("errors") or []
                if errors and errors[0].get("message"):
                    detail = f"Cloudflare: {errors[0]['message']}"
            except Exception:
                pass
            return {"ok": False, "record_id": None, "error": detail}
        except Exception as exc:
            return {"ok": False, "record_id": None,
                    "error": f"Could not reach Cloudflare: {exc}"}
```

In `backend/app/api/domains.py`, add the endpoint (after `it-email`):

```python
from pydantic import BaseModel as _BaseModel


class CloudflareTokenRequest(_BaseModel):
    api_token: str


@router.post("/{domain_id}/cloudflare")
async def create_cloudflare_challenge(
    domain_id: str,
    payload: CloudflareTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.api.companies import require_company_admin
    from app.services.cloudflare_dns import create_challenge_record

    membership = await require_company_admin(current_user.account_id, current_user, db)
    domain_rec = (await db.execute(
        select(DomainVerification).where(
            DomainVerification.id == domain_id,
            DomainVerification.account_id == current_user.account_id,
        )
    )).scalar_one_or_none()
    if not domain_rec:
        raise HTTPException(status_code=404, detail="Domain record not found.")

    result = await create_challenge_record(
        payload.api_token, domain_rec.domain,
        domain_rec.txt_record_host, domain_rec.txt_record_value,
    )
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {
        "success": True,
        "record_id": result["record_id"],
        "message": (f"TXT record created at {domain_rec.txt_record_host}. "
                    "Cloudflare changes usually appear within a minute or two; "
                    "press Verify."),
    }
```

(Move the `CloudflareTokenRequest` schema to `backend/app/schemas/schemas.py` instead if the file's convention keeps all schemas there - check and follow the convention.)

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_cloudflare_dns.py tests/test_domain_endpoints.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

```bash
git add backend/app/services/cloudflare_dns.py backend/app/api/domains.py backend/app/schemas/schemas.py backend/tests/test_cloudflare_dns.py
git commit -m "feat(domain): one-click Cloudflare challenge record with a scoped token"
```

---

### Task 5: Frontend - domains card with guided setup

**Files:**
- Modify: `frontend/src/lib/api.ts` (helpers: `getDomainSetup`, `getItEmailDraft`, `createCloudflareRecord`; extend `DomainVerifyResult` with `checks`)
- Modify: `frontend/src/pages/SettingsPage.tsx` (Domains/DNS card: setup panel with steps, records copy buttons, mailto IT-team button, Cloudflare token flow, checks display after verify)
- Test: none (build-verified)

**Interfaces:**
- Consumes: `GET /api/domains/{id}/setup`, `POST /api/domains/{id}/it-email`, `POST /api/domains/{id}/cloudflare`, and `DomainVerifyResponse.checks` from Tasks 3-4.

- [ ] **Step 1: API helpers**

In `frontend/src/lib/api.ts`, next to the existing domain helpers (~lines 874-920), add:

```typescript
  getDomainSetup: async (domainId: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}/setup`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load domain setup guidance");
    return res.json();
  },

  getItEmailDraft: async (domainId: string): Promise<{ subject: string; body: string }> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}/it-email`, {
      method: "POST", credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to prepare the IT-team email draft");
    return res.json();
  },

  createCloudflareRecord: async (domainId: string, apiToken: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}/cloudflare`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_token: apiToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Cloudflare record creation failed");
    return body;
  },
```

Match the file's actual helper style (read the neighbors at 874-920 first). Extend `DomainVerifyResult` with `checks?: { method: string; expected: string; found: any; ok: boolean }[]`.

- [ ] **Step 2: Rework the DNS card**

In `frontend/src/pages/SettingsPage.tsx` Domains section (~line 1501 onward): for the selected/registered domain, load `getDomainSetup` when the card renders a pending domain and render:

1. Provider banner: "Your DNS is managed by Cloudflare" (or "We could not detect your DNS provider; generic steps below").
2. Numbered setup steps from `setup.steps`.
3. The records table with copy buttons next to host and value (reuse the page's existing `copyToClipboard` + `copiedKey` flash pattern).
4. Two action rows: "Email these instructions to my IT team" (builds a `mailto:?subject=...&body=...` link from the draft and opens it) and a Cloudflare one-click row (collapsible: text explaining creating a token at Cloudflare with Zone.DNS Edit permission scoped to the domain, a password-type input, and a button calling `createCloudflareRecord`, surfacing the returned message or error inline).
5. After `verifyDomain` returns, render `checks`: for each check, method label (TXT record / Subdomain pointing / Website file), `ok` as a green check or red cross, the `expected` string, and the found summary as muted text.

Keep the existing register/verify/toggle/delete handlers intact. State honestly in the report that runtime is build-verified only.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build` - must pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/SettingsPage.tsx
git commit -m "feat(ui): guided DNS setup with provider steps, IT-team draft and Cloudflare one-click"
```

---

## Deliberately deferred from this slice

- Auto-recheck loop (background re-verification with notification) - the Verify button already re-checks on demand
- Meta-tag verification method (the well-known file method already covers no-DNS access)
- Signer verification channels (email OTP / Telegram / WhatsApp / SMS) - next slice
- Quotas, metering, Stripe billing - later slices
