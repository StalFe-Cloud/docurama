# Docurama

**Next-Generation Digital Document Signing & Cryptographic Verification Platform**  
*Tailored for Docurama Technologies and Enterprise Counterparties.*

---

## Overview

Docurama is a high-security document signing, template management, and audit verification platform. It combines visual document preparation, multi-party signing workflows, vector QR verification, PAdES-LTV (Long-Term Validation) digital signatures, and authoritative corporate DNS domain attestation.

The platform is **100% proprietary (Option 3 Clean-Room Architecture)** with zero legacy engine dependencies:
- **Backend**: Python (FastAPI, pyHanko, PyMuPDF, SQLAlchemy 2.0 async, asyncpg)
- **Frontend**: React 18, Vite 5, TypeScript 5.5, Tailwind CSS, Lucide icons

---

## Repository Structure

```text
docurama/
├── backend/                  # Clean-Room Python / FastAPI Microservice
│   ├── app/
│   │   ├── api/              # REST & WebSocket Endpoints (auth, envelopes, templates, domains, verify, webhooks)
│   │   ├── core/             # Database session, security, JWT, config
│   │   ├── models/           # SQLAlchemy database models
│   │   ├── schemas/          # Pydantic validation schemas
│   │   └── services/         # PAdES-LTV signing, QR generator, DNS domain verifier, field detector
│   ├── alembic/              # Database migrations (applied automatically on start)
│   ├── certs/                # PKCS#12 signing cert location (ignored by git)
│   ├── tests/                # Pytest integration & unit test suite
│   ├── Dockerfile            # Container build for FastAPI backend
│   ├── entrypoint.sh         # Runs migrations, then starts the API
│   ├── migrate.py            # Migration runner, adopts pre-existing databases
│   └── requirements.txt      # Python dependencies
│
├── frontend/                 # Clean-Room React / Vite / TypeScript Frontend
│   ├── public/               # Static assets & Docurama SVGs
│   ├── src/
│   │   ├── components/       # Reusable layout, navigation, and modal components
│   │   ├── lib/              # API client and WebSocket handlers
│   │   ├── pages/            # Builder, Templates, Submissions, Verify, Settings, ApiDocs
│   │   └── styles/           # Tailwind CSS & Plus Jakarta Sans typography
│   ├── Dockerfile            # Multi-stage build with Nginx reverse proxy
│   └── package.json          # Node dependencies
│
├── deploy/                   # VPS Deployment & SSH orchestration scripts (direct Nexa-VPS)
├── scripts/                  # Clean-room audit & code analysis utilities
├── Dockerfile                # Unified Multi-Stage Production Build (FastAPI + React SPA)
├── docker-compose.yml        # Multi-Container Microservice Stack (Production)
├── docker-compose.engine.yml # Standalone Unified Image Stack
├── .env.example              # Environment variables template
└── .gitignore                # Strict security exclusions (keys, certs, credentials)
```

---

## Key Capabilities

* **PAdES Digital Signatures**: Documents are sealed with a PKCS#12 signing certificate and an RFC 3161 trusted timestamp. The conformance level actually achieved (B-B, B-T, B-LT or B-LTA) is established by re-reading the sealed file and is recorded on the envelope; reaching LT/LTA additionally requires a trusted root CA and a reachable TSA.
* **Certificate of Completion with Vector QR Code**: Generates a tamper-evident audit trail embedded with a scannable QR code linking to the public verification portal.
* **Public Verification Portal (`/verify`)**: Counterparties can upload a signed document or enter an envelope ID. Every claim it makes is derived from an actual inspection of the file. A document with no signature, an unvalidated signature, or one completed without a seal is reported as such rather than being presented as verified.
* **Email Delivery**: Signing invitations, reminders and completion notices are sent over SMTP. Audit events describe the real delivery outcome, so a failed send is never recorded as a delivery.
* **Corporate DNS Domain Attestation**: Authenticates client domains (e.g., `example.com`) via DNS TXT records, subdomain pointers (`docurama.example.com`), or HTTP `/.well-known/` confirmation.
* **Mobile Signing Hand-Off**: Desktop signers can scan an on-screen QR code to sign on their smartphone touchscreens.
* **Strict Network Isolation**: Dedicated Docker bridge network (`docurama_net`) with zero attachment to any internal staging/production microservice networks.

---

## Quick Start

### 1. Environment Configuration

`.env` is required. Secrets are no longer committed to `docker-compose.yml`, and the
API refuses to start in production while any repository default is still in place.

```bash
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # DOCURAMA_SECRET_KEY
```

At minimum set `POSTGRES_PASSWORD`, `DOCURAMA_DATABASE_URL`, `DOCURAMA_SECRET_KEY`
and `DOCURAMA_P12_PASSWORD`. Set `DOCURAMA_ENV=development` to run locally with the
built-in defaults, and `DOCURAMA_COOKIE_SECURE=false` to sign in over plain http.

### 1a. Database Migrations

Schema changes are managed by Alembic and applied by the API container's entrypoint
before the server starts, so they run once rather than racing across workers.

A database that predates Alembic is adopted rather than rebuilt, so no data is lost.
Adoption first reconciles the schema to the baseline revision: the old startup path
created tables with `create_all` and added columns with ad-hoc `ALTER TABLE`
statements, so an older database can be missing both. Those are created before the
baseline is stamped, and only then are later revisions applied. The reconciliation is
bounded by what the baseline revision itself declares, read from the migration file,
so a column belonging to a later revision is never created early. Watch for it in the
deploy output:

```text
[migrate] existing schema detected without version tracking
[migrate] schema predates Alembic and is missing baseline tables: account_memberships
[migrate] missing baseline columns: accounts.timezone
[migrate] stamping 0001_baseline
[migrate] database is at head
```

To run migrations by hand:

```bash
cd backend && python migrate.py
```

### 2. Multi-Container Microservices (Recommended for Production)

```bash
docker compose up -d --build
```

- Frontend: `http://localhost:3002` (or `http://localhost:3000`)
- Backend API: `http://localhost:8000`
- API Docs (Swagger): `http://localhost:8000/docs`

### 3. Unified Standalone Production Image

To build the self-contained, standalone `docurama:latest` container image locally (compiling the React frontend and bundling it directly with the FastAPI backend):

```bash
docker build -t docurama:latest .
```

To run the standalone container with persistent storage:

```bash
docker compose -f docker-compose.engine.yml up -d
```

---

## Testing

```bash
cd backend && python -m pytest tests -v     # unit and service suite
python scripts/audit_clean_room.py          # clean-room and typography gate
cd frontend && npm run build                # tsc + vite
```

`pyhanko`, `pymupdf`, `reportlab` and `argon2-cffi` are runtime dependencies that may
be missing from a developer host. Tests that need them stub them or skip, so the host
run stays green, but the full behaviour is only exercised inside the image:

```bash
docker compose build docurama-api
docker run --rm -v "$PWD/backend/tests:/app/tests:ro" -e DOCURAMA_ENV=development     --entrypoint sh docurama-docurama-api:latest -c "python -m pytest /app/tests -q"
```

The unit suite stubs pyHanko, so it cannot catch the library relocating its API, which
has happened twice. After any `pyhanko` or `pyhanko-certvalidator` bump, run the
end-to-end signing check, which seals and verifies a real document with a throwaway CA:

```bash
docker run --rm -v "$PWD/scripts/verify_signing.py:/tmp/verify_signing.py:ro"     --entrypoint python docurama-docurama-api:latest /tmp/verify_signing.py
```

It exits non-zero if a seal fails, if a sealed document does not verify, or if a
tampered document verifies or retains its long-term validation claim.

## Security & Secrets Policy

Under no circumstances should signing certificates (`*.p12`, `*.pem`), private keys, or passwords be committed to this repository. All secrets are ignored via `.gitignore` and must be injected via runtime environment variables.
