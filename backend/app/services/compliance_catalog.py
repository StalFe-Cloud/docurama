"""
The compliance control catalog.

This is the single source of truth for the control inventory shown on the
compliance dashboard and the public trust center. Every entry's readiness
value uses exactly one of the four legal states — Implemented, Partial,
Missing, Needs Review — and every evidence reference points at something real
in this repository (a code path, a test, a deployable, an endpoint).

Nothing here claims certification. A control is "Implemented" only when the
code that enforces it and the tests that pin it both exist; "Partial" when the
mechanism exists but a gap remains; "Missing" when nothing enforces it yet.
Operators update readiness through the admin API as the program matures; the
catalog below is the honest baseline this codebase ships with.
"""
from app.models import ComplianceControl, ControlEvidence

READINESS_STATES = ("Implemented", "Partial", "Missing", "Needs Review")
FRAMEWORKS = ("GDPR", "ISO27001", "SOC2", "eIDAS")

# (control_id, name, framework, description, readiness, review_frequency,
#  [(evidence_kind, reference, note), ...])
_CATALOG = [
    # ---------------- GDPR ----------------
    ("GDPR-01", "Lawful basis & consent ledger", "GDPR",
     "Consent to named purposes is recorded when given and revocable at any time; marketing consent is stored on the user record with its timestamp.",
     "Implemented", "annual",
     [("code", "app/services/dsar.py", "consent records travel with DSAR exports"),
      ("endpoint", "POST /api/admin/consents", "record and revoke consent per purpose"),
      ("code", "app/models/models.py ConsentRecord", "purpose, granted_at, revoked_at, evidence_ref")]),
    ("GDPR-02", "Data subject access (export)", "GDPR",
     "A data subject's personal data can be exported as a structured JSON bundle covering profile, memberships, consents, envelopes and signatures.",
     "Implemented", "annual",
     [("code", "app/services/dsar.py::_build_export", "assembly of the export bundle"),
      ("endpoint", "POST /api/admin/dsar", "creates an export request (state=queued)"),
      ("test", "tests/test_compliance_foundation.py", "pins the five-state lifecycle")]),
    ("GDPR-03", "Right to erasure", "GDPR",
     "Erasure anonymises the subject's user and recipient rows and invalidates outstanding signing links; it refuses (fails) while signing obligations are still pending.",
     "Implemented", "annual",
     [("code", "app/services/dsar.py::_perform_erasure", "anonymisation preserving audit evidence"),
      ("test", "tests/test_compliance_foundation.py", "pending-obligation failure path")]),
    ("GDPR-04", "Retention & legal hold", "GDPR",
     "Retention is configurable per workspace and resource type; an active legal hold blocks deletion; every retention action is written to the security ledger.",
     "Implemented", "quarterly",
     [("code", "app/services/retention.py", "sweep, holds, bounded batches"),
      ("endpoint", "PUT /api/admin/retention-policies", "platform default and per-account overrides")]),
    ("GDPR-05", "Breach notification 72h clock", "GDPR",
     "Security incidents record detection time and carry a non-extendable notification deadline of detected_at + 72 hours.",
     "Implemented", "quarterly",
     [("code", "app/models/models.py SecurityIncident", "gdpr_notification_deadline set at insert"),
      ("endpoint", "POST /api/admin/incidents", "deadline computed server-side")]),
    ("GDPR-06", "Audit trail integrity", "GDPR",
     "Envelope audit events and the platform security ledger are hash-chained; verification recomputes the chain and reports the first broken link; seals snapshot chain tips.",
     "Implemented", "quarterly",
     [("code", "app/services/audit_chain.py", "prev_hash/event_hash chaining and verify"),
      ("endpoint", "GET /api/admin/audit/verify", "recompute and report"),
      ("test", "tests/test_compliance_foundation.py", "tamper detection is pinned")]),
    ("GDPR-07", "Subprocessor registry", "GDPR",
     "Processors handling platform data are registered with purpose and data location; the public trust center lists them without inventing vendors.",
     "Implemented", "quarterly",
     [("endpoint", "GET /api/admin/subprocessors", "registry CRUD"),
      ("endpoint", "GET /api/trust", "public, factual publication")]),
    ("GDPR-08", "Data minimisation in exports", "GDPR",
     "DSAR exports include the subject's own data plus event-type-only audit context; third-party identifiers are excluded from bundles.",
     "Implemented", "annual",
     [("code", "app/services/dsar.py::_build_export", "audit_event_types projection")]),

    # ---------------- ISO 27001 readiness ----------------
    ("ISO-01", "Authentication & session control", "ISO27001",
     "Password authentication with Argon2-grade hashing, TOTP MFA enrolment, session cookies with rotation and token_version-based revocation.",
     "Implemented", "quarterly",
     [("code", "app/api/auth.py", "login, MFA, logout, revocation"),
      ("test", "tests/test_token_revocation.py", "revoked sessions are rejected")]),
    ("ISO-02", "Multi-factor authentication", "ISO27001",
     "TOTP enrolment with confirm-on-first-use, challenge tokens for MFA login, and disable-after-verify.",
     "Implemented", "quarterly",
     [("endpoint", "POST /api/auth/totp/enrol", "enrolment start/confirm/verify"),
      ("test", "tests/test_backend.py", "TOTP enrolment covered")]),
    ("ISO-03", "Least privilege & API key scoping", "ISO27001",
     "API keys carry explicit scopes and are hashed at rest; endpoints declare the scopes they accept.",
     "Implemented", "quarterly",
     [("code", "app/services/api_keys.py", "generation, hashing, scope checks"),
      ("test", "tests/test_api_key_scoping.py", "scope enforcement pinned")]),
    ("ISO-04", "Encryption at rest (documents)", "ISO27001",
     "Document integrity is anchored by SHA-256 at ingest and PAdES sealing at completion; stored PDFs are currently plaintext on the storage backend, so full at-rest encryption is NOT implemented.",
     "Partial", "quarterly",
     [("code", "app/services/crypto_engine.py", "PAdES sealing and verification"),
      ("gap", "storage backend", "files at rest are unencrypted; disk/volume encryption is the operator's control")]),
    ("ISO-05", "Logging & monitoring", "ISO27001",
     "Structured JSON request logging, health endpoints, and the hash-chained security ledger for authentication and administrative events.",
     "Implemented", "quarterly",
     [("code", "app/core/observability.py", "request logging middleware"),
      ("code", "app/services/audit_chain.py", "security ledger")]),
    ("ISO-06", "Backup & restore", "ISO27001",
     "A systemd timer/service pair for database backups and a rollback script ship in deploy/; restore drills are not automated and have not been evidenced.",
     "Partial", "quarterly",
     [("config", "deploy/docurama-backup.timer", "scheduled backup unit"),
      ("config", "deploy/rollback.sh", "rollback procedure"),
      ("gap", "restore drill", "no scheduled restore exercise yet")]),
    ("ISO-07", "Vulnerability management", "ISO27001",
     "CI runs dependency audits (pip-audit, npm audit), static analysis (bandit) and secret scanning (gitleaks) with critical findings blocking merges.",
     "Partial", "quarterly",
     [("config", ".github/workflows/ci.yml", "security-gates job"),
      ("gap", "runtime scanning", "no container runtime scanning yet")]),
    ("ISO-08", "Access review", "ISO27001",
     "Periodic access reviews are recorded with reviewer, scope, findings and required changes.",
     "Implemented", "quarterly",
     [("endpoint", "POST /api/admin/access-reviews", "record a completed review")]),
    ("ISO-09", "Secure development & change control", "ISO27001",
     "CI gates run tests, typecheck and build on every push; formal change-approval workflow is not implemented.",
     "Partial", "quarterly",
     [("config", ".github/workflows/ci.yml", "required checks"),
      ("gap", "approval flow", "no reviewer sign-off workflow")]),

    # ---------------- SOC 2 readiness ----------------
    ("SOC2-01", "Risk assessment", "SOC2",
     "No formal, recurring risk-assessment process is implemented; the gap analysis in IMPROVEMENTS.md section 15 is the current informal baseline.",
     "Missing", "annual",
     [("code", "IMPROVEMENTS.md section 15", "informal gap analysis only")]),
    ("SOC2-02", "Incident response", "SOC2",
     "Incidents are recorded with severity, containment and resolution timestamps plus notification tracking; runbook documents the procedure.",
     "Implemented", "quarterly",
     [("endpoint", "POST /api/admin/incidents", "record and progress incidents"),
      ("config", "docs/policies/incident-response.md", "procedure mapping control IDs")]),
    ("SOC2-03", "Vendor & subprocessor management", "SOC2",
     "Subprocessors are registered and published; formal vendor security review questionnaires are not implemented.",
     "Partial", "annual",
     [("endpoint", "GET /api/admin/subprocessors", "registry"),
      ("gap", "vendor review", "no security questionnaire process")]),
    ("SOC2-04", "Tenant isolation", "SOC2",
     "Workspace scoping is enforced in queries and pinned by a dedicated isolation test-suite; cross-tenant reads are tested against real endpoints.",
     "Implemented", "quarterly",
     [("test", "tests/test_tenant_isolation.py", "isolation pinned over HTTP"),
      ("test", "tests/test_tenancy_rules.py", "model-level rules")]),

    # ---------------- eIDAS readiness ----------------
    ("EIDAS-01", "Advanced electronic signatures (PAdES)", "eIDAS",
     "Documents are sealed with PAdES (B-B up to B-LTA) via pyHanko; verification never asserts more than it recomputed.",
     "Implemented", "annual",
     [("code", "app/services/crypto_engine.py", "PAdES levels and negative-by-default verification"),
      ("test", "tests/test_trust_integrity.py", "no failure path yields a positive assertion")]),
    ("EIDAS-02", "Trusted timestamps (RFC 3161)", "eIDAS",
     "RFC 3161 timestamping is supported and operator-configured via TSA_URL; a qualified TSA is not bundled, so timestamp trust equals the operator's TSA choice.",
     "Partial", "annual",
     [("code", "app/core/config.py", "TSA_URL setting"),
      ("gap", "qualified TSA", "operator must configure a qualified TSA for QES-adjacent claims")]),
    ("EIDAS-03", "Signature audit evidence", "eIDAS",
     "Every signing action writes an audit event carrying the document hash state, chained per envelope with tamper evidence.",
     "Implemented", "annual",
     [("code", "app/api/signing.py", "hash_state anchored to the signed document"),
      ("code", "app/services/audit_chain.py::chain_envelope_event", "envelope chain linking")]),
]


def build_catalog_rows() -> list[tuple[dict, list[dict]]]:
    """Return [(control_attrs, [evidence_attrs]), ...] ready for insertion."""
    rows = []
    for control_id, name, framework, description, readiness, frequency, evidence in _CATALOG:
        rows.append((
            {
                "control_id": control_id,
                "name": name,
                "framework": framework,
                "description": description,
                "readiness": readiness,
                "review_frequency": frequency,
            },
            [{"kind": kind, "reference": ref, "note": note} for kind, ref, note in evidence],
        ))
    return rows


async def ensure_seeded(db) -> int:
    """Idempotently seed the catalog. Returns the number of controls added.

    Called by the admin compliance endpoints when the table is empty and by
    migration 0014, so both fresh installs (migrations) and test harnesses
    (metadata.create_all) get the same inventory.
    """
    from sqlalchemy import func, select
    from app.models import ComplianceControl

    existing = (await db.execute(select(func.count(ComplianceControl.id)))).scalar()
    if existing:
        return 0
    added = 0
    for attrs, evidence in build_catalog_rows():
        control = ComplianceControl(**attrs)
        db.add(control)
        await db.flush()
        for ev in evidence:
            db.add(ControlEvidence(control_id_fk=control.id, **ev))
        added += 1
    await db.commit()
    return added
