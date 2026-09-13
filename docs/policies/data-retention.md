# Data Retention Policy

**Owner:** Platform operator · **Review frequency:** quarterly · **Frameworks mapped:** GDPR (Art. 5(1)(e), 17), ISO 27001 (A.8.10)

## Implemented controls

- **RET-01 / GDPR-04 - Configurable retention.** Retention periods are
  configurable per workspace and resource type, with a platform default that
  applies where a workspace has no override
  (`app/services/retention.py`, `PUT /api/admin/retention-policies`).
  Resource types: `envelopes`, `security_events`.
- **RET-02 - Retention applies to terminal records only.** Envelopes still in
  flight (draft, sent, delivered) are never retention candidates; the sweep
  examines `completed`, `voided` and `declined` envelopes only, anchored on
  their completion/update timestamp (pinned by
  `tests/test_compliance_foundation.py::test_retention_never_touches_in_flight_envelopes`).
- **RET-03 / GDPR-04 - Legal holds.** An active hold suspends retention
  actions for a whole workspace or a single envelope; releasing a hold lets
  the next sweep resume (`POST /api/admin/legal-holds`, `.../release`,
  pinned by `test_legal_hold_blocks_retention`).
- **RET-04 - Ledger-logged deletion.** Every retention action is written to
  the hash-chained security ledger before or as it happens; a silent
  retention deletion is impossible
  (`test_retention_deletes_aged_terminal_envelopes` asserts the ledger row).
- **RET-05 - Bounded batches.** The sweep processes at most 50 envelopes per
  run, so a bulk policy change cannot stall the platform.
- **RET-06 / GDPR-02 - DSAR export.** A data subject's personal data can be
  exported as a JSON bundle covering profile, memberships, consents,
  envelopes and signatures (`app/services/dsar.py`).
- **RET-07 / GDPR-03 - Erasure.** Erasure anonymises user and recipient rows
  and invalidates outstanding signing links; it refuses to complete while
  signing obligations are pending, surfacing them instead
  (`test_dsar_erasure_fails_while_signatures_pending`).
- **RET-08 / GDPR-01 - Consent ledger.** Consent to named purposes is
  recorded when given and revocable at any time
  (`POST /api/admin/consents`).

## Honest limits

- Ledger retention trades integrity for erasure: when the security-event
  retention policy removes aged ledger rows, the chain reports a gap - by
  design. The removal itself is recorded in the ledger first
  (`purge_expired_security_events`).
- Envelope audit events are retained as evidence even after a subject's
  erasure; they are part of the signature's evidentiary value. The erasure
  summary reports exactly what was anonymised.

## Background processing

The DSAR loop and retention sweep run as opt-in background workers
(`DOCURAMA_COMPLIANCE_JOBS_ENABLED`); the same operations are available
synchronously through the admin API for operators who prefer explicit runs.
