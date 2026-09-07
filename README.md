# Docurama

**Next-Generation Digital Document Signing & Cryptographic Verification Platform**  
*Tailored for StalFe Technologies and Enterprise Counterparties.*

---

## Overview

Docurama is a high-security document signing, template management, and audit verification platform. It combines visual document preparation, multi-party signing workflows, vector QR verification, PAdES-LTV (Long-Term Validation) digital signatures, and authoritative corporate DNS domain attestation.

This repository houses both implementation pathways for the Docurama platform:
1. **Clean-Room Proprietary Architecture (`backend/` & `frontend/`)**: Built from scratch with zero legacy dependencies using Python (FastAPI, pyHanko) and React (Vite, TypeScript, Tailwind CSS).
2. **Full-Featured Engine Overlay (`overlay/`)**: A complete cosmetic, controller, routing, and cryptographic patch layer running on top of a mature engine under the hood, delivering 45+ enterprise features immediately with 100% Docurama branding.

---

## Repository Structure

```text
docurama/
├── backend/                  # Clean-Room Python / FastAPI Microservice
│   ├── app/
│   │   ├── api/              # REST & WebSocket Endpoints (auth, envelopes, templates, domains, verify)
│   │   ├── core/             # Database session, security, JWT, config
│   │   ├── models/           # SQLAlchemy database models
│   │   ├── schemas/          # Pydantic validation schemas
│   │   └── services/         # PAdES-LTV signing, QR generator, DNS domain verifier
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
│   │   ├── pages/            # Builder, Templates, Submissions, Verify, Settings
│   │   └── styles/           # Tailwind CSS & Plus Jakarta Sans typography
│   ├── Dockerfile            # Multi-stage build with Nginx reverse proxy
│   └── package.json          # Node dependencies
│
├── overlay/                  # Full-Featured Engine Overlay (Production Stack)
│   ├── custom_views/         # 40+ customized ERB views (Plus Jakarta Sans, dark glass UI)
│   ├── custom_controllers/   # Custom controllers (verify_pdf_signature, errors, esign)
│   ├── custom_lib/           # Submissions::GenerateAuditTrail with vector QR code
│   ├── custom_public/        # Favicons, high-res logos, docurama-theme.css
│   ├── custom_pdf_icons/     # High-res logos for PDF digital sealing stamp
│   ├── custom_config/        # routes.rb (/verify), i18n, session_store (_docurama_session)
│   └── docker-compose.overlay.yml # Live deployment manifest for VPS
│
├── deploy/                   # VPS Deployment & SSH orchestration scripts
├── scripts/                  # Clean-room audit & code analysis utilities
├── docker-compose.yml        # Docker compose configuration for Clean-Room stack
├── .env.example              # Environment variables template
└── .gitignore                # Strict security exclusions (keys, certs, credentials)
```

---

## Key Capabilities

* **PAdES-LTV Digital Signatures**: Cryptographically certified with PKCS#12 signing certificates and RFC 3161 trusted timestamps (DigiCert TSA).
* **Certificate of Completion with Vector QR Code**: Generates a tamper-evident audit trail embedded with a scannable QR code linking to the public verification portal.
* **Public Verification Portal (`/verify`)**: Standalone verification interface where counterparties can upload a signed document or enter an envelope ID to verify certificate validity and timestamps.
* **Corporate DNS Domain Attestation**: Authenticates client domains (e.g., `stalfe.com`) via DNS TXT records, subdomain pointers (`docurama.stalfe.com`), or HTTP `/.well-known/` confirmation.
* **Mobile Signing Hand-Off**: Desktop signers can scan an on-screen QR code to sign on their smartphone touchscreens.
* **Strict Network Isolation**: Dedicated Docker bridge network (`docurama_net`) with zero attachment to any internal staging/production microservice networks.

---

## Quick Start

### 1. Environment Configuration

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
```

### 2. Option A: Running the Clean-Room Stack (FastAPI + React)

```bash
docker compose up -d --build
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- API Docs (Swagger): `http://localhost:8000/docs`

### 3. Option B: Running the Full-Featured Overlay Stack

```bash
docker compose -f overlay/docker-compose.overlay.yml up -d
```

- Accessible at: `http://localhost:3002` (or configured host reverse proxy port)

---

## Security & Secrets Policy

Under no circumstances should signing certificates (`*.p12`, `*.pem`), private keys, or passwords be committed to this repository. All secrets are ignored via `.gitignore` and must be injected via runtime environment variables.
