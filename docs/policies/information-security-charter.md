# Information Security Charter

**Owner:** Platform operator · **Review frequency:** annual · **Frameworks mapped:** ISO 27001 (A.5), SOC 2 (CC1–CC9), GDPR (Art. 24, 32)

## Purpose and scope

This charter states how Docurama protects the information entrusted to it:
signed documents, identity data, and the audit evidence that binds the two
together. It applies to the Docurama codebase, its deployment configurations,
and every operator with administrative access.

This charter describes implemented controls. It deliberately does not claim
certification, accreditation, or third-party attestation of any kind: none
exists. Where a control is partial or absent, the charter says so and names
the gap. The live readiness state of every control referenced here is
published in the compliance dashboard (`/admin/compliance`) and the public
trust center (`/trust`), which are generated from the same catalog the code
ships with (`app/services/compliance_catalog.py`).

## Implemented controls

- **ISMS-01 / ISO-01 — Authentication.** Password authentication with
  Argon2-grade hashing, session cookies with rotation, and token-version-based
  revocation (`app/api/auth.py`, pinned by `tests/test_token_revocation.py`).
- **ISMS-02 / ISO-02 — MFA.** TOTP enrolment with confirm-on-first-use and
  recovery codes (`POST /api/auth/totp/enrol`).
- **ISMS-03 / ISO-03 — Least privilege.** Scoped API keys, hashed at rest
  (`app/services/api_keys.py`, pinned by `tests/test_api_key_scoping.py`).
- **ISMS-04 / GDPR-06 — Audit integrity.** Hash-chained, tamper-evident
  ledgers for envelope events and platform security events, with public
  verification vocabulary and seal snapshots
  (`app/services/audit_chain.py`, pinned by
  `tests/test_compliance_foundation.py`).
- **ISMS-05 / SOC2-04 — Tenant isolation.** Workspace scoping enforced in
  queries and pinned by dedicated isolation suites
  (`tests/test_tenant_isolation.py`, `tests/test_tenancy_rules.py`).
- **ISMS-06 / ISO-05 — Logging & monitoring.** Structured JSON request
  logging (`app/core/observability.py`) plus the security ledger for
  authentication and administrative events.
- **ISMS-07 / ISO-07 — Vulnerability management.** CI security gates
  (pip-audit, npm audit, bandit, gitleaks) run on every push and fail on
  critical findings (`.github/workflows/ci.yml`, job `security-gates`).
- **ISMS-08 / ISO-08 — Access review.** Periodic reviews recorded with
  reviewer, scope, findings and required changes
  (`POST /api/admin/compliance/access-reviews`).

## Partial controls (known gaps)

- **ISO-04 — Encryption at rest for documents.** Document integrity is
  anchored by SHA-256 at ingest and PAdES sealing at completion, but stored
  PDFs are plaintext on the storage backend; disk/volume encryption is the
  operator's control. Status: Partial.
- **ISO-06 — Backup & restore.** A systemd backup timer and rollback script
  ship in `deploy/`; restore drills are not automated. Status: Partial.
- **ISO-09 — Change management.** CI gates run tests, typecheck and build on
  every push; a formal approval workflow is not implemented. Status: Partial.
- **SOC2-01 — Risk assessment.** The gap analysis in `IMPROVEMENTS.md`
  §15 is the current informal baseline; no recurring formal process exists.
  Status: Missing.

## Review

The operator reviews this charter at least annually and whenever a control
above changes state. Every change to a readiness state is recorded in the
security ledger and is itself verifiable through the audit chain.
