# Incident Response Policy

**Owner:** Platform operator · **Review frequency:** quarterly · **Frameworks mapped:** GDPR (Art. 33, 34), SOC 2 (CC7.3–7.5), ISO 27001 (A.5.24–5.28)

## Implemented controls

- **IR-01 / GDPR-05 — The 72-hour clock.** Every recorded incident computes
  its GDPR authority-notification deadline as `detected_at + 72 hours` at
  insert time, server-side. The deadline cannot be extended after the fact;
  only an actual notification timestamp closes it out
  (`app/models/models.py SecurityIncident`,
  `POST /api/admin/incidents`, pinned by
  `tests/test_compliance_foundation.py::test_incident_deadline_is_detection_plus_72h`).
- **IR-02 — Honest overdue state.** An open, un-notified incident past its
  deadline is flagged `notification_overdue` everywhere it appears — the
  register, the dashboard aggregate — never hidden
  (`test_overdue_incident_is_flagged_not_hidden`).
- **IR-03 — Lifecycle states.** `detected → contained → resolved`, with
  containment and resolution timestamps recorded by the endpoints that set
  them (`.../contain`, `.../resolve?authority_notified=&subjects_notified=`).
- **IR-04 / ISO-05 — Ledger integration.** Recording, containing and
  resolving an incident each write a hash-chained security-ledger event, so
  incident handling is itself tamper-evidently auditable.
- **IR-05 — Severity taxonomy.** `low | medium | high | critical`, chosen at
  creation; high and critical incidents enter the ledger at critical
  severity.

## Procedure (runbook)

1. **Detect.** Events arrive from the security ledger
   (`GET /api/admin/audit/security-events`), request logs, or external
   reports (see `/.well-known/security.txt`).
2. **Record.** Open an incident with severity and a factual description.
   The 72-hour clock starts at `detected_at`; backdate it only to the real
   detection time, never to flatter the clock.
3. **Contain.** Move the incident to `contained` with the containment
   timestamp when the exposure is stopped.
4. **Notify.** If the incident is a personal-data breach likely to result in
   a risk to rights and freedoms, notify the competent supervisory authority
   within 72 hours of detection (GDPR Art. 33) and, where required, the
   affected subjects (Art. 34). Record the actual notification timestamps by
   resolving with `authority_notified=true` / `subjects_notified=true`.
5. **Resolve & review.** Close the incident with a resolution timestamp and
   record the post-incident review in the findings of the next access review
   or as evidence on the relevant control.

## Honest limits

- The platform records and tracks the procedure; it does not (and cannot)
  make the notification decision. That judgement is the operator's, on legal
  advice.
- Notification clocks for subprocessor breaches depend on subprocessor
  contracts; the subprocessor registry (`GET /api/admin/subprocessors`)
  is the operator's working list.
