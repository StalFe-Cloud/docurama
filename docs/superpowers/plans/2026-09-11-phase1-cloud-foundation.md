# Phase 1 Slice 1: Cloud Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Docurama the cloud-mode foundation: a capability registry, routable tenant subdomains under the cloud domain with platform/reserved-host handling, tenant-context enforcement on account-scoped APIs, and per-account storage namespacing for all new document artifacts.

**Architecture:** A thin pure host-parsing middleware records the tenant host on `request.state`; a DB-backed dependency (`current_tenant`) resolves it to an Account (by `Account.subdomain` or a verified custom `DomainVerification`) using the request-scoped session, so tests work through the existing dependency override. A `require_tenant_binding` dependency rejects cross-tenant API calls and is applied first to the envelopes and templates routers. Storage writers move under `storage/accounts/<account_id>/` while DB-stored legacy paths keep resolving.

**Tech Stack:** Python 3.11, FastAPI dependencies + pure ASGI middleware, SQLAlchemy 2 async, pytest harness from Phase 0 (in-memory SQLite, `client`/`db_session` fixtures).

## Global Constraints

- Clean-room audit gate: `python scripts/audit_clean_room.py` must pass after every task. It rejects any em dash (U+2014) or en dash (U+2013) character anywhere in the repo, and any mention of a specific competitor product name. Use plain hyphens only.
- Tests bootstrap with `DOCURAMA_ENV=development` and `DOCURAMA_COOKIE_SECURE=false` via `backend/tests/conftest.py`; never weaken that.
- Commit style follows the repo convention: `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, one logical change per commit.
- Every new behavior gets a test before the implementation lands (red then green).
- Self-host behavior must not change: in `DEPLOYMENT_MODE=selfhost` (the default), every new code path is inert. Existing tests must keep passing unmodified except where a task explicitly says otherwise.
- `is_platform_admin` has no setter today (Phase 1 spec 5.1); this slice adds the service + CLI bootstrap, not a web UI.

---

### Task 1: Capability registry and platform-admin bootstrap

**Files:**
- Create: `backend/app/core/capabilities.py`
- Create: `backend/app/services/platform_admin.py`
- Create: `scripts/grant_platform_admin.py`
- Test: `backend/tests/test_capabilities.py`

**Interfaces:**
- Consumes: `settings.DEPLOYMENT_MODE` (exists, `backend/app/core/config.py:29`); `AsyncSessionLocal` from `app.core.database`; `User` model.
- Produces: `capabilities_for(mode: str) -> Capabilities` and `current_capabilities() -> Capabilities` from `app.core.capabilities` (fields: `tenant_subdomains`, `custom_domain_routing`, `billing`, `quotas`, all bool); `async def grant_platform_admin(db: AsyncSession, email: str) -> bool` from `app.services.platform_admin` (True if the user exists and now has the flag, False if no such user).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_capabilities.py`:

```python
"""
Capability registry: what a deployment mode switches on.

Cloud-only machinery (billing, quotas, tenant routing) must be impossible to
reach by accident on a self-host, and visible in one place instead of scattered
mode-string comparisons.
"""
from app.core.capabilities import capabilities_for, current_capabilities
from app.core import config


def test_cloud_mode_enables_platform_capabilities():
    caps = capabilities_for("cloud")
    assert caps.tenant_subdomains is True
    assert caps.custom_domain_routing is True
    assert caps.billing is True
    assert caps.quotas is True


def test_selfhost_mode_disables_platform_capabilities():
    caps = capabilities_for("selfhost")
    assert caps.tenant_subdomains is False
    assert caps.custom_domain_routing is False
    assert caps.billing is False
    assert caps.quotas is False


def test_unknown_mode_is_treated_as_selfhost():
    assert capabilities_for("typo").billing is False


def test_current_capabilities_reads_live_settings(monkeypatch):
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "cloud")
    assert current_capabilities().billing is True
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    assert current_capabilities().billing is False


async def test_grant_platform_admin(db_session):
    from app.core.security import get_password_hash
    from app.models import User
    from app.services.platform_admin import grant_platform_admin

    user = User(
        account_id=None,
        email="ops@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    assert await grant_platform_admin(db_session, "ops@example.com") is True
    await db_session.refresh(user)
    assert user.is_platform_admin is True


async def test_grant_platform_admin_unknown_email_is_false(db_session):
    from app.services.platform_admin import grant_platform_admin

    assert await grant_platform_admin(db_session, "nobody@example.com") is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_capabilities.py -q`
Expected: FAIL with `ModuleNotFoundError` / `ImportError` for `app.core.capabilities` and `app.services.platform_admin`.

- [ ] **Step 3: Implement the capability registry**

Create `backend/app/core/capabilities.py`:

```python
"""
Deployment capability registry.

One honest table of what each deployment mode switches on, instead of mode-string
comparisons scattered through routers. Self-host keeps every platform capability
off: there is no billing to enforce, no subdomain to route, and a capability that
accidentally lights up on a private deployment would be a defect, not a feature.
"""
from dataclasses import dataclass

from app.core import config


@dataclass(frozen=True)
class Capabilities:
    tenant_subdomains: bool      # <subdomain>.<cloud domain> routes to a tenant
    custom_domain_routing: bool  # a verified customer domain routes to its tenant
    billing: bool                # plans, subscriptions, checkout
    quotas: bool                 # per-account envelope/storage/seat limits


_CLOUD = Capabilities(
    tenant_subdomains=True,
    custom_domain_routing=True,
    billing=True,
    quotas=True,
)
_SELFHOST = Capabilities(
    tenant_subdomains=False,
    custom_domain_routing=False,
    billing=False,
    quotas=False,
)


def capabilities_for(mode: str) -> Capabilities:
    return _CLOUD if (mode or "").strip().lower() == "cloud" else _SELFHOST


def current_capabilities() -> Capabilities:
    return capabilities_for(config.settings.DEPLOYMENT_MODE)
```

- [ ] **Step 4: Implement the platform-admin service and script**

Create `backend/app/services/platform_admin.py`:

```python
"""
Platform administrator bootstrap.

users.is_platform_admin gates the deployment-wide settings (the default mail
server, and later billing and tenant administration). No web endpoint grants it:
the first platform admin is created by an operator with shell access to the
deployment, which is the same trust boundary that owns the environment.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import User


async def grant_platform_admin(db: AsyncSession, email: str) -> bool:
    user = (await db.execute(
        select(User).where(User.email == (email or "").strip().lower())
    )).scalar_one_or_none()
    if not user:
        return False
    user.is_platform_admin = True
    await db.commit()
    return True
```

Create `scripts/grant_platform_admin.py`:

```python
"""
Grant the platform-administrator flag to a user by email.

Usage (inside the API container, or any environment with a configured .env):
    python scripts/grant_platform_admin.py ops@example.com

Exits 0 when the flag was granted, 1 when the user does not exist.
"""
import asyncio
import sys

sys.path.insert(0, "backend")

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services.platform_admin import grant_platform_admin  # noqa: E402


async def main(email: str) -> int:
    async with AsyncSessionLocal() as session:
        granted = await grant_platform_admin(session, email)
    if not granted:
        print(f"No user found with email {email}")
        return 1
    print(f"Granted platform admin to {email}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python -m pytest tests/test_capabilities.py -q`
Expected: all PASS.

- [ ] **Step 6: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` (all PASS) and `python scripts/audit_clean_room.py` from the repo root (exit 0), then:

```bash
git add backend/app/core/capabilities.py backend/app/services/platform_admin.py scripts/grant_platform_admin.py backend/tests/test_capabilities.py
git commit -m "feat(cloud): capability registry and platform-admin bootstrap"
```

---

### Task 2: Subdomain rules on company creation

**Files:**
- Create: `backend/app/services/tenancy.py`
- Modify: `backend/app/api/companies.py` (create_company, around line 148)
- Test: `backend/tests/test_tenancy_rules.py`

**Interfaces:**
- Consumes: `Account` model (unique `subdomain` column); `CompanyCreate.subdomain` (optional).
- Produces: from `app.services.tenancy`: `RESERVED_SUBDOMAINS: frozenset` (www, app, api, mail, sign, verify, trust, notify, staging, admin), `SUBDOMAIN_RE` (compiled), `subdomain_error(candidate: str) -> Optional[str]` (None when acceptable, otherwise a human-readable reason), `async def subdomain_available(db: AsyncSession, candidate: str) -> bool`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_tenancy_rules.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_tenancy_rules.py -q`
Expected: FAIL on import (`app.services.tenancy` missing); the two endpoint tests also fail behaviorally (reserved subdomain currently returns 200; a taken one raises a 500 IntegrityError).

- [ ] **Step 3: Implement the rules**

Create `backend/app/services/tenancy.py`:

```python
"""
Tenant naming rules.

A subdomain is decorative in self-host but becomes a routable hostname in cloud
mode, so the rules are enforced at creation time regardless of mode: tightening
later would strand existing names.
"""
import re
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Account

# Hosts that always belong to the platform itself.
RESERVED_SUBDOMAINS = frozenset({
    "www", "app", "api", "mail", "sign", "verify", "trust", "notify",
    "staging", "admin",
})

# A DNS label: 2-40 chars, lowercase letters/digits/hyphens, no lead/trail hyphen.
SUBDOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")


def subdomain_error(candidate: str) -> Optional[str]:
    value = (candidate or "").strip().lower()
    if not value:
        return "Subdomain cannot be blank."
    if value in RESERVED_SUBDOMAINS:
        return f"'{value}' is reserved for the platform."
    if not SUBDOMAIN_RE.match(value):
        return (
            "Use 2 to 40 lowercase letters, digits, or hyphens, "
            "starting and ending with a letter or digit."
        )
    return None


async def subdomain_available(db: AsyncSession, candidate: str) -> bool:
    existing = (await db.execute(
        select(Account.id).where(Account.subdomain == candidate)
    )).scalar_one_or_none()
    return existing is None
```

In `backend/app/api/companies.py`, replace the subdomain block in `create_company` (lines 148-156, from `subdomain = company_in.subdomain or ...` through the `db.add(new_account)` / `await db.flush()`):

```python
    if company_in.subdomain:
        subdomain = company_in.subdomain.strip().lower()
        problem = subdomain_error(subdomain)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if not await subdomain_available(db, subdomain):
            raise HTTPException(
                status_code=409,
                detail=f"The subdomain '{subdomain}' is already taken.",
            )
    else:
        subdomain = f"{slugify(clean_name)}-{uuid.uuid4().hex[:6]}"

    # Create new account
    new_account = Account(
        name=clean_name,
        subdomain=subdomain,
        timezone=company_in.timezone or "(GMT+00:00) UTC",
        enforce_domain_auth=False
    )
    db.add(new_account)
    await db.flush()
```

Add the import next to the existing service imports:

```python
from app.services.tenancy import subdomain_available, subdomain_error
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_tenancy_rules.py tests/test_api_key_scoping.py -q`
Expected: all PASS (the API-key scoping suite also exercises company creation; it must stay green).

- [ ] **Step 5: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py` from the repo root, then:

```bash
git add backend/app/services/tenancy.py backend/app/api/companies.py backend/tests/test_tenancy_rules.py
git commit -m "feat(cloud): enforce subdomain rules at company creation"
```

---

### Task 3: Tenant host parsing and resolution

**Files:**
- Create: `backend/app/services/tenant_resolver.py`
- Test: `backend/tests/test_tenant_resolver.py`

**Interfaces:**
- Consumes: `settings.CLOUD_DOMAIN` (added this task to `backend/app/core/config.py`, env `DOCURAMA_CLOUD_DOMAIN`, default `"docurama.eu"`); `Account.subdomain` (excluding soft-deleted accounts via `deleted_at`); `DomainVerification` (status `verified`) joined to its Account.
- Produces: from `app.services.tenant_resolver`:
  - `@dataclass TenantContext` with fields `kind: str` (`"platform" | "subdomain" | "custom_domain" | "unknown"`), `label: Optional[str]`, `domain: Optional[str]`, `account_id: Optional[str]`.
  - `parse_tenant_host(host: str, cloud_domain: str) -> tuple[str, Optional[str], Optional[str]]` returning `(kind, label, custom_domain)`; pure, no DB. A host equal to the cloud domain, a reserved subdomain of it, or `app.<cloud>`/anything not under it is `"platform"`; `<label>.<cloud>` with a free label is `"subdomain"`; any other host is `"custom"` (the DB decides custom vs unknown).
  - `async def resolve_tenant(db: AsyncSession, host: str) -> TenantContext`.

- [ ] **Step 1: Add the setting**

In `backend/app/core/config.py`, inside `class Settings` after the `DEPLOYMENT_MODE` field:

```python
    # Cloud platform domain. Tenant subdomains live under it (acme.docurama.eu).
    CLOUD_DOMAIN: str = os.getenv("DOCURAMA_CLOUD_DOMAIN", "docurama.eu")
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_tenant_resolver.py`:

```python
"""
Host-to-tenant resolution: the pure parser decides what kind of host this is;
the DB lookup decides which account (if any) owns it.
"""
from app.services.tenant_resolver import parse_tenant_host


def test_cloud_domain_itself_is_platform():
    assert parse_tenant_host("docurama.eu", "docurama.eu") == ("platform", None, None)


def test_reserved_and_app_hosts_are_platform():
    for host in ("www.docurama.eu", "app.docurama.eu", "api.docurama.eu",
                 "verify.docurama.eu", "trust.docurama.eu"):
        assert parse_tenant_host(host, "docurama.eu")[0] == "platform", host


def test_free_subdomain_is_a_tenant_label():
    assert parse_tenant_host("acme.docurama.eu", "docurama.eu") == (
        "subdomain", "acme", None
    )


def test_multi_level_host_is_not_a_tenant_label():
    # a.b.docurama.eu is not a valid tenant hostname; treat as custom/unknown.
    kind, label, _ = parse_tenant_host("a.b.docurama.eu", "docurama.eu")
    assert kind == "custom"
    assert label is None


def test_unrelated_host_is_a_custom_domain_candidate():
    assert parse_tenant_host("sign.acme.com", "docurama.eu") == (
        "custom", None, "sign.acme.com"
    )


def test_case_and_port_are_normalized():
    assert parse_tenant_host("ACME.Docurama.EU:443", "docurama.eu") == (
        "subdomain", "acme", None
    )


def test_empty_host_is_platform():
    assert parse_tenant_host("", "docurama.eu")[0] == "platform"


async def test_resolve_subdomain_tenant(client, db_session):
    from app.models import Account
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Acme", subdomain="acme")
    db_session.add(account)
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "acme.docurama.eu")
    assert ctx.kind == "subdomain"
    assert ctx.account_id == account.id


async def test_resolve_deleted_subdomain_is_unknown(client, db_session):
    from datetime import datetime, timezone

    from app.models import Account
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Gone", subdomain="gone",
                      deleted_at=datetime.now(timezone.utc))
    db_session.add(account)
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "gone.docurama.eu")
    assert ctx.kind == "unknown"
    assert ctx.account_id is None


async def test_resolve_verified_custom_domain(client, db_session):
    from app.models import Account, DomainVerification
    from app.services.tenant_resolver import resolve_tenant

    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    db_session.add(DomainVerification(
        account_id=account.id, domain="sign.acme.com", status="verified",
        verification_token="dcr_vfy_test", verification_method="dns_txt",
        txt_record_host="_docurama-challenge.sign.acme.com",
        txt_record_value="docurama-verification=dcr_vfy_test",
        cname_record_host="unused", cname_target="unused",
    ))
    await db_session.commit()

    ctx = await resolve_tenant(db_session, "sign.acme.com")
    assert ctx.kind == "custom_domain"
    assert ctx.account_id == account.id


async def test_resolve_unclaimed_custom_domain_is_unknown(client, db_session):
    from app.services.tenant_resolver import resolve_tenant

    ctx = await resolve_tenant(db_session, "stranger.example")
    assert ctx.kind == "unknown"
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_tenant_resolver.py -q`
Expected: FAIL on import (`app.services.tenant_resolver` missing).

- [ ] **Step 4: Implement the resolver**

Create `backend/app/services/tenant_resolver.py`:

```python
"""
Host-to-tenant resolution.

The parser is pure so routing rules can be tested without a database; the
resolver turns a parsed host into the account that owns it. Soft-deleted
accounts never resolve: their envelopes must keep verifying, but their
hostname must not serve a workspace.
"""
from dataclasses import dataclass
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Account, DomainVerification
from app.services.tenancy import RESERVED_SUBDOMAINS

PLATFORM = "platform"
SUBDOMAIN = "subdomain"
CUSTOM_DOMAIN = "custom_domain"
UNKNOWN = "unknown"


def _host_only(value: str) -> str:
    return (value or "").strip().lower().split(":")[0]


def parse_tenant_host(host: str, cloud_domain: str) -> Tuple[str, Optional[str], Optional[str]]:
    host = _host_only(host)
    cloud_domain = _host_only(cloud_domain)
    if not host or host == cloud_domain:
        return PLATFORM, None, None

    suffix = f".{cloud_domain}"
    if host.endswith(suffix):
        label = host[: -len(suffix)]
        if "." in label:
            return CUSTOM_DOMAIN, None, host
        if label in RESERVED_SUBDOMAINS:
            return PLATFORM, None, None
        return SUBDOMAIN, label, None

    return CUSTOM_DOMAIN, None, host


@dataclass
class TenantContext:
    kind: str
    label: Optional[str] = None
    domain: Optional[str] = None
    account_id: Optional[str] = None


async def resolve_tenant(db: AsyncSession, host: str) -> TenantContext:
    from app.core.config import settings

    kind, label, custom_domain = parse_tenant_host(host, settings.CLOUD_DOMAIN)

    if kind == PLATFORM:
        return TenantContext(kind=PLATFORM)

    if kind == SUBDOMAIN:
        account_id = (await db.execute(
            select(Account.id).where(
                Account.subdomain == label,
                Account.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if account_id:
            return TenantContext(kind=SUBDOMAIN, label=label, account_id=account_id)
        return TenantContext(kind=UNKNOWN, label=label)

    # A verified custom domain routes to its owner; anything else is unknown.
    row = (await db.execute(
        select(DomainVerification.account_id, Account.deleted_at)
        .join(Account, Account.id == DomainVerification.account_id)
        .where(
            DomainVerification.domain == custom_domain,
            DomainVerification.status == "verified",
        )
    )).first()
    if row and row.deleted_at is None:
        return TenantContext(kind=CUSTOM_DOMAIN, domain=custom_domain,
                             account_id=row.account_id)
    return TenantContext(kind=UNKNOWN, domain=custom_domain)
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python -m pytest tests/test_tenant_resolver.py -q`
Expected: all PASS.

- [ ] **Step 6: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py` from the repo root, then:

```bash
git add backend/app/core/config.py backend/app/services/tenant_resolver.py backend/tests/test_tenant_resolver.py
git commit -m "feat(cloud): tenant host parsing and account resolution"
```

---

### Task 4: Tenant middleware, tenant-binding enforcement, and cloud CORS

**Files:**
- Create: `backend/app/core/tenant_middleware.py`
- Create: `backend/app/api/tenant.py` (the two dependencies)
- Modify: `backend/app/main.py` (register middleware, swap CORS construction)
- Modify: `backend/app/api/envelopes.py`, `backend/app/api/templates.py` (apply `require_tenant_binding` to account-scoped endpoints)
- Modify: `backend/app/api/auth.py` (expose the resolved tenant check inside `get_current_user` is NOT changed in this task; see Interfaces)
- Test: `backend/tests/test_tenant_routing.py`

**Interfaces:**
- Consumes: `parse_tenant_host`, `resolve_tenant`, `TenantContext` (Task 3); `current_capabilities()` (Task 1); `get_current_user` (auth.py).
- Produces:
  - `TenantHostMiddleware` (pure ASGI middleware, no DB): sets `request.state.tenant_host` to the raw host string in every mode; nothing else. Registered with `app.add_middleware(TenantHostMiddleware)`.
  - `async def current_tenant(request: Request, db = Depends(get_db)) -> TenantContext` in `backend/app/api/tenant.py`: resolves via `resolve_tenant` when `current_capabilities().tenant_subdomains or current_capabilities().custom_domain_routing` is True, else returns a platform context. Caches on `request.state.tenant_context`.
  - `async def require_tenant_binding(request: Request, current_user: User = Depends(get_current_user), db = Depends(get_db)) -> TenantContext`: returns the tenant context, raising 404 (`detail="Unknown workspace."`) when the host resolves to `unknown`, and 403 (`detail="This workspace lives at <expected host>."`) when the host belongs to a tenant other than the caller's active account. Platform hosts never raise. Safe paths are exempt by construction: the dependency is only applied to account-scoped routers.
- Enforcement scope this slice: envelopes and templates routers only. Folders, webhooks, settings, domains, documents, stamps get the dependency in the onboarding slice.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_tenant_routing.py`:

```python
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
    seen = {}

    from app.main import app

    @app.get("/api/_tenant_probe")
    async def probe(request):
        seen["host"] = getattr(request.state, "tenant_host", None)
        return {"host": seen["host"]}

    try:
        await client.get("/api/_tenant_probe", headers={"Host": "acme.docurama.eu"})
    finally:
        app.router.routes.pop(0)

    assert seen["host"] == "acme.docurama.eu"


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
    assert resp.status_code == 404  # ordinary scoping, not tenant routing


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
```

Note on `test_middleware_records_host_on_state`: the probe route must be removed after the test (the `finally` pops the first route) so no test-only route leaks into the app for other tests. If popping index 0 proves fragile (route ordering), instead register the probe with a unique path and leave it registered, asserting via the response body only; do whichever is less brittle and say so in the report.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_tenant_routing.py -q`
Expected: FAIL on import (`app.core.tenant_middleware`, `app.api.tenant`, `build_cors_policy` missing). The 403/404 cross-tenant tests fail because no enforcement exists yet.

- [ ] **Step 3: Implement the middleware and dependencies**

Create `backend/app/core/tenant_middleware.py`:

```python
"""
Record the host a request arrived on.

Deliberately pure: no database, no policy. Resolution to an account happens in
the tenant dependency, which runs inside the request's dependency graph and
therefore uses the same session (and the same test overrides) as everything
else. The middleware exists so the host is captured before any routing
decision, on every request, in every mode.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class TenantHostMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.tenant_host = request.headers.get("host", "")
        return await call_next(request)
```

Create `backend/app/api/tenant.py`:

```python
"""
Tenant context dependencies.

current_tenant answers "which tenant, if any, does this host belong to".
require_tenant_binding answers "may this session act on this host's tenant".
Platform hosts (the marketing domain, app., api., reserved names) never raise:
the platform is every tenant's front door.
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.capabilities import current_capabilities
from app.core.database import get_db
from app.core.tenant_middleware import TenantHostMiddleware  # noqa: F401  (re-export)
from app.api.auth import get_current_user
from app.models import User
from app.services.tenant_resolver import (
    PLATFORM,
    UNKNOWN,
    TenantContext,
    resolve_tenant,
)


def _tenant_routing_enabled() -> bool:
    caps = current_capabilities()
    return caps.tenant_subdomains or caps.custom_domain_routing


async def current_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    cached = getattr(request.state, "tenant_context", None)
    if cached is not None:
        return cached
    if not _tenant_routing_enabled():
        context = TenantContext(kind=PLATFORM)
    else:
        context = await resolve_tenant(db, getattr(request.state, "tenant_host", ""))
    request.state.tenant_context = context
    return context


async def require_tenant_binding(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    context = await current_tenant(request, db)
    if context.kind == PLATFORM:
        return context
    if context.kind == UNKNOWN:
        raise HTTPException(status_code=404, detail="Unknown workspace.")
    if context.account_id and current_user.account_id != context.account_id:
        raise HTTPException(
            status_code=403,
            detail="This workspace is not served here. Sign in at the platform root.",
        )
    return context
```

In `backend/app/main.py`:

Add the import near the other app imports:

```python
from app.core.tenant_middleware import TenantHostMiddleware
```

Add the `build_cors_policy` function above `app = FastAPI(...)`:

```python
def build_cors_policy(cfg):
    """
    Cloud deployments serve every tenant subdomain, so a fixed origin list can
    never be complete; a strict regex over the cloud domain replaces it. Self-host
    keeps the explicit list: it has exactly the origins the operator named.
    """
    if (cfg.DEPLOYMENT_MODE or "").strip().lower() != "cloud":
        return list(cfg.ALLOWED_ORIGINS), None

    cloud_domain = cfg.CLOUD_DOMAIN.strip().lower()
    pattern = (
        r"^https://([a-z0-9-]+\.)*"
        + cloud_domain.replace(".", r"\.")
        + r"$"
    )
    # APP_URL's host (e.g. app.docurama.eu) already matches the pattern.
    return [], re.compile(pattern)
```

Add `import re` at the top of main.py if absent. Replace the CORS middleware registration:

```python
cors_origins, cors_origin_regex = build_cors_policy(settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex.pattern if cors_origin_regex else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Register the middleware after the CORS block:

```python
app.add_middleware(TenantHostMiddleware)
```

In `backend/app/api/envelopes.py`: add to the imports

```python
from app.api.tenant import require_tenant_binding
```

and add `_tenant: TenantContext = Depends(require_tenant_binding)` to the parameters of exactly these endpoints: the list endpoint (`GET ""`), the get-by-id endpoint (`GET /{envelope_id}`), the CSV export, the download, and the certificate endpoints (all account-scoped GETs; creation endpoints stay open because drafts are created from the platform root and the builder posts there). Add the matching import `from app.services.tenant_resolver import TenantContext`. Do not change any endpoint body.

In `backend/app/api/templates.py`: apply the same dependency to `GET ""`, `GET /{template_id}`, and `DELETE /{template_id}`; leave `POST /auto-detect`, `GET /public/{slug}`, and `POST /public/{slug}/start` untouched (public by design).

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_tenant_routing.py tests/test_tenant_isolation.py -q`
Expected: all PASS.

- [ ] **Step 5: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py` from the repo root, then:

```bash
git add backend/app/core/tenant_middleware.py backend/app/api/tenant.py backend/app/main.py backend/app/api/envelopes.py backend/app/api/templates.py backend/tests/test_tenant_routing.py
git commit -m "feat(cloud): tenant middleware, binding enforcement on core routers, cloud CORS"
```

---

### Task 5: Per-account storage layout for document artifacts

**Files:**
- Create: `backend/app/services/storage_layout.py`
- Modify: `backend/app/api/envelopes.py` (both original-PDF writers)
- Modify: `backend/app/api/templates.py` (template upload writer, template-to-envelope copy writer)
- Modify: `backend/app/api/signing.py` (flattened, certificate, combined, sealed writers)
- Test: `backend/tests/test_storage_layout.py`

**Interfaces:**
- Consumes: `settings.STORAGE_DIR`; `Account.subdomain`-independent `Account.id`; `preview_store.is_valid_account_id` (exists from Phase 0).
- Produces: from `app.services.storage_layout`:
  - `account_root(storage_dir: str, account_id: str) -> str` returning `<storage_dir>/accounts/<account_id>`, raising `ValueError` on an invalid account id.
  - `artifact_path(storage_dir: str, account_id: str, filename: str) -> str`, which also validates that `filename` contains no path separators (raises `ValueError` otherwise).
  - `def ensure_dir(path: str) -> str` creating and returning the directory.
- Writer rule: every NEW envelope/template/signing artifact is written under `account_root`; the path stored in the DB is whatever the writer returns, so old rows with flat paths keep reading unchanged.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_storage_layout.py`:

```python
"""
Document artifacts belong to the account that owns them. New writes land under
storage/accounts/<account_id>/; legacy rows keep their stored flat paths.
"""
import os

import pytest

from app.services.storage_layout import account_root, artifact_path, ensure_dir


def test_account_root_is_namespaced():
    root = account_root("/data", "0b5a9a4e-1111-4222-8333-444455556666")
    assert root == os.path.join("/data", "accounts",
                                "0b5a9a4e-1111-4222-8333-444455556666")


def test_rejects_invalid_account_ids():
    with pytest.raises(ValueError):
        account_root("/data", "../escape")
    with pytest.raises(ValueError):
        account_root("/data", "")


def test_artifact_path_joins_safely():
    path = artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                         "env_original.pdf")
    assert path.endswith(os.path.join("accounts",
                                      "0b5a9a4e-1111-4222-8333-444455556666",
                                      "env_original.pdf"))


def test_artifact_path_rejects_separators():
    with pytest.raises(ValueError):
        artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666",
                      "sub/dir/file.pdf")
    with pytest.raises(ValueError):
        artifact_path("/data", "0b5a9a4e-1111-4222-8333-444455556666", "..\\x.pdf")


def test_ensure_dir_creates_and_is_idempotent(tmp_path):
    target = os.path.join(str(tmp_path), "accounts", "x")
    first = ensure_dir(target)
    second = ensure_dir(target)
    assert os.path.isdir(first)
    assert first == second == target
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_storage_layout.py -q`
Expected: FAIL on import.

- [ ] **Step 3: Implement the layout module**

Create `backend/app/services/storage_layout.py`:

```python
"""
Per-account storage layout.

Every new document artifact is written under
<STORAGE_DIR>/accounts/<account_id>/ so a tenant's files live together and a
future storage backend can map the layout directly. Paths are stored in the
database exactly as written, so rows created before this layout keep reading
their flat paths with no migration.
"""
import os

from app.services.preview_store import is_valid_account_id


def account_root(storage_dir: str, account_id: str) -> str:
    if not is_valid_account_id(account_id):
        raise ValueError(f"Invalid account id: {account_id!r}")
    return os.path.join(storage_dir, "accounts", account_id)


def artifact_path(storage_dir: str, account_id: str, filename: str) -> str:
    if not filename or os.path.basename(filename) != filename:
        raise ValueError(f"Artifact filename must be a bare name: {filename!r}")
    return os.path.join(account_root(storage_dir, account_id), filename)


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path
```

- [ ] **Step 4: Move the writers**

In `backend/app/api/envelopes.py`, find the two original-PDF writes (around line 77: `f"{envelope_id}_original{ext}"` after multipart upload; around line 376: `f"{envelope_id}_original.pdf"` in the bulk path). For each: the creating user's `current_user.account_id` (upload path) / the template's account (bulk path) is available; replace the flat join with:

```python
    from app.services.storage_layout import artifact_path, ensure_dir  # top-level import

    pdf_path = artifact_path(settings.STORAGE_DIR, account_id, f"{envelope_id}_original{ext}")
    ensure_dir(os.path.dirname(pdf_path))
```

Use the variable that already holds the account id at that write site (`current_user.account_id` in the upload handler; the envelope's account in bulk). Keep the DB value exactly the returned path.

In `backend/app/api/templates.py`, the template upload write (around line 64, `template_{template_id}{ext}`) and the template-to-envelope copy (around line 172, `{envelope_id}_original.pdf`): apply the same pattern, using the account id the template/envelope belongs to.

In `backend/app/api/signing.py`, the four writers (`{id}_flattened.pdf`, `{id}_certificate.pdf`, `{id}_combined.pdf`, `{id}_sealed.pdf`, around lines 360-442): each handler has the `envelope` loaded; use `envelope.account_id` with the same pattern. Read each site first; preserve every other behavior (the seal pipeline order, the `sealed=False` fallback copy).

Every modified site MUST ensure the account directory exists before opening the file for writing (`ensure_dir(os.path.dirname(pdf_path))`).

- [ ] **Step 5: Add one endpoint-level test proving the layout**

Append to `backend/tests/test_storage_layout.py`:

```python
async def test_template_upload_lands_in_account_dir(client, db_session, tmp_path,
                                                    monkeypatch):
    from app.core import config
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path))

    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(account_id=account.id, email="uploader@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()

    login = await client.post("/api/auth/login",
                              json={"email": "uploader@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    from app.services.pdf_service import get_pdf_pages_info  # noqa: F401
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    resp = await client.post(
        "/api/templates",
        data={"title": "Layout Probe"},
        files={"file": ("probe.pdf", minimal_pdf, "application/pdf")},
    )
    assert resp.status_code == 200, resp.text

    account_dir = tmp_path / "accounts" / account.id
    assert account_dir.is_dir()
    files = list(account_dir.iterdir())
    assert files, "no artifact written under the account directory"
```

Read `backend/app/api/templates.py`'s upload endpoint first: if it requires additional form fields, include them; if it validates the PDF by parsing (pages info), and the minimal PDF above fails validation, use the same minimal-PDF bytes that `test_preview_scoping.py` or the preview upload path accepts, or generate the bytes via the repo's `reportlab`-free approach used in existing tests; record what you did. If the endpoint turns out to require a parseable PDF that the minimal bytes cannot satisfy, mark this test with the same skip approach as argon2 (run inside the image) rather than loosening validation, and say so in the report.

- [ ] **Step 6: Run the tests**

Run: `cd backend && python -m pytest tests/test_storage_layout.py tests/test_tenant_isolation.py tests/test_security_hardening.py -q`
Expected: all PASS.

- [ ] **Step 7: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` and `python scripts/audit_clean_room.py` from the repo root, then:

```bash
git add backend/app/services/storage_layout.py backend/app/api/envelopes.py backend/app/api/templates.py backend/app/api/signing.py backend/tests/test_storage_layout.py
git commit -m "feat(cloud): write document artifacts under per-account storage directories"
```

---

### Task 6: Deployment configuration and documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (new "Deployment modes" subsection under Quick Start)
- Test: none beyond the audit gate (documentation task)

**Interfaces:**
- Consumes: `DOCURAMA_DEPLOYMENT_MODE`, `DOCURAMA_PUBLIC_REGISTRATION` (exist from Phase 0), `DOCURAMA_CLOUD_DOMAIN` (Task 3).
- Produces: operator-facing configuration documentation.

- [ ] **Step 1: Extend .env.example**

Append under the Application section (after the existing `DOCURAMA_PUBLIC_REGISTRATION=false` block):

```
# Cloud platform domain. In cloud mode, tenant workspaces are served at
# <subdomain>.<cloud domain> and verified custom domains. Leave the default on
# self-host; it is inert there.
DOCURAMA_CLOUD_DOMAIN=docurama.eu

# Grant the deployment-wide administrator flag (default mail server, platform
# settings) to a user. Run inside the API container:
#   python scripts/grant_platform_admin.py ops@example.com
```

- [ ] **Step 2: Add a Deployment modes section to the README**

Insert after the "Quick Start" heading's environment step (before "1a. Database Migrations"):

```markdown
### 1b. Deployment Modes

Docurama runs in two modes, selected with `DOCURAMA_DEPLOYMENT_MODE`:

- `selfhost` (default): one operator, one domain. Public registration is closed
  unless you set `DOCURAMA_PUBLIC_REGISTRATION=true`; platform features such as
  billing, quotas, and tenant subdomain routing are off.
- `cloud`: the public multi-tenant platform. Registration is open, tenant
  workspaces are served at `<company>.<DOCURAMA_CLOUD_DOMAIN>`, verified custom
  domains route to their tenant, and billing/quotas are active.

Grant the platform administrator (deployment-wide settings) with:

```bash
python scripts/grant_platform_admin.py ops@example.com
```
```

- [ ] **Step 3: Audit and commit**

Run: `python scripts/audit_clean_room.py` (exit 0), then:

```bash
git add .env.example README.md
git commit -m "docs(cloud): deployment modes and platform admin bootstrap"
```

---

## Deliberately deferred from this slice (next slices, in order)

- Onboarding wizard, invite-by-email flow, branding UI (spec 5.4)
- Domain verification UX for non-technical users (spec 5.4 second half)
- Verification channels: email OTP / Telegram / WhatsApp / SMS (spec 5.5)
- UI/UX redesign (spec 5.7)
- Quotas and metering (spec 5.8); Stripe billing (spec 5.9); EU ops compose project (spec 5.10)
- `require_tenant_binding` applied to the remaining account-scoped routers (folders, webhooks, settings, domains, documents, stamps)
- Tenant-aware SPA shell (404 page for unknown subdomains at the HTML level)
