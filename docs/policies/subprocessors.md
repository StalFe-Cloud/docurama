# Subprocessor & Third-Party Policy

**Owner:** Platform operator · **Review frequency:** quarterly · **Frameworks mapped:** GDPR (Art. 28), SOC 2 (CC9.2)

## Implemented controls

- **SUB-01 / GDPR-07 - Registry.** Every processor engaged to handle platform
  data is registered with name, purpose, data location and status
  (`app/models/models.py Subprocessor`, `GET/POST /api/admin/subprocessors`).
  Registration writes a hash-chained ledger event.
- **SUB-02 - Factual publication.** The public trust center
  (`GET /api/trust`, rendered at `/trust`) lists active and planned
  subprocessors exactly as registered - no invented vendors, no retroactive
  claims.
- **SUB-03 - Status lifecycle.** `planned → active → retired`; retired
  processors remain in the registry history and drop out of public
  publication.

## Honest limits

- **Vendor security review (SOC2-03): Partial.** The registry exists; a
  formal vendor security questionnaire and review process is not implemented.
  The gap is recorded on control SOC2-03 in the catalog with a `gap` evidence
  entry, and this policy does not pretend otherwise.
- **Who registers what:** the operator. The platform ships with an empty
  registry by design - seeding fictional vendors would be exactly the kind of
  compliance theatre this program exists to avoid. When the operator enables
  Stripe keys, engages an S3 provider, or configures a TSA, those processors
  belong in this registry with their real data locations.

## Contracts

Engagement of any processor must be backed by a written contract containing
the Art. 28 GDPR terms (processing on documented instructions, confidentiality,
security measures, assistance with data-subject rights, breach notification,
return/deletion, audit rights). The registry row is the pointer; the contract
is the evidence - attach its location as evidence on control SUB-01 via
`POST /api/admin/compliance/controls/{id}/evidence`.
