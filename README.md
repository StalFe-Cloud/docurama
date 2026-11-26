# Docurama

**EU-Native, Audit-Grade Electronic Signature & Document Intelligence Platform**

> **Docurama** is engineered and operated by **VOIRIA** (**VOIRIA SASU** · 1 Rue Marguerin, 75014 Paris, France · SIREN 131 914 012 · R.C.S. Paris · TVA FR90131914012)  
> **Jurisdiction:** French Republic & European Union Law · **Data Residency:** Paris, France (EU-West)  
> **Cryptographic Standards:** PAdES (ETSI EN 319 142-1/-2), RFC 3161 TSA, SHA-256, RSA-2048/4096  
> **Compliance Frameworks:** eIDAS (Regulation EU 910/2014), GDPR (Regulation EU 2016/679), FDA 21 CFR Part 11

* **Repository:** [https://github.com/StalFe-Cloud/docurama.git](https://github.com/StalFe-Cloud/docurama.git)
* **Organization:** [StalFe Cloud](https://github.com/StalFe-Cloud)

---

## StalFe Cloud Ecosystem

Docurama is delivered across three editions designed for different compliance, infrastructure, and sovereign data residency requirements:

| Edition | Repository | Purpose & Deployment Target |
| :--- | :--- | :--- |
| **Docurama Cloud (SaaS)** | [StalFe-Cloud/docurama](https://github.com/StalFe-Cloud/docurama) | Multi-tenant cloud SaaS powered by TanStack Start, Nitro, and Cloudflare Pages/Workers edge runtime. |
| **Docurama Enterprise** | [StalFe-Cloud/docurama-enterprise](https://github.com/StalFe-Cloud/docurama-enterprise) | Sovereign on-premises and self-hosted edition running on Docker Compose and Kubernetes (Helm) with native SeaweedFS/S3 storage. |
| **Docurama Private Cloud** | [StalFe-Cloud/docurama-private-cloud](https://github.com/StalFe-Cloud/docurama-private-cloud) | Dedicated AWS tenant VPC infrastructure blueprint, Terraform 1.11 modules, KMS customer-managed encryption, and SSM-managed EC2 provisioning. |

---

## Build with Lovable

This repository is connected to [Lovable](https://lovable.dev).

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c8cf2745-9aaa-4500-a89e-91289068f7d5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

---

## Architecture & Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) with [TanStack Router](https://tanstack.com/router)
- **UI & Styling**: React 19, Tailwind CSS v4, Lucide Icons, Radix UI primitives
- **Database & ORM**: Prisma v6 with dual SQLite (embedded / local) and PostgreSQL (cloud production) support
- **Server Engine**: Nitro server runtime with Cloudflare module deployment target
- **Security & Cryptography**: RFC 6238 TOTP 2FA, Scrypt password hashing, SHA-256 seal manifests, PAdES-ready envelope signatures

---

## Development

Prefer working locally? You need Node.js (or Bun):

```sh
# Install dependencies
bun install   # or: npm install

# Run development server
bun run dev   # or: npm run dev

# Run test suite
bun run test  # or: npm test

# Run typecheck and lint
bunx tsc --noEmit
bun run lint

# Production build
bun run build
```

---

## Production Deployment & Go-Live

Refer to `roadmap.md` and the environment template in `.env.example`:

```env
DATABASE_URL="postgresql://user:password@host:5432/docurama?sslmode=require"
SESSION_SECRET="<generate-random-high-entropy-secret-min-32-chars>"
DOCURAMA_BOOTSTRAP_EMAIL="admin@yourdomain.com"
DOCURAMA_BOOTSTRAP_PASSWORD="<strong-initial-password>"
APP_URL="https://yourdomain.com"
STORAGE_DIR="./storage"
```

To deploy pre-built bundles:
```sh
bun run build
npx nitro deploy --prebuilt
```

---

## License & Security

- **License:** [Business Source License 1.1 (BUSL-1.1)](LICENSE) — converts to Apache 2.0 on 2030-01-01. Commercial production inquiries: `legal@voiria.com`.
- **Security Disclosures:** See [SECURITY.md](SECURITY.md) or write to `security@docurama.eu`.

---

*© 2024–2026 VOIRIA SASU (Docurama is a product of VOIRIA) · 1 Rue Marguerin, 75014 Paris, France · SIREN 131 914 012 · All rights reserved.*
