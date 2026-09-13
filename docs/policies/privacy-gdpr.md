# Privacy & GDPR Compliance Policy

**Owner:** Platform operator · **Review frequency:** annual · **Frameworks mapped:** GDPR (Art. 5-24, 32-35), eIDAS

## Position

Docurama is the processor for documents its customers send for signature and
the controller for its own account data. This policy states which GDPR
capabilities the platform implements, where they live in the code, and what
remains the operator's responsibility. It claims no certification and makes
no adequacy argument beyond what the code does.

## Implemented controls

- **PRV-01 / GDPR-01 - Lawful basis & consent.** Consent to named purposes is
  recorded with timestamps and evidence references, and revocable
  (`app/models/models.py ConsentRecord`, `POST /api/admin/consents`).
  Registration-time marketing consent is stored on the user record with its
  timestamp (`users.marketing_consent(_at)`).
- **PRV-02 / GDPR-02 - Access (export).** Data-subject export requests
  produce a structured JSON bundle of the subject's personal data - profile,
  memberships, consents, envelopes and signatures - with third-party
  identifiers excluded from audit projections
  (`app/services/dsar.py::_build_export`).
- **PRV-03 / GDPR-03 - Erasure.** Erasure anonymises the subject's user and
  recipient rows, invalidates outstanding signing links, and refuses to
  complete while signing obligations are pending
  (`app/services/dsar.py::_perform_erasure`).
- **PRV-04 / GDPR-04 - Storage limitation.** Configurable retention with
  legal holds and ledger-logged actions (see `data-retention.md`).
- **PRV-05 / GDPR-05 - Breach notification.** The 72-hour notification clock
  computed at incident insert, non-extendable, with honest overdue flags
  (see `incident-response.md`).
- **PRV-06 / GDPR-06 - Integrity & confidentiality.** Tamper-evident
  hash-chained audit ledgers; PAdES cryptographic sealing of signed
  documents; SHA-256 anchoring at ingest
  (`app/services/audit_chain.py`, `app/services/crypto_engine.py`).
- **PRV-07 / GDPR-07 - Subprocessor transparency.** Registry and public
  publication (see `subprocessors.md`).
- **PRV-08 - Data minimisation in evidence.** DSAR exports carry
  event-type-only audit context; the platform does not export other people's
  personal data to the subject bundle.
- **PRV-09 - Lawful access to audit.** Verification endpoints are
  platform-admin gated; the chain recompute reports what it found, not what
  it was asked to find.

## eIDAS positioning

- **EIDAS-01 - Advanced electronic signatures.** PAdES sealing (B-B through
  B-LTA) via pyHanko, with verification that never asserts more than it
  recomputed (`tests/test_trust_integrity.py`).
- **EIDAS-02 - Trusted timestamps: Partial.** RFC 3161 timestamping is
  supported and operator-configured (`DOCURAMA_TSA_URL`). Whether the chosen
  TSA is a qualified trust service provider is the operator's decision; no
  qualified-TSA claim is made by the platform.

## Honest limits

- **Data-protection impact assessment:** not implemented. The gap is recorded
  as SOC2-01 (risk assessment) in the control catalog.
- **EU representative (Art. 27):** not appointed; the trust center reports
  `gdpr_representative: null` rather than inventing one.
- **Data locations:** the storage backend is operator-configured (local disk
  or S3-compatible); the trust center states exactly that, and no "EU-only"
  claim is made beyond the sovereign hosting option the sales plans describe.

## Terminology guardrail

Across this policy, the dashboard and the trust center, only four readiness
states exist: **Implemented, Partial, Missing, Needs Review**. The words
"certified", "compliant", "audited" and "accredited" are not used to describe
this platform anywhere, because they are not true.
