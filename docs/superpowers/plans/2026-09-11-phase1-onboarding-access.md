# Phase 1 Slice 2: Onboarding and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete tenant binding on every authenticated endpoint, replace the temp-password invite with an emailed set-password link, add the onboarding questionnaire with starter template folders, and wire the invite, branding, and onboarding UI.

**Architecture:** Tenant binding moves into `get_current_user` (one guard for all authenticated routes, closing the GET/POST asymmetry the slice-1 review flagged), with the existing per-router dependency left as a cached second check. Invites reuse the single-use hashed reset-token machinery so a new member sets their own password from an emailed link. The questionnaire persists into the existing account-settings store (`onboarding` section) and materializes starter template folders per vertical.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 async, pytest harness (in-memory SQLite, `client`/`db_session` fixtures); React 18 + TypeScript frontend verified by `tsc && vite build`.

## Global Constraints

- Clean-room audit gate: `python scripts/audit_clean_room.py` must pass after every task. It rejects any em dash (U+2014) or en dash (U+2013) character anywhere in the repo, and any mention of a specific competitor product name. Use plain hyphens only.
- Tests bootstrap with `DOCURAMA_ENV=development` and `DOCURAMA_COOKIE_SECURE=false` via `backend/tests/conftest.py`; never weaken that.
- Commit style: `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, one logical change per commit.
- Backend tasks are TDD (red then green). Frontend tasks (4 and 5) are verified by `cd frontend && npm run build` passing (tsc is strict) plus a written smoke checklist; note honestly in the report that runtime behavior is build-verified, not browser-verified.
- Self-host behavior must not change: cloud-only gating stays behind `DEPLOYMENT_MODE`; existing tests keep passing.
- Error messages stay uniform where the existing code is deliberately uniform.

---

### Task 1: Bind every authenticated request to the host tenant

**Files:**
- Modify: `backend/app/api/tenant.py` (add the guard function)
- Modify: `backend/app/api/auth.py` (`get_current_user`, around lines 176-219)
- Test: `backend/tests/test_tenant_routing.py` (append)

**Interfaces:**
- Consumes: `resolve_tenant`, `PLATFORM`, `UNKNOWN` from `app.services.tenant_resolver`; `current_capabilities` from `app.core.capabilities`; the `request.state.tenant_host` recorded by `TenantHostMiddleware`.
- Produces: `async def binding_rejection(db, request, user) -> Optional[HTTPException]` in `backend/app/api/tenant.py` - returns None when the request may proceed, otherwise the HTTPException to raise (404 unknown workspace, 403 wrong tenant). `get_current_user` calls it after loading the user, so every authenticated endpoint is tenant-bound in cloud mode.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_tenant_routing.py`:

```python
async def test_write_endpoints_are_tenant_bound(client, db_session, two_tenant_world,
                                                monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    acme, globex, acme_env, globex_env = two_tenant_world
    await _login(client, "bob@example.com")  # Globex session
    # A write with a JSON body, on Acme's host, from a Globex session: bound and
    # rejected before the body is ever validated.
    resp = await client.post("/api/folders", json={"name": "Probe"},
                             headers={"Host": "acme.docurama.eu"})
    assert resp.status_code == 403


async def test_unknown_tenant_rejects_authenticated_calls(client, db_session,
                                                          two_tenant_world,
                                                          monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    await _login(client, "bob@example.com")
    resp = await client.get("/api/auth/me", headers={"Host": "ghost.docurama.eu"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Unknown workspace."


async def test_platform_host_allows_every_authenticated_call(client, db_session,
                                                             two_tenant_world,
                                                             monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    await _login(client, "bob@example.com")
    resp = await client.get("/api/auth/me", headers={"Host": "app.docurama.eu"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "bob@example.com"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_tenant_routing.py -q`
Expected: the two new rejection tests FAIL (stamps POST returns 201/400 rather than 403; `/auth/me` on ghost host returns 200). The platform test likely already passes.

- [ ] **Step 3: Implement the guard**

In `backend/app/api/tenant.py`, add below `require_tenant_binding`:

```python
async def binding_rejection(db: AsyncSession, request: Request, user: User):
    """
    The reason an authenticated request may not proceed on this host, if any.

    Called from get_current_user so the guard covers every authenticated endpoint
    (writes included), not just the routers that declare the dependency. Platform
    hosts never reject: the platform is every tenant's front door.
    """
    if not _tenant_routing_enabled():
        return None
    context = await current_tenant(request, db)
    if context.kind == PLATFORM:
        return None
    if context.kind == UNKNOWN:
        return HTTPException(status_code=404, detail="Unknown workspace.")
    if context.account_id and user.account_id != context.account_id:
        return HTTPException(
            status_code=403,
            detail="This workspace is not served here. Sign in at the platform root.",
        )
    return None
```

In `backend/app/api/auth.py`, inside `get_current_user`, immediately before the final `return user`, add:

```python
    # Cloud mode: every authenticated call must belong to the host's workspace.
    # Late import: this module is imported by app.api.tenant at load time.
    from app.api.tenant import binding_rejection

    rejection = await binding_rejection(db, request, user)
    if rejection is not None:
        raise rejection

    return user
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_tenant_routing.py tests/test_tenant_isolation.py tests/test_api_key_scoping.py -q`
Expected: all PASS. If the API-key suite breaks, check that key-authenticated requests in tests use the harness default host (`test`, parsed as a custom-domain candidate that resolves unknown): if that now 404s cloud tests, confirm those tests run in selfhost mode (they must - only the brief's monkeypatched tests enable cloud).

- [ ] **Step 5: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py` from the repo root, then:

```bash
git add backend/app/api/tenant.py backend/app/api/auth.py backend/tests/test_tenant_routing.py
git commit -m "feat(cloud): bind every authenticated request to the host tenant"
```

---

### Task 2: Invite by email with a set-password link

**Files:**
- Modify: `backend/app/api/companies.py` (invite endpoint, lines 368-469)
- Modify: `backend/app/services/mailer.py` (new template)
- Modify: `backend/app/schemas/schemas.py` (CompanyInviteResponse)
- Test: `backend/tests/test_invite_flow.py` (new)

**Interfaces:**
- Consumes: `password_reset.generate_token/hash_token/expiry_from_now/reset_url` (exists); `PasswordResetToken` model (exists); `mailer.send_email`, `smtp_config.resolve` (exist); `_shell` mail template helper (mailer.py:175).
- Produces: mailer template `team_invite(recipient_name, company_name, invite_link, sender_name, role)` returning `(subject, html, text)`; `CompanyInviteResponse` gains `invite_link_delivered: bool = True` and `fallback_invite_link: Optional[str] = None`; `temporary_password` stays in the schema but is always `None` now.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_invite_flow.py`:

```python
"""
Invites: a new member sets their own password from an emailed single-use link.
No temporary password is ever generated, returned, or displayed.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, User

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def admin_world(db_session):
    account = Account(name="Acme", subdomain="acme")
    db_session.add(account)
    await db_session.flush()
    admin = User(account_id=account.id, email="admin@example.com",
                 hashed_password=get_password_hash(PASSWORD), role="admin",
                 is_active=True)
    db_session.add(admin)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=admin.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()
    return account, admin


async def _login(client, email):
    resp = await client.post("/api/auth/login",
                             json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


async def test_invite_new_user_sends_mail_and_no_password(client, db_session,
                                                          admin_world, monkeypatch):
    from app.services import mailer

    sent = {}

    async def fake_resolve(db, account_id):
        return None  # no SMTP configured in tests

    def fake_send(config, to, name, subject, html, text):
        sent["to"] = to
        sent["subject"] = subject
        sent["html"] = html

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", lambda fn, *a: _sync(fn, *a))
    monkeypatch.setattr(mailer, "send_email", fake_send)

    def _sync(fn, *a):
        return fn(*a)

    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "newhire@example.com", "role": "member", "first_name": "New",
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_new_user"] is True
    assert body["temporary_password"] is None
    assert sent["to"] == "newhire@example.com"
    assert "Acme" in sent["subject"]
    assert "/reset-password?token=" in sent["html"]


async def test_invited_user_password_is_not_the_old_temp_style(client, db_session,
                                                               admin_world):
    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "joiner@example.com", "role": "member",
    })
    assert resp.status_code == 201

    # Whatever password hash was seeded, a guessed short password must not work.
    login = await client.post("/api/auth/login", json={
        "email": "joiner@example.com", "password": "password123"})
    assert login.status_code == 400


async def test_invite_mail_failure_returns_fallback_link(client, db_session,
                                                         admin_world, monkeypatch):
    from app.services import mailer

    async def fake_resolve(db, account_id):
        return None

    def failing_send(config, to, name, subject, html, text):
        class R:
            sent = False
            error = "connection refused"
        return R()

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", lambda fn, *a: fn(*a))
    monkeypatch.setattr(mailer, "send_email", failing_send)

    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "offline@example.com", "role": "member",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["invite_link_delivered"] is False
    assert body["fallback_invite_link"] and "/reset-password?token=" in body["fallback_invite_link"]


async def test_existing_user_invite_sends_no_password_material(client, db_session,
                                                               admin_world,
                                                               monkeypatch):
    from app.core.security import get_password_hash as _h
    from app.models import User as _U
    from app.services import mailer

    calls = []

    async def fake_resolve(db, account_id):
        return None

    def recording_send(config, to, name, subject, html, text):
        calls.append((to, subject))
        class R:
            sent = True
            error = None
        return R()

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", lambda fn, *a: fn(*a))
    monkeypatch.setattr(mailer, "send_email", recording_send)

    account, admin = admin_world
    existing = _U(account_id=account.id, email="veteran@example.com",
                  hashed_password=_h(PASSWORD), role="member", is_active=True)
    db_session.add(existing)
    await db_session.commit()

    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "veteran@example.com", "role": "manager",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_new_user"] is False
    assert body["temporary_password"] is None
    assert body["fallback_invite_link"] is None
    assert calls and calls[0][0] == "veteran@example.com"
```

Note: the monkeypatch target for `asyncio.to_thread` replaces the module attribute on `app.api.companies` (where the endpoint calls it). If the endpoint instead calls `asyncio.to_thread` via the global `asyncio` module, patch `asyncio.to_thread` globally with `monkeypatch.setattr(asyncio, "to_thread", ...)`; check the endpoint's import style and patch whichever is real, recording the choice.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_invite_flow.py -q`
Expected: FAIL - today the endpoint returns a `temporary_password` and sends no mail.

- [ ] **Step 3: Add the mail template**

In `backend/app/services/mailer.py`, after `password_reset` (line ~288), add (follow `_shell`'s existing signature style by reading it first):

```python
def team_invite(recipient_name: str, company_name: str, invite_link: str,
                sender_name: str, role: str):
    subject = f"You have been invited to {company_name} on Docurama"
    intro = f"Hi {recipient_name or 'there'},"
    body_html = (
        f"<p>{sender_name} has invited you to join <strong>{company_name}</strong> "
        f"as {role}.</p>"
        "<p>Choose your own password to activate your account. The link works once "
        "and expires in 60 minutes.</p>"
    )
    return _shell(intro, body_html, invite_link, "Set your password"), None
```

Read `_shell`'s actual return signature first (the file's other templates unpack as `subject, html, text = mailer.password_reset(...)`) and match it exactly - the snippet above must return the same tuple shape as its siblings.

- [ ] **Step 4: Rewire the invite endpoint**

In `backend/app/api/companies.py`, in `invite_company_member`: replace the new-user block (lines 414-427) with a version that seeds an unguessable, unusable password and stages a set-password token:

```python
    is_new_user = False
    invite_token = None
    if not user:
        is_new_user = True
        # The invitee sets their own password from the emailed link. The seeded
        # hash is of a long random value nobody is ever told, so the account is
        # unusable until the link is redeemed.
        seeded = generate_secure_token(32)
        user = User(
            account_id=company_id,
            email=email,
            hashed_password=get_password_hash(seeded),
            first_name=invite_in.first_name or "",
            last_name=invite_in.last_name or "",
            role="admin" if role in ["owner", "admin"] else "member",
            is_active=True,
        )
        db.add(user)
        await db.flush()
        plaintext_token, hashed_token = password_reset_service.generate_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            hashed_token=hashed_token,
            expires_at=password_reset_service.expiry_from_now(),
        ))
```

Add imports: `from app.services import password_reset as password_reset_service`, `PasswordResetToken` to the models import, and `from app.services import mailer, smtp_config` (smtp_config may already be imported - check).

After the `await db.commit()` / `await db.refresh(membership)`, send the mail and build the response:

```python
    invite_link = None
    invite_link_delivered = True
    if is_new_user:
        invite_link = password_reset_service.reset_url(settings.APP_URL, plaintext_token)
        config = await smtp_config.resolve(db, company_id)
        sender_name = f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email
        subject, html, text = mailer.team_invite(
            invite_in.first_name or email, account.name, invite_link,
            sender_name, membership.role,
        )
        result = await asyncio.to_thread(
            mailer.send_email, config, email, invite_in.first_name or email,
            subject, html, text,
        )
        invite_link_delivered = bool(result.sent)
```

Update the `CompanyInviteResponse` construction: `temporary_password=None`, add `invite_link_delivered=invite_link_delivered if is_new_user else True`, and `fallback_invite_link=(invite_link if is_new_user and not invite_link_delivered else None)`. Update the success message for new users to "Created account for {email} and emailed them a set-password link." Keep every other field and check (roles, domain policy, 409 on active membership) untouched.

In `backend/app/schemas/schemas.py`, extend `CompanyInviteResponse`:

```python
    invite_link_delivered: bool = True
    fallback_invite_link: Optional[str] = None
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python -m pytest tests/test_invite_flow.py tests/test_companies_and_dns.py -q`
Expected: all PASS. The existing companies suite asserts temp-password rules - if it pinned the OLD behavior (temp password returned), update those assertions to the new contract and record it; behavior-pin changes to tests are acceptable here, weakening is not.

- [ ] **Step 6: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py`, then:

```bash
git add backend/app/api/companies.py backend/app/services/mailer.py backend/app/schemas/schemas.py backend/tests/test_invite_flow.py backend/tests/test_companies_and_dns.py
git commit -m "feat(companies): email invites with a single-use set-password link"
```

---

### Task 3: Onboarding questionnaire and starter template folders

**Files:**
- Modify: `backend/app/services/account_settings.py` (new section)
- Create: `backend/app/services/onboarding.py`
- Create: `backend/app/api/onboarding.py`
- Modify: `backend/app/api/router.py` (include the router)
- Test: `backend/tests/test_onboarding.py` (new)

**Interfaces:**
- Consumes: `AccountSetting` model; `is_valid_section/defaults_for/merge_section` from `account_settings`; `require_interactive_session` from `app.api.auth`; `get_current_user`.
- Produces: settings section `"onboarding"` with defaults `{"role": None, "use_case": None, "monthly_volume": None, "team_size": None, "vertical": None, "completed": False}`; from `app.services.onboarding`: `VERTICAL_PACKS: Dict[str, List[str]]` mapping vertical key to starter folder names, and `async def apply_onboarding(db, account_id, answers: dict) -> dict` (stores the section, creates missing starter folders idempotently, returns the merged answers); endpoint `POST /api/onboarding` (session + interactive required) accepting those six keys, returning the merged answers.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_onboarding.py`:

```python
"""
Onboarding: the signup questionnaire persists and materializes starter folders
for the chosen vertical, once.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, TemplateFolder, User

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def owner_world(db_session):
    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="owner@example.com",
                 hashed_password=get_password_hash(PASSWORD), role="admin",
                 is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()
    return account, owner


async def _login(client, email):
    resp = await client.post("/api/auth/login",
                             json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


def test_vertical_packs_exist():
    from app.services.onboarding import VERTICAL_PACKS

    for key in ("hr", "sales", "legal", "real_estate", "finance"):
        assert key in VERTICAL_PACKS and VERTICAL_PACKS[key], key


async def test_apply_creates_folders_for_vertical(db_session, owner_world):
    from app.services.onboarding import apply_onboarding, VERTICAL_PACKS

    account, owner = owner_world
    answers = await apply_onboarding(db_session, account.id, {
        "role": "ops", "use_case": "contracts", "monthly_volume": "10-50",
        "team_size": "2-10", "vertical": "hr", "completed": True,
    })
    assert answers["completed"] is True

    folders = (await db_session.execute(
        select(TemplateFolder.name).where(TemplateFolder.account_id == account.id)
    )).scalars().all()
    for expected in VERTICAL_PACKS["hr"]:
        assert expected in folders


from sqlalchemy.future import select  # noqa: E402


async def test_apply_is_idempotent_on_folders(db_session, owner_world):
    from app.services.onboarding import apply_onboarding

    account, owner = owner_world
    answers = {"vertical": "sales", "completed": True}
    await apply_onboarding(db_session, account.id, dict(answers))
    await apply_onboarding(db_session, account.id, dict(answers))

    count = len((await db_session.execute(
        select(TemplateFolder).where(TemplateFolder.account_id == account.id)
    )).scalars().all())
    assert count == len(set(answers.values()) and __import__("app.services.onboarding", fromlist=["VERTICAL_PACKS"]).VERTICAL_PACKS["sales"])


async def test_endpoint_stores_and_returns_answers(client, db_session, owner_world):
    account, owner = owner_world
    await _login(client, "owner@example.com")
    resp = await client.post("/api/onboarding", json={
        "role": "founder", "use_case": "ndas", "monthly_volume": "1-10",
        "team_size": "just-me", "vertical": "legal", "completed": True,
    })
    assert resp.status_code == 200
    assert resp.json()["vertical"] == "legal"

    stored = await client.get("/api/settings/onboarding")
    assert stored.status_code == 200
    assert stored.json()["data"]["use_case"] == "ndas"


async def test_endpoint_refuses_api_keys(client, db_session, owner_world):
    from app.models import ApiKey
    from app.services import api_keys as api_key_service

    account, owner = owner_world
    plaintext, prefix, hashed = api_key_service.generate_api_key()
    db_session.add(ApiKey(account_id=account.id, created_by_user_id=owner.id,
                          name="k", key_prefix=prefix, hashed_key=hashed,
                          scopes=["read", "write"], is_active=True))
    await db_session.commit()

    await _login(client, "owner@example.com")
    resp = await client.post("/api/onboarding", json={"vertical": "hr"},
                             headers={"X-Api-Key": plaintext})
    assert resp.status_code == 403
```

Note: `test_apply_is_idempotent_on_folders`'s final assert is awkward as drafted; write it plainly instead - import `VERTICAL_PACKS` at the top of the file with the other imports and assert `count == len(VERTICAL_PACKS["sales"])`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_onboarding.py -q`
Expected: FAIL on import (`app.services.onboarding` missing) and on the settings-section endpoint (404/400 for an unknown section).

- [ ] **Step 3: Implement**

In `backend/app/services/account_settings.py`: add `"onboarding"` to `VALID_SECTIONS` and to `DEFAULT_SECTION_DATA`:

```python
    "onboarding": {
        "role": None,
        "use_case": None,
        "monthly_volume": None,
        "team_size": None,
        "vertical": None,
        "completed": False,
    },
```

Create `backend/app/services/onboarding.py`:

```python
"""
Signup questionnaire and starter packs.

The answers persist into the account's settings so later phases (billing,
templates, tours) can adapt to them. A vertical also materializes starter
template folders, once: re-running onboarding must never duplicate folders.
"""
from typing import Dict, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import AccountSetting, TemplateFolder

VERTICAL_PACKS: Dict[str, List[str]] = {
    "hr": ["Employment & HR"],
    "sales": ["Sales & Commercial"],
    "legal": ["Legal & Contracts"],
    "real_estate": ["Real Estate"],
    "finance": ["Finance & Procurement"],
}

ANSWER_KEYS = ["role", "use_case", "monthly_volume", "team_size", "vertical",
               "completed"]


async def apply_onboarding(db: AsyncSession, account_id: str, answers: dict) -> dict:
    cleaned = {k: answers.get(k) for k in ANSWER_KEYS if k in answers}

    row = (await db.execute(
        select(AccountSetting).where(
            AccountSetting.account_id == account_id,
            AccountSetting.section == "onboarding",
        )
    )).scalar_one_or_none()
    stored = row.data if row else {}
    merged = {**(stored or {}), **cleaned}

    vertical = merged.get("vertical")
    if vertical in VERTICAL_PACKS:
        existing = set((await db.execute(
            select(TemplateFolder.name).where(
                TemplateFolder.account_id == account_id,
                TemplateFolder.name.in_(VERTICAL_PACKS[vertical]),
            )
        )).scalars().all())
        for name in VERTICAL_PACKS[vertical]:
            if name not in existing:
                db.add(TemplateFolder(account_id=account_id, name=name))

    if row:
        row.data = merged
    else:
        db.add(AccountSetting(account_id=account_id, section="onboarding",
                              data=merged))
    await db.commit()
    return merged
```

Create `backend/app/api/onboarding.py`:

```python
"""
Signup questionnaire endpoint.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user, require_interactive_session
from app.core.database import get_db
from app.models import User
from app.services.onboarding import apply_onboarding

router = APIRouter(tags=["onboarding"])


class OnboardingAnswers(BaseModel):
    role: Optional[str] = None
    use_case: Optional[str] = None
    monthly_volume: Optional[str] = None
    team_size: Optional[str] = None
    vertical: Optional[str] = None
    completed: bool = False


@router.post("/onboarding")
async def submit_onboarding(
    answers: OnboardingAnswers,
    current_user: User = Depends(get_current_user),
    _interactive: None = Depends(require_interactive_session),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.account_id:
        raise _no_workspace()
    return await apply_onboarding(db, current_user.account_id, answers.model_dump())


def _no_workspace():
    from fastapi import HTTPException

    return HTTPException(status_code=400, detail="No active workspace.")
```

(Move the `HTTPException` import to the top of the file in the real implementation; the snippet shows intent.)

In `backend/app/api/router.py`, add `from app.api import onboarding` alongside the other router imports and `api_router.include_router(onboarding.router)`.

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_onboarding.py tests/test_settings_persistence.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py`, then:

```bash
git add backend/app/services/account_settings.py backend/app/services/onboarding.py backend/app/api/onboarding.py backend/app/api/router.py backend/tests/test_onboarding.py
git commit -m "feat(onboarding): questionnaire endpoint with starter template folders"
```

---

### Task 4: Frontend - invite flow and branding card

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx` (invite result card ~lines 1079-1123 and ~3330-3340; new branding card in the Account tab)
- Modify: `frontend/src/lib/api.ts` (`CompanyInviteResult` type ~line 156, add the two new fields)
- Test: none (build-verified)

**Interfaces:**
- Consumes: `GET/PUT /api/settings/branding` (exists); the new invite response fields from Task 2.
- Produces: UI that never displays a temporary password; a branding card that reads and saves `accent_color` and `logo_url` via the existing settings endpoints.

- [ ] **Step 1: Update the invite result type and card**

In `frontend/src/lib/api.ts`, extend the invite result type (~line 156):

```typescript
  invite_link_delivered?: boolean;
  fallback_invite_link?: string | null;
```

In `frontend/src/pages/SettingsPage.tsx`, find the success branch that renders the temporary password (~line 1091: `if (result.is_new_user && result.temporary_password)`) and the card at ~lines 3330-3340 that displays `inviteResult.temporary_password` with a copy button. Replace that behavior: when `result.is_new_user`, show either "Invitation emailed to {email}." (`invite_link_delivered`) or "Email could not be sent. Share this set-password link with them directly:" followed by `fallback_invite_link` in the existing `<code>` style with the existing copy button pattern. Delete the temp-password display entirely.

- [ ] **Step 2: Add a branding card**

In the SettingsPage Account tab (near the Organizations card, ~line 1300), add a "Branding" card: a color input bound to local state initialized from `GET /settings/branding` (the endpoint returns the section's data; follow how the page loads other sections) and a text input for the logo URL, with a Save button calling `PUT /settings/branding` with `{accent_color, logo_url}`. Follow the page's existing card markup and toast conventions (read a neighboring card first; reuse its classes and save pattern).

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: tsc + vite build pass with no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/lib/api.ts
git commit -m "feat(ui): email-based invite feedback and a branding card"
```

---

### Task 5: Frontend - post-signup onboarding wizard

**Files:**
- Create: `frontend/src/pages/OnboardingPage.tsx`
- Modify: `frontend/src/App.tsx` (add the `/onboarding` route to the pathname router)
- Modify: `frontend/src/lib/api.ts` (add `submitOnboarding(answers)`)
- Test: none (build-verified)

**Interfaces:**
- Consumes: `POST /api/onboarding` (Task 3); the register response in `api.ts` (registration already returns the session; find the existing `register` function in `api.ts`).
- Produces: after signup, the app routes to `/onboarding`; the wizard collects role, use case, monthly volume, team size, and vertical (five multiple-choice steps, one question per screen, matching the backend keys exactly: `role`, `use_case`, `monthly_volume`, `team_size`, `vertical`), submits once at the end with `completed: true`, then navigates to the templates page.

- [ ] **Step 1: Add the API function**

In `frontend/src/lib/api.ts`, near the other account functions:

```typescript
  submitOnboarding: async (answers: {
    role?: string; use_case?: string; monthly_volume?: string;
    team_size?: string; vertical?: string; completed?: boolean;
  }) => {
    const resp = await fetch(`${API_BASE}/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(answers),
    });
    if (!resp.ok) throw new Error(`Onboarding failed (${resp.status})`);
    return resp.json();
  },
```

Match the file's existing fetch helper style if one exists (read `api.ts`'s `request`/`apiFetch` pattern first and reuse it instead of raw fetch).

- [ ] **Step 2: Build the wizard page**

Create `frontend/src/pages/OnboardingPage.tsx`: a centered card wizard with five single-choice question steps (role: founder/ops/legal/hr/other; use case: contracts/ndas/invoices/hr-docs/other; monthly volume: 1-10/10-50/50-200/200+; team size: just-me/2-10/11-50/50+; vertical: hr/sales/legal/real_estate/finance, labeled in plain English e.g. "Human Resources"), a progress indicator, Back/Next, and a final "Set up my workspace" button that calls `api.submitOnboarding({...answers, completed: true})` then `window.location.href = "/templates"`. Follow the visual conventions of `SignInPage.tsx` (read it first; reuse its layout classes). Guard: if the fetch fails, show the error inline; no silent success.

- [ ] **Step 3: Route to it**

In `frontend/src/App.tsx`, add a pathname case for `/onboarding` rendering `OnboardingPage`, and change the successful-signup path to `window.location.href = "/onboarding"` (find where register currently navigates; keep login navigation unchanged).

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: tsc + vite pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/OnboardingPage.tsx frontend/src/App.tsx frontend/src/lib/api.ts
git commit -m "feat(ui): post-signup onboarding wizard with vertical starter packs"
```

---

## Deliberately deferred from this slice

- Real starter template PDFs per vertical (folders only for now; content design is its own task)
- Cursor-guided product tours (react-joyride) and the dashboard onboarding checklist
- Adaptive content elsewhere driven by the questionnaire (billing defaults, template suggestions)
- Custom-domain branding injection (accent color served on tenant hosts)
