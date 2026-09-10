# Phase 0: Self-Host Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the urgent security exposures on the live docurama.stalfe.com instance and give it upgrade, backup, and CI machinery.

**Architecture:** Backend-only changes to the FastAPI app (config guard, auth, domains, documents, settings) plus ops scripts and a GitHub Actions workflow. New HTTP-level tests run the real app against an in-memory SQLite database via dependency override, which is also the foundation for later tenant-isolation regression tests.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 async, pytest + pytest-asyncio + httpx, slowapi, bash, GitHub Actions.

## Global Constraints

- Clean-room audit gate: `python scripts/audit_clean_room.py` must pass after every task. It rejects any em dash (U+2014) or en dash (U+2013) character anywhere in the repo, and any mention of a specific competitor product name. Use plain hyphens only; never name that competitor in files.
- Tests bootstrap with `DOCURAMA_ENV=development` via `backend/tests/conftest.py`; never weaken that.
- Passwords are minimum 12 characters everywhere (matches existing change/reset rules in `backend/app/services/password_reset.py`).
- Commit style follows the repo convention: `fix(scope): ...`, `feat(scope): ...`, `test(scope): ...`, one logical change per commit.
- Production code must never log or return secrets, tokens, or other tenants' data. Error messages stay uniform where the current code is deliberately uniform (login, password reset).
- New dependencies go into `backend/requirements.txt` pinned the same way as neighbors.

---

### Task 1: Remove the tracked session cookie file

**Files:**
- Delete: `cookies.txt`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo with no tracked session cookies; `.gitignore` entry that keeps them out.

- [ ] **Step 1: Verify the file is tracked and remove it**

Run: `cd "D:/Dev/Under-Development/IDE-VSCode-Ops-Workspace/docurama" && git ls-files cookies.txt && git rm cookies.txt`
Expected: the path prints once, then `rm 'cookies.txt'`.

- [ ] **Step 2: Add an ignore rule so a re-export cannot come back**

Append to `.gitignore`:

```
# Exported cookie jars must never be committed; they contain live sessions.
cookies.txt
*_cookies.txt
```

- [ ] **Step 3: Verify tracking is gone**

Run: `git ls-files cookies.txt`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "fix(security): remove tracked session cookie file and ignore cookie jars"
```

Note for the operator (not a repo change): the JWT that was inside `cookies.txt` was signed by the production `DOCURAMA_SECRET_KEY`; rotating that key in Task 2's wake-up procedure invalidates it. Record this in the deployment runbook when Task 2 is applied.

---

### Task 2: Production guard blacklists shipped secret values

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `docker-compose.engine.yml`
- Modify: `backend/tests/test_security_hardening.py`
- Modify: `README.md` (self-host section only, one line)

**Interfaces:**
- Consumes: `DEV_SECRET_KEY`, `_validate_production_secrets(cfg)` from `backend/app/core/config.py:93-124`.
- Produces: module constant `KNOWN_WEAK_SECRET_KEYS: set[str]` checked by the guard; engine compose that refuses to start without `DOCURAMA_SECRET_KEY` from the environment.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_security_hardening.py`:

```python
def test_production_guard_rejects_engine_compose_secret():
    from app.core.config import Settings, _validate_production_secrets

    cfg = Settings(
        ENV="production",
        SECRET_KEY="docurama-production-secret-key-2026-crypto",
        P12_PASSWORD="a-real-p12-password",
        APP_URL="https://docurama.stalfe.com",
    )
    with pytest.raises(RuntimeError) as exc:
        _validate_production_secrets(cfg)
    assert "shipped with the repository" in str(exc.value)


def test_production_guard_accepts_fresh_secret():
    from app.core.config import Settings, _validate_production_secrets

    cfg = Settings(
        ENV="production",
        SECRET_KEY="f" * 48,
        P12_PASSWORD="a-real-p12-password",
        APP_URL="https://docurama.stalfe.com",
    )
    _validate_production_secrets(cfg)  # must not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_security_hardening.py -k engine_compose -q`
Expected: FAIL (RuntimeError not raised; the guard accepts the value today).

- [ ] **Step 3: Implement the blacklist**

In `backend/app/core/config.py`, add after the `DEV_P12_PASSWORD` definition (near line 9):

```python
# Values that have shipped inside repository files. A secret that was ever printed
# in a compose file or README is public knowledge, so production refuses each of
# them exactly like the development default.
KNOWN_WEAK_SECRET_KEYS = {
    "docurama-production-secret-key-2026-crypto",
}
```

Inside `_validate_production_secrets`, after the `cfg.SECRET_KEY == DEV_SECRET_KEY` check, add:

```python
    if cfg.SECRET_KEY in KNOWN_WEAK_SECRET_KEYS:
        problems.append("DOCURAMA_SECRET_KEY is a value shipped with the repository; generate a fresh one")
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && python -m pytest tests/test_security_hardening.py -q`
Expected: all PASS.

- [ ] **Step 5: Remove the shipped value from the engine compose**

In `docker-compose.engine.yml`, replace the line:

```yaml
      - DOCURAMA_SECRET_KEY=docurama-production-secret-key-2026-crypto
```

with:

```yaml
      - DOCURAMA_SECRET_KEY=${DOCURAMA_SECRET_KEY:?generate one: python -c "import secrets; print(secrets.token_urlsafe(48))"}
```

- [ ] **Step 6: Run the audit gate**

Run: `python scripts/audit_clean_room.py`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/config.py backend/tests/test_security_hardening.py docker-compose.engine.yml
git commit -m "fix(security): refuse to boot production with repository-shipped secret keys"
```

---

### Task 3: HTTP-level test harness (in-memory SQLite + AsyncClient)

**Files:**
- Create: `backend/tests/http_conftest.py`
- Create: `backend/pytest.ini`
- Modify: `backend/requirements.txt` (add `aiosqlite`, `pytest-asyncio`; httpx and slowapi arrive in Tasks 5)
- Test: `backend/tests/test_http_harness.py`

**Interfaces:**
- Consumes: `app.core.database.Base`, `app.core.database.get_db`, `app.main.app`.
- Produces: fixtures `db_session` (SQLAlchemy AsyncSession bound to in-memory SQLite with schema created) and `client` (httpx AsyncClient running the real app with `get_db` overridden). Later tasks import these from `tests.http_conftest`.

- [ ] **Step 1: Add test dependencies**

Append to `backend/requirements.txt` (match neighbor pin style):

```
aiosqlite>=0.20
pytest-asyncio>=0.24
```

- [ ] **Step 2: Create pytest.ini**

Create `backend/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
```

- [ ] **Step 3: Create the fixtures**

Create `backend/tests/http_conftest.py`:

```python
"""
HTTP-level test harness.

Runs the real FastAPI application against an in-memory SQLite database by
overriding the get_db dependency. Existing unit tests stay synchronous; these
fixtures are the foundation for endpoint and tenant-isolation tests.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.core.database import Base, get_db
from app.main import app


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 4: Write the smoke test**

Create `backend/tests/test_http_harness.py`:

```python
async def test_health_endpoint_via_http(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "docurama-backend"
```

- [ ] **Step 5: Install and run**

Run: `cd backend && pip install -r requirements.txt && python -m pytest tests/test_http_harness.py -q`
Expected: PASS.

- [ ] **Step 6: Run the whole suite to prove nothing regressed**

Run: `cd backend && python -m pytest tests -q`
Expected: same or more passing than before; no new failures.

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/pytest.ini backend/tests/http_conftest.py backend/tests/test_http_harness.py
git commit -m "test: HTTP-level harness with in-memory SQLite and dependency override"
```

---

### Task 4: Deployment mode gate on registration + password minimum

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/schemas/schemas.py:5-9`
- Modify: `backend/app/api/auth.py:221-270`
- Modify: `.env.example`
- Test: `backend/tests/test_registration_gate.py`

**Interfaces:**
- Consumes: `settings` singleton; `UserCreate` schema; `register` endpoint.
- Produces: `settings.DEPLOYMENT_MODE: str` ("selfhost" default, "cloud" later) and `settings.registration_open: bool`. Endpoints and later phases read these; the signup UI is expected to surface the 403 detail message.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_registration_gate.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_registration_gate.py -q`
Expected: FAIL. Closed case returns 200 today (gate does not exist) and the short password is accepted.

- [ ] **Step 3: Add deployment mode to settings**

In `backend/app/core/config.py`, inside `class Settings` (after the `ENV` field near line 18):

```python
    # Deployment mode. selfhost: one operator, registration closed unless opened
    # deliberately. cloud: the public multi-tenant platform, registration open.
    DEPLOYMENT_MODE: str = os.getenv("DOCURAMA_DEPLOYMENT_MODE", "selfhost")
```

After the `is_development` property, add:

```python
    @property
    def registration_open(self) -> bool:
        if self.DEPLOYMENT_MODE.strip().lower() == "cloud":
            return True
        return os.getenv("DOCURAMA_PUBLIC_REGISTRATION", "false").strip().lower() in (
            "1", "true", "yes", "on",
        )
```

- [ ] **Step 4: Enforce the password minimum at registration**

In `backend/app/schemas/schemas.py`, change:

```python
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
```

to:

```python
class UserCreate(BaseModel):
    email: EmailStr
    # Same floor as password change and reset. Registration used to accept
    # anything, so the weakest credential in the system was set at sign-up.
    password: str = PydanticField(min_length=12)
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
```

- [ ] **Step 5: Gate the register endpoint**

In `backend/app/api/auth.py`, at the top of `register()` (after the signature, before the existing-user query):

```python
    if not settings.registration_open:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Registration is closed on this deployment. "
                "Ask an existing administrator to invite you."
            ),
        )
```

- [ ] **Step 6: Document the knobs in .env.example**

Append to `.env.example` under the Application section:

```
# Deployment mode: selfhost (default) keeps public registration closed unless
# DOCURAMA_PUBLIC_REGISTRATION=true; cloud opens registration for the SaaS platform.
DOCURAMA_DEPLOYMENT_MODE=selfhost
DOCURAMA_PUBLIC_REGISTRATION=false
```

- [ ] **Step 7: Run tests**

Run: `cd backend && python -m pytest tests/test_registration_gate.py tests/test_security_hardening.py -q`
Expected: all PASS.

- [ ] **Step 8: Audit and commit**

Run: `python scripts/audit_clean_room.py` (expected exit 0), then:

```bash
git add backend/app/core/config.py backend/app/schemas/schemas.py backend/app/api/auth.py .env.example backend/tests/test_registration_gate.py
git commit -m "feat(auth): deployment mode with registration gate and password minimum"
```

---

### Task 5: Rate limiting on auth and upload endpoints

**Files:**
- Modify: `backend/requirements.txt` (add `slowapi>=0.1.9`)
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/auth.py` (register, login, request-password-reset, totp/verify)
- Modify: `backend/app/api/verify.py` (upload)
- Modify: `backend/tests/http_conftest.py`
- Test: `backend/tests/test_rate_limits.py`

**Interfaces:**
- Consumes: `app.main.app`; slowapi `Limiter`.
- Produces: `limiter` instance on `app.state.limiter`; fixtures reset it between tests via the shared harness. 429 responses with `Retry-After` semantics provided by slowapi.

- [ ] **Step 1: Add dependency**

Append to `backend/requirements.txt`: `slowapi>=0.1.9`

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_rate_limits.py`:

```python
async def test_login_is_rate_limited(client, db_session):
    from app.core import config
    config.settings.REGISTRATION_OPEN = True  # not needed for login; keep env stable
    for _ in range(10):
        resp = await client.post("/api/auth/login", json={
            "email": "nobody@example.com", "password": "whatever-password",
        })
        assert resp.status_code == 400  # wrong credentials, uniform message
    eleventh = await client.post("/api/auth/login", json={
        "email": "nobody@example.com", "password": "whatever-password",
    })
    assert eleventh.status_code == 429
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && pip install -r requirements.txt && python -m pytest tests/test_rate_limits.py -q`
Expected: FAIL (all responses are 400; no limiter exists).

- [ ] **Step 4: Wire the limiter into the app**

In `backend/app/main.py`, add imports near the top:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
```

After `app = FastAPI(...)` (before the CORS middleware), add:

```python
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

- [ ] **Step 5: Decorate the auth endpoints**

In `backend/app/api/auth.py`, import the limiter:

```python
from app.main import limiter
```

If that import creates a cycle (auth is imported by main through the router), instead import inside the module as `from app.core.rate_limit import limiter` after creating `backend/app/core/rate_limit.py`:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
```

and in `main.py` import it from there (`from app.core.rate_limit import limiter`). Prefer the separate module; it avoids the cycle entirely.

Then apply to four endpoints (each must gain a `request: Request` parameter if absent; register already lacks it, login lacks it, both reset endpoints: `request-password-reset` already takes `request`):

```python
@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
async def register(request: Request, user_in: UserCreate, response: Response, db: AsyncSession = Depends(get_db)):
    ...

@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, credentials: UserLogin, response: Response, db: AsyncSession = Depends(get_db)):
    ...

@router.post("/totp/verify", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_totp_login(request: Request, payload: TotpLoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    ...

@router.post("/request-password-reset", response_model=GenericAckResponse)
@limiter.limit("5/minute")
async def request_password_reset(payload: PasswordResetRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ...
```

Keep the existing bodies; only signatures and decorators change.

- [ ] **Step 6: Decorate the unauthenticated verify upload**

In `backend/app/api/verify.py`, add `from app.core.rate_limit import limiter` and `from fastapi import Request`, then decorate the upload endpoint and add the parameter, following the same pattern as above with `"10/minute"`.

- [ ] **Step 7: Reset limiter state between tests**

In `backend/tests/http_conftest.py`, extend the `client` fixture before yielding:

```python
    from app.core.rate_limit import limiter
    limiter.reset()
```

- [ ] **Step 8: Run the tests**

Run: `cd backend && python -m pytest tests/test_rate_limits.py tests/test_registration_gate.py tests/test_http_harness.py -q`
Expected: all PASS (registration-gate tests stay under 5 requests per test thanks to the reset).

- [ ] **Step 9: Audit and commit**

```bash
git add backend/requirements.txt backend/app/core/rate_limit.py backend/app/main.py backend/app/api/auth.py backend/app/api/verify.py backend/tests/http_conftest.py backend/tests/test_rate_limits.py
git commit -m "feat(security): rate limit authentication and public upload endpoints"
```

---

### Task 6: API-key scopes enforced, no account mutation per request

**Files:**
- Modify: `backend/app/api/auth.py:137-219`
- Modify: `backend/app/services/api_keys.py` (mint default scopes; verify current default first)
- Test: `backend/tests/test_api_key_scoping.py`

**Interfaces:**
- Consumes: `api_key_service.parse_prefix`, `verify_api_key`, `is_usable`; `ApiKey`, `User` models; the harness fixtures.
- Produces: API-key auth that (a) rejects write-method calls for keys without a `"write"` scope with 403, (b) never persists `owner.account_id` changes caused by key use. `get_current_user` behavior for cookie/bearer callers is unchanged.

- [ ] **Step 1: Inspect the mint default**

Run: `cd backend && python - <<'PY'`
```python
import re
src = open("app/services/api_keys.py", encoding="utf-8").read()
print(src)
```
`PY`
Locate the mint/create function. If newly issued keys default to scopes `["read", "write"]`, leave it; if the default is empty, change the default to `["read", "write"]` so existing behavior does not silently break when enforcement lands. Record the outcome for the commit message.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_api_key_scoping.py`:

```python
import pytest
from sqlalchemy.future import select

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, ApiKey, User
from app.services import api_keys as api_key_service


@pytest.fixture
def seeded(db_session):
    account = Account(name="Acme")
    db_session.add(account)
    yield None  # account.id is client-side generated via default=gen_uuid at flush
    return account


async def _make_key(db_session, account, owner, scopes):
    plaintext, hashed, prefix = api_key_service.mint_new_key()
    db_session.add(ApiKey(
        account_id=account.id,
        created_by_user_id=owner.id,
        name="test",
        key_prefix=prefix,
        hashed_key=hashed,
        scopes=scopes,
        is_active=True,
    ))
    await db_session.commit()
    return plaintext


async def test_readonly_key_cannot_mutate(client, db_session):
    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(
        account_id=account.id,
        email="owner@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    key = await _make_key(db_session, account, owner, ["read"])
    resp = await client.post(
        "/api/templates/auto-detect",
        headers={"X-Api-Key": key},
    )
    assert resp.status_code == 403
    assert "read-only" in resp.json()["detail"]


async def test_api_key_use_does_not_rewrite_active_account(client, db_session):
    account_a = Account(name="A")
    account_b = Account(name="B")
    db_session.add_all([account_a, account_b])
    await db_session.flush()
    owner = User(
        account_id=account_b.id,  # UI active company is B; key is issued for A
        email="owner2@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    await db_session.commit()

    key = await _make_key(db_session, account_a, owner, ["read", "write"])
    resp = await client.get("/api/envelopes", headers={"X-Api-Key": key})
    assert resp.status_code == 200

    await db_session.refresh(owner)
    assert owner.account_id == account_b.id  # unchanged in the database
```

Note: `mint_new_key` is the name to confirm in Step 1; if the service names it differently (for example `mint`), use the real name everywhere in this task.

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_api_key_scoping.py -q`
Expected: FAIL. The mutation case fails on the refresh assertion today (the endpoint rewrites the account binding), and the read-only case returns something other than 403 (no scope check exists).

- [ ] **Step 4: Implement**

In `backend/app/api/auth.py`, change the signature and tail of `_user_from_api_key`:

```python
async def _user_from_api_key(presented: str, request: Request, db: AsyncSession) -> Optional[User]:
```

Replace the block from the `owner` lookup to the return with:

```python
        owner = (await db.execute(
            select(User).where(User.id == key.created_by_user_id)
        )).scalar_one_or_none()
        if not owner or not owner.is_active:
            return None

        # A key authorises only what its scopes allow. Fail closed: a key with no
        # scopes can do nothing, which is the only safe meaning of an empty list.
        scopes = key.scopes or []
        mutating = request.method.upper() not in ("GET", "HEAD", "OPTIONS")
        if mutating and "write" not in scopes:
            raise HTTPException(status_code=403, detail="This API key is read-only")
        if not mutating and "read" not in scopes:
            raise HTTPException(status_code=403, detail="This API key has no read scope")

        key.last_used_at = datetime.now(timezone.utc)
        await db.commit()

        # Detach the owner before rebinding the account so the binding is request
        # scoped only. Previously every key call rewrote the owner's active company
        # in the database, which made machine traffic corrupt interactive sessions.
        db.expunge(owner)
        owner.account_id = key.account_id
        return owner
```

Update the call site in `get_current_user`:

```python
        key_user = await _user_from_api_key(api_key.strip(), request, db)
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python -m pytest tests/test_api_key_scoping.py tests/test_settings_persistence.py -q`
Expected: PASS (settings-persistence covers minting and must still pass).

- [ ] **Step 6: Audit and commit**

```bash
git add backend/app/api/auth.py backend/app/services/api_keys.py backend/tests/test_api_key_scoping.py
git commit -m "fix(security): enforce API key scopes and stop rewriting the active account on key use"
```

---

### Task 7: Domain endpoints: admin check, authenticated validation, slim public status

**Files:**
- Modify: `backend/app/api/domains.py:186-284`
- Modify: `backend/app/schemas/schemas.py` (DomainAuthValidateResponse, DomainPublicStatus)
- Test: `backend/tests/test_domain_endpoints.py`

**Interfaces:**
- Consumes: `get_current_user`, `AccountMembership`, harness fixtures.
- Produces: `POST /api/domains/{id}/toggle-enforcement` requires an owner/admin membership (403 otherwise); `POST /api/domains/validate-authentication` requires a session (401 otherwise) and never returns the verification token; `GET /api/domains/status/{domain}` stays public but returns only `domain` and `is_verified` (no organization name, no timestamps).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_domain_endpoints.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_domain_endpoints.py -q`
Expected: FAIL (member toggle returns 200; validate works unauthenticated and includes the token; status includes organization fields).

- [ ] **Step 3: Update the two schemas**

In `backend/app/schemas/schemas.py`, find `DomainAuthValidateResponse` and replace it with (the verification_token field is removed entirely; it was a challenge secret and no caller needs it back):

```python
class DomainAuthValidateResponse(BaseModel):
    is_authenticated: bool
    domain: str
    assurance_level: str
    organization_name: Optional[str] = None
    txt_record_host: Optional[str] = None
    verified_at: Optional[datetime] = None
    message: str
```

Find `DomainPublicStatus` and replace with:

```python
class DomainPublicStatus(BaseModel):
    domain: str
    is_verified: bool
```

- [ ] **Step 4: Add the admin check to the toggle**

In `backend/app/api/domains.py`, add `AccountMembership` to the models import line, then inside `toggle_domain_enforcement`, after the domain lookup and before the account lookup, insert:

```python
    membership = (await db.execute(
        select(AccountMembership).where(
            AccountMembership.user_id == current_user.id,
            AccountMembership.account_id == current_user.account_id,
            AccountMembership.is_active == True,
        )
    )).scalar_one_or_none()
    if not membership or membership.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners and admins can change domain authentication enforcement.",
        )
```

- [ ] **Step 5: Require a session on validate-authentication and drop the token**

Change the decorator block to:

```python
@router.post("/validate-authentication", response_model=DomainAuthValidateResponse)
async def validate_domain_authentication(
    req: DomainAuthValidateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
```

Delete `verification_token=rec.verification_token,` from the positive-response construction; keep every other field as is. The function body otherwise stays.

- [ ] **Step 6: Slim the public status response**

Replace the two return statements of `get_public_domain_status` with:

```python
    if not rec:
        return DomainPublicStatus(domain=clean, is_verified=False)

    return DomainPublicStatus(domain=rec.domain, is_verified=(rec.status == "verified"))
```

- [ ] **Step 7: Check the frontend for the removed fields**

Run: `cd frontend && grep -rn "validate-authentication\|domains/status\|organization_name\|verification_token" src/`
If any hit consumes `organization_name` from `domains/status` or calls `validate-authentication` from a public (signed-out) page, adjust that call site: public pages use only `is_verified`; the signed-in Settings DNS card may keep calling validate-authentication. If nothing hits, continue.

- [ ] **Step 8: Run tests, audit, commit**

Run: `cd backend && python -m pytest tests -q` (expected: all PASS), `python scripts/audit_clean_room.py` (exit 0), then:

```bash
git add backend/app/api/domains.py backend/app/schemas/schemas.py backend/tests/test_domain_endpoints.py frontend/src
git commit -m "fix(security): admin gate on domain enforcement, authenticated validation, slim public status"
```

---

### Task 8: Account-scoped document previews

**Files:**
- Modify: `backend/app/services/preview_store.py`
- Modify: `backend/app/api/documents.py`
- Test: `backend/tests/test_preview_scoping.py`

**Interfaces:**
- Consumes: `settings.STORAGE_DIR`, `current_user.account_id`.
- Produces: `preview_path(storage_dir, doc_id, account_id)` (three-arg; raises ValueError on either bad id), `preview_root(storage_dir, account_id)` returning the per-account directory, and `purge_expired_previews` that walks both the legacy flat files and the new `previews/<account_id>/` tree. Previews uploaded before this change expire naturally within their 24 h TTL and are simply unreachable meanwhile.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_preview_scoping.py`:

```python
import pytest

from app.services.preview_store import new_doc_id, preview_path, preview_root


async def test_cross_account_preview_render_is_404(client, db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.core.security import get_password_hash
    from app.models import Account, AccountMembership, User

    monkeypatch.setattr(config.settings, "STORAGE_DIR", str(tmp_path))
    from app.api import documents as documents_api
    monkeypatch.setattr(documents_api.settings, "STORAGE_DIR", str(tmp_path))

    account = Account(name="A")
    other = Account(name="B")
    db_session.add_all([account, other])
    await db_session.flush()
    alice = User(account_id=account.id, email="alice@example.com",
                 hashed_password=get_password_hash("a-long-password-1234"),
                 role="admin", is_active=True)
    mallory = User(account_id=other.id, email="mallory@example.com",
                   hashed_password=get_password_hash("a-long-password-1234"),
                   role="admin", is_active=True)
    db_session.add_all([alice, mallory])
    await db_session.flush()
    db_session.add_all([
        AccountMembership(user_id=alice.id, account_id=account.id, role="owner"),
        AccountMembership(user_id=mallory.id, account_id=other.id, role="owner"),
    ])
    await db_session.commit()

    # Mallory cannot render a preview Alice stored, even with the exact doc id.
    doc_id = new_doc_id()
    path = preview_path(str(tmp_path), doc_id, account.id)
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"%PDF-1.4 placeholder")

    login = await client.post("/api/auth/login",
                              json={"email": "mallory@example.com",
                                    "password": "a-long-password-1234"})
    assert login.status_code == 200

    resp = await client.get(f"/api/documents/{doc_id}/pages/1")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_preview_scoping.py -q`
Expected: FAIL with a non-404 (today the path resolves flat, so it is a 404 only because the PDF is not parseable; make the failure observable by asserting the flat resolution is gone in Step 4, then re-run).

- [ ] **Step 3: Rework the path rules**

In `backend/app/services/preview_store.py`, add under `DOC_ID_RE`:

```python
# Previews are private to the account that uploaded them. A 128-bit id is a lot of
# entropy, but entropy is not an access control.
ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PREVIEW_DIR_NAME = "previews"


def is_valid_account_id(account_id: str) -> bool:
    return bool(account_id) and ACCOUNT_ID_RE.match(account_id) is not None
```

Replace `preview_path` with:

```python
def preview_root(storage_dir: str, account_id: str) -> str:
    if not is_valid_account_id(account_id):
        raise ValueError(f"Invalid account id: {account_id!r}")
    return os.path.join(storage_dir, PREVIEW_DIR_NAME, account_id)


def preview_path(storage_dir: str, doc_id: str, account_id: str) -> str:
    """Resolve a preview path, refusing ids this service did not mint."""
    root = preview_root(storage_dir, account_id)
    if not is_valid_doc_id(doc_id):
        raise ValueError(f"Invalid document id: {doc_id!r}")
    return os.path.join(root, f"{doc_id}.pdf")
```

Replace `purge_expired_previews` with a version that walks both layouts:

```python
def purge_expired_previews(storage_dir: str, ttl_seconds: int = PREVIEW_TTL_SECONDS) -> int:
    """
    Drop preview files older than the TTL so uploads cannot accumulate forever.
    Walks the current per-account layout and the legacy flat layout. Returns the
    number removed.
    """
    cutoff = time.time() - ttl_seconds
    removed = 0
    roots = [storage_dir, os.path.join(storage_dir, PREVIEW_DIR_NAME)]
    for root in roots:
        try:
            accounts = os.listdir(root)
        except OSError:
            continue
        for entry in accounts:
            path = os.path.join(root, entry)
            if os.path.isfile(path):
                candidates = [path]
            else:
                try:
                    candidates = [os.path.join(path, n) for n in os.listdir(path)]
                except OSError:
                    continue
            for file_path in candidates:
                name = os.path.basename(file_path)
                if not name.startswith("doc_") or not name.endswith(".pdf"):
                    continue
                try:
                    if os.path.getmtime(file_path) < cutoff:
                        os.remove(file_path)
                        removed += 1
                except OSError:
                    continue
    return removed
```

- [ ] **Step 4: Scope the endpoints**

In `backend/app/api/documents.py`:

`_resolve` becomes account aware:

```python
def _resolve(doc_id: str, account_id: str) -> str:
    try:
        return preview_path(settings.STORAGE_DIR, doc_id, account_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found.")
```

In `create_document_preview`, replace the `doc_id`/`pdf_path` lines:

```python
    if not current_user.account_id:
        raise HTTPException(status_code=400, detail="No active workspace; previews are per workspace.")

    doc_id = new_doc_id()
    pdf_path = preview_path(storage_dir, doc_id, current_user.account_id)
    os.makedirs(os.path.dirname(pdf_path), exist_ok=True)
```

In `get_document_page_image`, change the resolution call:

```python
    if not current_user.account_id:
        raise HTTPException(status_code=400, detail="No active workspace.")
    pdf_path = _resolve(doc_id, current_user.account_id)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_preview_scoping.py tests/test_security_hardening.py -q`
Expected: PASS (the security-hardening suite covers the preview-store rules and must still pass; if it calls the old two-arg `preview_path`, update those call sites to pass a valid account id, keeping the invalid-id assertions).

- [ ] **Step 6: Audit and commit**

```bash
git add backend/app/services/preview_store.py backend/app/api/documents.py backend/tests/test_preview_scoping.py backend/tests/test_security_hardening.py
git commit -m "fix(security): namespace builder previews per account and scope rendering"
```

---

### Task 9: Email deliverability check

**Files:**
- Create: `backend/app/services/mail_deliverability.py`
- Modify: `backend/app/api/settings_api.py`
- Modify: `backend/app/schemas/schemas.py`
- Test: `backend/tests/test_mail_deliverability.py`

**Interfaces:**
- Consumes: `get_current_user`; the DoH TXT query pattern from `domain_verifier` (this task ships its own minimal query so the check stays independent).
- Produces: `async def check_domain(domain: str) -> dict` returning `{"domain", "spf": {"present", "record"}, "dmarc": {"present", "record", "policy"}, "mx_present": bool, "findings": [str], "ok": bool}` and endpoint `POST /api/settings/deliverability` (account session required, body `{"domain": "example.com"}`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_deliverability.py`:

```python
import pytest

from app.services import mail_deliverability


async def test_full_pass(client, monkeypatch):
    async def fake_txt(name):
        return {
            "example.com": ["v=spf1 include:_spf.example.com ~all"],
            "_dmarc.example.com": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"],
        }.get(name, [])

    async def fake_mx(domain):
        return True

    monkeypatch.setattr(mail_deliverability, "_txt_records", fake_txt)
    monkeypatch.setattr(mail_deliverability, "_has_mx", fake_mx)

    result = await mail_deliverability.check_domain("example.com")
    assert result["ok"] is True
    assert result["spf"]["present"] is True
    assert result["dmarc"]["policy"] == "quarantine"
    assert result["mx_present"] is True


async def test_missing_dmarc_is_reported(client, monkeypatch):
    async def fake_txt(name):
        return {"example.com": ["v=spf1 ~all"]}.get(name, [])

    async def fake_mx(domain):
        return True

    monkeypatch.setattr(mail_deliverability, "_txt_records", fake_txt)
    monkeypatch.setattr(mail_deliverability, "_has_mx", fake_mx)

    result = await mail_deliverability.check_domain("example.com")
    assert result["ok"] is False
    assert any("DMARC" in f for f in result["findings"])


async def test_endpoint_requires_session(client):
    resp = await client.post("/api/settings/deliverability", json={"domain": "example.com"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_mail_deliverability.py -q`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the service**

Create `backend/app/services/mail_deliverability.py`:

```python
"""
Deliverability signals for a sending domain.

Answers the question a sender can act on: which of SPF, DMARC, and MX exist for
this domain, in plain language. Honest by design: a missing record is reported
as missing, never guessed.
"""
import re
from urllib.parse import urlparse

import httpx

DOH_ENDPOINTS = ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve")


def sanitize_domain(value: str) -> str:
    cleaned = (value or "").strip().lower()
    cleaned = cleaned.replace("https://", "").replace("http://", "")
    cleaned = urlparse(f"https://{cleaned}").hostname or ""
    return cleaned.split("/")[0]


async def _dns_query(name: str, qtype: str) -> list:
    for endpoint in DOH_ENDPOINTS:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    endpoint,
                    params={"name": name, "type": qtype},
                    headers={"accept": "application/dns-json"},
                )
                resp.raise_for_status()
                return resp.json().get("Answer") or []
        except Exception:
            continue
    return []


async def _txt_records(name: str) -> list:
    return [str(a.get("data", "")).strip('"') for a in await _dns_query(name, "TXT")]


async def _has_mx(domain: str) -> bool:
    return bool(await _dns_query(domain, "MX"))


def _dmarc_policy(records: list) -> str:
    for record in records:
        match = re.search(r"\bp=([a-z]+)\b", record, re.IGNORECASE)
        if match:
            return match.group(1).lower()
    return ""


async def check_domain(domain: str) -> dict:
    domain = sanitize_domain(domain)
    findings = []

    txt = await _txt_records(domain)
    spf_records = [r for r in txt if r.lower().startswith("v=spf1")]
    spf_present = bool(spf_records)

    dmarc_records = await _txt_records(f"_dmarc.{domain}")
    dmarc_present = bool(dmarc_records)
    policy = _dmarc_policy(dmarc_records)

    mx_present = await _has_mx(domain)

    if not spf_present:
        findings.append("SPF: no record found. Without SPF, receivers cannot identify your legitimate mail servers, so mail is often rejected or spammed.")
    else:
        findings.append("SPF: found.")
    if not dmarc_present:
        findings.append("DMARC: no record found at _dmarc." + domain + ". Add one so receivers know what to do with unauthenticated mail.")
    elif not policy:
        findings.append("DMARC: record exists but has no policy (p=) tag, so receivers take no action.")
    else:
        findings.append(f"DMARC: found with policy {policy}.")
    if not mx_present:
        findings.append("MX: no mail servers found for this domain. Sending domains usually need one.")
    else:
        findings.append("MX: found.")

    return {
        "domain": domain,
        "spf": {"present": spf_present, "record": spf_records[0] if spf_records else None},
        "dmarc": {"present": dmarc_present, "record": dmarc_records[0] if dmarc_records else None, "policy": policy or None},
        "mx_present": mx_present,
        "findings": findings,
        "ok": spf_present and dmarc_present and mx_present,
    }
```

- [ ] **Step 4: Add the schema and endpoint**

In `backend/app/schemas/schemas.py`:

```python
class DeliverabilityCheckRequest(BaseModel):
    domain: str
```

In `backend/app/api/settings_api.py`, add imports (`DeliverabilityCheckRequest`, `from app.services import mail_deliverability`) and the route next to the SMTP test route:

```python
@router.post("/settings/deliverability")
async def check_deliverability(
    payload: DeliverabilityCheckRequest,
    current_user: User = Depends(get_current_user),
):
    domain = mail_deliverability.sanitize_domain(payload.domain)
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Provide a valid domain, for example example.com.")
    return await mail_deliverability.check_domain(domain)
```

- [ ] **Step 5: Run tests, audit, commit**

Run: `cd backend && python -m pytest tests/test_mail_deliverability.py -q && python -m pytest tests -q` (all PASS), `python scripts/audit_clean_room.py` (exit 0), then:

```bash
git add backend/app/services/mail_deliverability.py backend/app/api/settings_api.py backend/app/schemas/schemas.py backend/tests/test_mail_deliverability.py
git commit -m "feat(settings): one-click SPF, DMARC and MX deliverability check"
```

---

### Task 10: Backup, restore, and upgrade scripts

**Files:**
- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Create: `deploy/upgrade.sh`

**Interfaces:**
- Consumes: the existing VPS layout (`/opt/docurama`, containers `docurama-postgres`, `docurama-docurama-api`, `docurama-frontend` per `docker-compose.yml`; the engine stack uses a bind mount at `./data/storage`), and `deploy/deploy_to_vps.py`.
- Produces: timestamped backups under `/opt/docurama/backups` (`db-<stamp>.sql.gz` + `storage-<stamp>.tar.gz`) with retention; a restore procedure that stops the API first; an upgrade entry point that deploys a tag and gates on the health endpoint.

- [ ] **Step 1: Create backup.sh**

```bash
#!/usr/bin/env bash
# Timestamped Postgres dump plus storage archive, with retention. Run on the VPS.
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${DOCURAMA_BACKUP_DIR:-/opt/docurama/backups}"
RETENTION_DAYS="${DOCURAMA_BACKUP_RETENTION_DAYS:-14}"
APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PG_CONTAINER="${DOCURAMA_PG_CONTAINER:-docurama-postgres}"
PG_USER="${POSTGRES_USER:-docurama}"
PG_DB="${POSTGRES_DB:-docurama}"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping database"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup] archiving storage"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$APP_DIR/data/storage" .
else
  docker run --rm \
    -v docurama_docurama_storage:/data:ro \
    -v "$BACKUP_DIR":/backup \
    alpine tar czf "/backup/storage-$STAMP.tar.gz" -C /data .
fi

echo "[backup] pruning older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] complete: $BACKUP_DIR ($STAMP)"
```

- [ ] **Step 2: Create restore.sh**

```bash
#!/usr/bin/env bash
# Restore from a backup stamp produced by backup.sh. Run on the VPS.
# Stops the API before touching data, and refuses to run without a stamp.
set -euo pipefail

STAMP="${1:?usage: ./restore.sh <stamp, e.g. 20260910T120000Z>}"
BACKUP_DIR="${DOCURAMA_BACKUP_DIR:-/opt/docurama/backups}"
APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PG_CONTAINER="${DOCURAMA_PG_CONTAINER:-docurama-postgres}"
PG_USER="${POSTGRES_USER:-docurama}"
PG_DB="${POSTGRES_DB:-docurama}"

DB_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz"
STORAGE_TAR="$BACKUP_DIR/storage-$STAMP.tar.gz"
[ -f "$DB_DUMP" ] || { echo "missing $DB_DUMP" >&2; exit 1; }
[ -f "$STORAGE_TAR" ] || { echo "missing $STORAGE_TAR" >&2; exit 1; }

echo "[restore] stopping the API so nothing writes mid-restore"
docker compose -f "$APP_DIR/docker-compose.yml" stop docurama-api

echo "[restore] restoring database"
gunzip -c "$DB_DUMP" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"

echo "[restore] restoring storage"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -xzf "$STORAGE_TAR" -C "$APP_DIR/data/storage"
else
  docker run --rm \
    -v docurama_docurama_storage:/data \
    -v "$BACKUP_DIR":/backup:ro \
    alpine sh -c "tar xzf /backup/storage-$STAMP.tar.gz -C /data"
fi

echo "[restore] starting the API"
docker compose -f "$APP_DIR/docker-compose.yml" up -d docurama-api

echo "[restore] verifying health"
sleep 10
curl -fsS "http://127.0.0.1:8000/api/health" | grep '"status": "healthy"' || {
  echo "health check failed after restore; investigate before touching anything else" >&2
  exit 1
}
echo "[restore] complete"
```

- [ ] **Step 3: Create upgrade.sh**

```bash
#!/usr/bin/env bash
# Deploy a specific git tag to the VPS and gate on the public health endpoint.
# Run from a clean checkout on the operator's machine.
set -euo pipefail

TAG="${1:?usage: ./deploy/upgrade.sh <git-tag>}"
HEALTH_URL="${DOCURAMA_HEALTH_URL:-https://docurama.stalfe.com/api/health}"

git fetch --tags
CURRENT="$(git rev-parse HEAD)"
git checkout "$TAG"
trap 'git checkout -' EXIT

echo "[upgrade] deploying $TAG"
python deploy/deploy_to_vps.py

echo "[upgrade] waiting for healthy"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -q '"status": "healthy"'; then
    echo "[upgrade] healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 10
done

echo "[upgrade] health gate failed after deploy of $TAG (previous: $CURRENT)" >&2
echo "[upgrade] rollback: git checkout <previous-tag> && python deploy/deploy_to_vps.py" >&2
exit 1
```

- [ ] **Step 4: Syntax-check all three**

Run: `bash -n deploy/backup.sh && bash -n deploy/restore.sh && bash -n deploy/upgrade.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/backup.sh deploy/restore.sh deploy/upgrade.sh
git commit -m "feat(ops): backup, restore and tag-pinned upgrade scripts for the live instance"
```

Operator follow-ups after this task (documented, not automated): install a host cron entry running `deploy/backup.sh` daily, and perform one restore drill into a scratch directory.

---

### Task 11: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the pytest suite, `scripts/audit_clean_room.py`, `frontend` npm build.
- Produces: CI on every push to main and every pull request; a failing gate blocks merges.

- [ ] **Step 1: Create the workflow**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dependencies
        run: pip install -r backend/requirements.txt
      - name: Run backend tests
        run: cd backend && python -m pytest tests -q

  clean-room-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Audit
        run: python scripts/audit_clean_room.py

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Build frontend
        run: cd frontend && npm ci && npm run build
```

- [ ] **Step 2: Validate locally what CI will run**

Run: `cd backend && python -m pytest tests -q` then `python scripts/audit_clean_room.py` then `cd frontend && npm run build`
Expected: all three green locally.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): backend tests, clean-room audit and frontend build on every change"
```

---

### Task 12: Multi-tenant isolation regression tests

**Files:**
- Test: `backend/tests/test_tenant_isolation.py`

**Interfaces:**
- Consumes: the Task 3 harness fixtures; `get_password_hash`; models `Account`, `AccountMembership`, `User`, `Envelope`, `Template`.
- Produces: the regression suite that locks in account scoping for the core listings, reused and extended in Phase 1.

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_tenant_isolation.py`:

```python
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
    import uuid
    from app.services import preview_store  # noqa: F401  (path helpers unused here)

    acme = Account(name="Acme")
    globex = Account(name="Globex")
    db_session.add_all([acme, globex])
    await db_session.flush()

    alice = User(account_id=acme.id, email="alice@acme.test",
                 hashed_password=get_password_hash(PASSWORD), role="admin", is_active=True)
    bob = User(account_id=globex.id, email="bob@globex.test",
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
    await _login(client, "alice@acme.test")
    resp = await client.get("/api/envelopes")
    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()]
    assert "Acme NDA" in titles
    assert "Globex NDA" not in titles


async def test_template_listing_is_account_scoped(client, two_accounts):
    acme, globex, alice, bob = two_accounts
    await _login(client, "bob@globex.test")
    resp = await client.get("/api/templates")
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Globex template" in titles
    assert "Acme template" not in titles


async def test_cross_account_envelope_fetch_is_not_found(client, two_accounts):
    acme, globex, alice, bob = two_accounts
    await _login(client, "bob@globex.test")
    target = (await client.get("/api/envelopes")).json()[0]["id"]
    await client.post("/api/auth/logout")
    await _login(client, "alice@acme.test")
    resp = await client.get(f"/api/envelopes/{target}")
    assert resp.status_code == 404
```

Note: the login tests need argon2 on the host; if it is missing locally, they skip via the existing `requires_argon2` marker convention. Add `pytestmark = pytest.mark.skipif(...)` mirroring `conftest.py` if the local run shows an ImportError rather than a skip.

- [ ] **Step 2: Run**

Run: `cd backend && python -m pytest tests/test_tenant_isolation.py -q`
Expected: PASS (the listings already filter by account; this locks the behavior in). If any test FAILS, an endpoint has lost its scoping: fix that endpoint before continuing and record it in the commit message.

- [ ] **Step 3: Full suite, audit, commit**

Run: `cd backend && python -m pytest tests -q` (all PASS), `python scripts/audit_clean_room.py` (exit 0), then:

```bash
git add backend/tests/test_tenant_isolation.py
git commit -m "test(isolation): regression lock on account scoping for core listings"
```

---

## Wake-up procedure for the operator (after Tasks 1-2 land)

These are the production actions the plan approved; they happen on the VPS, not in the repo:

1. Rotate the GitHub PAT and re-add the remote without an embedded token.
2. Generate a fresh `DOCURAMA_SECRET_KEY`, update `/opt/docurama/.env`, and redeploy. Afterwards re-enter mail passwords (Settings, Notifications, Email Delivery) and re-enrol 2FA, because both are encrypted with a key derived from the old secret.
3. Confirm the deployed certificate is the server-issued one (`scripts/issue_signing_cert.py` output), not the repository development certificate; check `/api/health` shows the expected subject and expiry.
4. Install the daily backup cron and run one restore drill.
