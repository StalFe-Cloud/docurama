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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY certs/ /app/certs/
COPY app/ /app/app/
COPY alembic/ /app/alembic/
COPY alembic.ini migrate.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

# start-period covers database readiness plus migrations before the first probe.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD curl -f http://localhost:8000/healthz || exit 1

# --proxy-headers makes uvicorn honour X-Forwarded-For from the reverse proxy so that
# audit events and certificates record the real signer IP rather than the proxy address.
# The trusted proxy range comes from FORWARDED_ALLOW_IPS (uvicorn defaults to 127.0.0.1).
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
