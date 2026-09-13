# syntax=docker/dockerfile:1
# Docurama Enterprise Unified Container Image (Option 3 Proprietary)
# Copyright (c) 2026 Docurama Technologies. All Rights Reserved.
# https://github.com/StalFe-Cloud/docurama

# --- Stage 1: Build Proprietary React Frontend ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
# npm ci: reproduce the committed lockfile exactly instead of letting
# npm install drift onto untested dependency versions.
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- Stage 2: Unified Production Runtime (FastAPI Backend + React SPA) ---
FROM python:3.11-slim AS runtime

LABEL org.opencontainers.image.title="Docurama" \
      org.opencontainers.image.description="High-Assurance Digital Signature and Document Intelligence Platform" \
      org.opencontainers.image.vendor="Docurama Technologies" \
      org.opencontainers.image.version="2.0.0"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DOCURAMA_FRONTEND_DIST=/app/frontend/dist \
    DOCURAMA_STORAGE_DIR=/app/storage

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend application source
# Signing certificates are NEVER baked into the image: the build context and
# layer cache would carry the production P12 and root CA. Mount them at runtime
# (docker-compose.engine.yml mounts ./backend/certs to /app/certs read-only).
COPY backend/app/ /app/app/
COPY backend/alembic/ /app/alembic/
COPY backend/alembic.ini backend/migrate.py backend/entrypoint.sh /app/
# Ship the operator scripts (grant_platform_admin.py and friends) so they can be
# run inside the container as documented.
COPY scripts/ /app/scripts/
# Strip CR and mark executable. Git on Windows can rewrite this file to CRLF,
# which makes the kernel look for an interpreter named "/bin/sh" and the
# container fails to start with a misleading "no such file or directory".
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8000 3000

# start-period covers database readiness plus migrations before the first probe.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -f http://localhost:8000/readyz || exit 1

# --proxy-headers makes uvicorn honour X-Forwarded-For from the reverse proxy so that
# audit events and certificates record the real signer IP rather than the proxy address.
# The trusted proxy range comes from FORWARDED_ALLOW_IPS (uvicorn defaults to 127.0.0.1).
#
# ONE worker, deliberately. The in-process WebSocket connection manager and the
# in-memory rate limiter are per-process; with multiple workers the desktop<->mobile
# signing hand-off silently breaks whenever two devices land on different workers.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
