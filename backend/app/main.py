import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.database import engine
from app.core.rate_limit import limiter
from app.api.router import api_router
from app.api.ws import router as ws_router
from app.services.reminder_sweeper import reminder_loop
from app.services.crypto_engine import signing_capability

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

    yield

    if reminder_task is not None:
        reminder_task.cancel()
        try:
            await reminder_task
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routes
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(ws_router)

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
if os.path.exists(frontend_dist) and os.path.isdir(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api") or full_path.startswith("ws") or full_path in ("healthz", "docs", "openapi.json"):
            return {"detail": "Not Found"}
        candidate = os.path.join(frontend_dist, full_path)
        if full_path and os.path.exists(candidate) and os.path.isfile(candidate):
            return FileResponse(candidate)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"detail": "Not Found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
