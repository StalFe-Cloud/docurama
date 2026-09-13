import asyncio
import os
import re
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import urlparse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.database import engine
from app.core.observability import RequestLoggingMiddleware, configure_logging
from app.core.rate_limit import limiter
from app.core.security_headers import SecurityHeadersMiddleware
from app.core.tenant_middleware import TenantHostMiddleware
from app.api.router import api_router
from app.api.ws import router as ws_router
from app.services.reminder_sweeper import reminder_loop
from app.services.crypto_engine import signing_capability

# Structured JSON logging is configured before any module logger emits.
configure_logging()


def build_cors_policy(cfg):
    """
    Cloud deployments serve every tenant subdomain, so a fixed origin list can
    never be complete; a strict regex over the cloud domain replaces it. Self-host
    keeps the explicit list: it has exactly the origins the operator named.
    """
    if (cfg.DEPLOYMENT_MODE or "").strip().lower() != "cloud":
        return list(cfg.ALLOWED_ORIGINS), None

    cloud_domain = cfg.CLOUD_DOMAIN.strip().lower()
    domains = [cloud_domain]
    if "docurama.eu" not in domains:
        domains.append("docurama.eu")
    pattern = (
        r"^https://([a-z0-9-]+\.)*("
        + "|".join(d.replace(".", r"\.") for d in domains)
        + r")$"
    )
    # APP_URL's host (e.g. app.docurama.rvrad.com) already matches the pattern.
    return [], re.compile(pattern)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema changes are applied by backend/migrate.py before the server starts
    # (see entrypoint.sh), so that they run exactly once rather than racing across
    # uvicorn workers. Nothing here may create or alter tables.
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)

    reminder_task = None
    if settings.REMINDERS_ENABLED:
        # Started in every worker; the sweep itself takes an advisory lock so only
        # one of them actually sends.
        reminder_task = asyncio.create_task(reminder_loop())

    compliance_tasks = []
    if settings.COMPLIANCE_JOBS_ENABLED:
        # DSAR processing and retention sweeps. Bounded batches, ledger-logged
        # state changes; see app/services/compliance_jobs.py.
        from app.services.compliance_jobs import dsar_loop, retention_loop
        compliance_tasks = [
            asyncio.create_task(dsar_loop()),
            asyncio.create_task(retention_loop()),
        ]

    yield

    if reminder_task is not None:
        reminder_task.cancel()
        try:
            await reminder_task
        except asyncio.CancelledError:
            pass

    for task in compliance_tasks:
        task.cancel()
    for task in compliance_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass

    await engine.dispose()

app = FastAPI(
    title="Docurama API",
    description="High-Assurance Digital Signature and Document Intelligence Platform for Docurama",
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# Rate limiting: the shared limiter must sit on app.state and its exhaustion
# exception must map to a 429 before any middleware or route runs.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware
cors_origins, cors_origin_regex = build_cors_policy(settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex.pattern if cors_origin_regex else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Captures the request host on every request, in every mode, before routing.
app.add_middleware(TenantHostMiddleware)

# One structured log line per request, with X-Request-ID correlation.
app.add_middleware(RequestLoggingMiddleware)

# Hardened response headers on every route: CSP, anti-framing, nosniff,
# referrer and permissions policy (finding S-1). Middleware runs inside-out,
# so mounting after the logging middleware means the headers land on every
# response including CORS preflights and SPA files.
app.add_middleware(SecurityHeadersMiddleware)


def _security_contact() -> str:
    """RFC 9116 contact, from the explicit setting or derived from APP_URL."""
    if getattr(settings, "SECURITY_CONTACT", ""):
        return settings.SECURITY_CONTACT
    host = urlparse(settings.APP_URL).hostname or ""
    if host and host != "docurama.example.com":
        return f"mailto:security@{host}"
    return "mailto:security@docurama.invalid"


@app.get("/.well-known/security.txt", include_in_schema=False)
async def security_txt():
    """
    RFC 9116 security.txt (CRA intake, §15.4 item 14).

    Registered BEFORE the SPA catch-all mount: the catch-all would otherwise
    shadow this path and serve index.html to every scanner that asks.
    """
    app_url = str(settings.APP_URL).rstrip("/")
    body = (
        f"Contact: {_security_contact()}\n"
        f"Expires: 2027-12-31T23:59:00.000Z\n"
        f"Preferred-Languages: en, fr\n"
        f"Canonical: {app_url}/.well-known/security.txt\n"
        f"Policy: {app_url}/trust\n"
    )
    return Response(content=body, media_type="text/plain; charset=utf-8")


# Mount API routes
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(ws_router)

@app.get("/readyz")
async def readiness_check():
    """
    Readiness gate for orchestration and deploy scripts.

    /healthz says the process is up and describes signing state informationally;
    this endpoint says whether the deployment is fit to serve, and answers 503
    when the signing certificate is missing, unreadable or expired. Compose,
    restore.sh and upgrade.sh gate on it: a deployment whose every envelope
    would complete unsealed must not be declared healthy.
    """
    capability = await asyncio.to_thread(signing_capability)
    ready = bool(capability.get("ready"))
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ready" if ready else "not_ready",
            "service": "docurama-backend",
            "signing": capability["status"],
            "signing_detail": capability["detail"],
            "checks": {
                "signing_certificate_installed": bool(capability.get("certificate_installed")),
                "root_ca_installed": bool(capability.get("root_ca_installed")),
                "certificate_within_validity": ready,
            },
        },
    )


@app.get("/healthz")
@app.get("/api/health")
async def health_check():
    """
    Report the service's real signing readiness.

    Two rounds of the same defect have been removed here. It first returned a fixed
    "Docurama Root CA Certified" string regardless of whether any signing material
    existed. It then reported "ready" whenever two files were present on disk, which
    is not capability: a certificate with the wrong passphrase, or one past its
    validity window, is present and useless, and every envelope would have completed
    unsealed while the endpoint said the deployment was ready.

    The answer now comes from opening the certificate and reading its validity window.
    """
    # Cached in the engine, so the 15 second container healthcheck does not reparse a
    # PKCS#12 on every probe.
    capability = await asyncio.to_thread(signing_capability)

    return {
        "status": "healthy",
        "service": "docurama-backend",
        "version": settings.VERSION,
        "signing": capability["status"],
        "signing_ready": capability["ready"],
        "signing_detail": capability["detail"],
        "signing_certificate_installed": capability["certificate_installed"],
        "root_ca_installed": capability["root_ca_installed"],
        # A certificate is public material; it is embedded in every document it signs.
        "signing_certificate_subject": capability["subject"],
        "signing_certificate_expires_at": capability["expires_at"],
        "signing_certificate_days_remaining": capability["days_until_expiry"],
    }

# Mount built React frontend SPA if dist directory is present
frontend_dist = os.getenv(
    "DOCURAMA_FRONTEND_DIST", 
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../frontend/dist"))
)


def _resolve_spa_path(dist_root: str, requested: str) -> Optional[str]:
    """
    Resolve a requested SPA path inside dist_root, or None if it escapes it.

    os.path.join discards the base when the second argument is absolute, so
    join(dist, "/etc/passwd") resolves to /etc/passwd. Realpath the candidate
    and require it to remain under the realpath of the dist root.
    """
    base = os.path.realpath(dist_root)
    candidate = os.path.realpath(os.path.join(base, requested))
    if candidate == base or not candidate.startswith(base + os.sep):
        return None
    return candidate


if os.path.exists(frontend_dist) and os.path.isdir(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Unmatched API/WS paths must be real 404s (finding S-2): a
        # 200-with-error-body poisons every health monitor and API client
        # that trusts status codes, and leaks "this is a SPA" to scanners.
        if full_path.startswith("api") or full_path.startswith("ws") or full_path in ("healthz", "docs", "openapi.json"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = _resolve_spa_path(frontend_dist, full_path)
        if full_path and candidate and os.path.isfile(candidate):
            return FileResponse(candidate)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"detail": "Not Found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
