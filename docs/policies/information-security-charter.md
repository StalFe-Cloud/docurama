# Information Security Charter

**Owner:** Platform operator · **Review frequency:** annual · **Frameworks mapped:** ISO 27001 (A.5), SOC 2 (CC1-CC9), GDPR (Art. 24, 32)

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

- **ISMS-01 / ISO-01 - Authentication.** Password authentication with
  Argon2-grade hashing, session cookies with rotation, and token-version-based
  revocation (`app/api/auth.py`, pinned by `tests/test_token_revocation.py`).
- **ISMS-02 / ISO-02 - MFA.** TOTP enrolment with confirm-on-first-use and
  recovery codes (`POST /api/auth/totp/enrol`).
- **ISMS-03 / ISO-03 - Least privilege.** Scoped API keys, hashed at rest
  (`app/services/api_keys.py`, pinned by `tests/test_api_key_scoping.py`).
- **ISMS-04 / GDPR-06 - Audit integrity.** Hash-chained, tamper-evident
  ledgers for envelope events and platform security events, with public
  verification vocabulary and seal snapshots
  (`app/services/audit_chain.py`, pinned by
  `tests/test_compliance_foundation.py`).
- **ISMS-05 / SOC2-04 - Tenant isolation.** Workspace scoping enforced in
  queries and pinned by dedicated isolation suites
  (`tests/test_tenant_isolation.py`, `tests/test_tenancy_rules.py`).
- **ISMS-06 / ISO-05 - Logging & monitoring.** Structured JSON request
  logging (`app/core/observability.py`) plus the security ledger for
  authentication and administrative events.
- **ISMS-07 / ISO-07 - Vulnerability management.** CI security gates
  (pip-audit, npm audit, bandit, gitleaks) run on every push and fail on
  critical findings (`.github/workflows/ci.yml`, job `security-gates`); the
  workflow also runs on a weekly schedule and on demand, container images
  are scanned with trivy (critical findings block, job `container-scan`),
  and an SBOM inventory is published as a build artifact
  (`scripts/sbom.py`). Findings triage into the risk register.
- **ISMS-08 / ISO-08 - Access review.** Periodic reviews recorded with
  reviewer, scope, findings and required changes
  (`POST /api/admin/compliance/access-reviews`).
- **ISMS-09 / ISO-04 - Encryption at rest (documents).** Stored documents
  are envelope-encrypted with AES-256-GCM at the storage layer when the
  operator configures `DOCURAMA_STORAGE_ENCRYPTION_KEY`; stored bytes that
  are modified after write fail the authentication tag check on read, and
  presigned object URLs are disabled under encryption so ciphertext never
  leaves through object storage (`app/services/storage_crypto.py`,
  `app/services/storage_backend.py`, pinned by
  `tests/test_sprint6_honest_gaps.py`).
- **ISMS-10 / ISO-06 - Backup & restore drills.** Scheduled backup units
  ship in `deploy/`; the restore-drill harness
  (`scripts/restore_drill.py`) restores a backup into a scratch database,
  runs integrity checks, reconciles row counts and re-verifies the audit
  hash chains, and each drill is archived as evidence via
  `POST /api/admin/compliance/restore-drills`. Quarterly execution is the
  operator's responsibility.
- **ISMS-11 / SOC2-01 - Risk assessment.** A scored risk register
  (`risk_register`, `/api/admin/compliance/risks`) with server-computed
  inherent and residual scores, one of the four standard treatments per
  risk, an owner and a next review date. It ships seeded with the initial
  assessment; the quarterly review cycle updates it through the API, and
  every change lands in the security ledger.

## Partial controls (known gaps)

- **ISO-09 - Change management.** CI gates run tests, typecheck and build on
  every push; a formal approval workflow is not implemented. Status: Partial.
- **SOC2-03 - Vendor security review.** Subprocessors are registered and
  published; a formal vendor security questionnaire process is not
  implemented. Status: Partial.
- **EIDAS-02 - Qualified timestamps.** RFC 3161 timestamping is supported
  and operator-configured; a qualified TSA is not bundled, so timestamp
  trust equals the operator's TSA choice. Status: Partial.

## Operator responsibilities carried by the controls above

- Configure `DOCURAMA_STORAGE_ENCRYPTION_KEY` to activate at-rest
  encryption (ISO-04 is Implemented in code; the key is the activation
  switch). Rotate via `DOCURAMA_STORAGE_ENCRYPTION_KEY_ID` +
  `DOCURAMA_STORAGE_ENCRYPTION_KEY_PREVIOUS`.
- Schedule and execute quarterly restore drills with the harness and record
  them (ISO-06); the first recorded drill closes the evidence loop.
- Run the quarterly risk-register review (SOC2-01) through the admin API.

## Review

The operator reviews this charter at least annually and whenever a control
above changes state. Every change to a readiness state is recorded in the
security ledger and is itself verifiable through the audit chain.
