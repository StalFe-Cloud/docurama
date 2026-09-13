FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# The build context is the repository root (docker-compose.yml sets context: .
# with dockerfile: backend/Dockerfile) so the operator scripts/ directory below
# can ship inside the API image.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Signing certificates are NEVER baked into the image: the build context and
# layer cache would carry the production P12 and root CA. Mount them at runtime
# (docker-compose.yml mounts ./backend/certs to /app/certs read-only).
COPY backend/app/ /app/app/
COPY backend/alembic/ /app/alembic/
COPY backend/alembic.ini backend/migrate.py backend/entrypoint.sh /app/
# Ship the operator scripts (grant_platform_admin.py and friends) so they can be
# run inside the API container as documented.
COPY scripts/ /app/scripts/
# Strip CR and mark executable. Git on Windows can rewrite this file to CRLF,
# which makes the kernel look for an interpreter named "/bin/sh
" and the
# container fails to start with a misleading "no such file or directory".
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

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
# Scale by running more replicas behind the proxy, not more workers here.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
