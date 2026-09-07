# syntax=docker/dockerfile:1
# Docurama Enterprise Unified Container Image (Option 3 Proprietary)
# Copyright (c) 2026 Docurama Technologies. All Rights Reserved.
# https://github.com/StalFe-Cloud/docurama

# --- Stage 1: Build Proprietary React Frontend ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

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
COPY backend/certs/ /app/certs/
COPY backend/app/ /app/app/

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8000 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
