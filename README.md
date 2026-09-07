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
│   ├── certs/                # PKCS#12 signing cert location (ignored by git)
│   ├── tests/                # Pytest integration & unit test suite
│   ├── Dockerfile            # Container build for FastAPI backend
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

* **PAdES-LTV Digital Signatures**: Cryptographically certified with PKCS#12 signing certificates and RFC 3161 trusted timestamps (DigiCert TSA).
* **Certificate of Completion with Vector QR Code**: Generates a tamper-evident audit trail embedded with a scannable QR code linking to the public verification portal.
* **Public Verification Portal (`/verify`)**: Standalone verification interface where counterparties can upload a signed document or enter an envelope ID to verify certificate validity and timestamps.
* **Corporate DNS Domain Attestation**: Authenticates client domains (e.g., `example.com`) via DNS TXT records, subdomain pointers (`docurama.example.com`), or HTTP `/.well-known/` confirmation.
* **Mobile Signing Hand-Off**: Desktop signers can scan an on-screen QR code to sign on their smartphone touchscreens.
* **Strict Network Isolation**: Dedicated Docker bridge network (`docurama_net`) with zero attachment to any internal staging/production microservice networks.

---

## Quick Start

### 1. Environment Configuration

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
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

## Security & Secrets Policy

Under no circumstances should signing certificates (`*.p12`, `*.pem`), private keys, or passwords be committed to this repository. All secrets are ignored via `.gitignore` and must be injected via runtime environment variables.
