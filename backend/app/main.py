import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.database import engine, Base
from app.api.router import api_router
from app.api.ws import router as ws_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)
    yield
    await engine.dispose()

app = FastAPI(
    title="Docurama API",
    description="High-Assurance Digital Signature and Document Intelligence Platform for Docurama",
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

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
    return {
        "status": "healthy",
        "service": "docurama-backend",
        "version": settings.VERSION,
        "digital_trust": "Docurama Root CA Certified"
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
