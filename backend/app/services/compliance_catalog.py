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
from datetime import datetime, timedelta, timezone

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
     "Stored documents are envelope-encrypted with AES-256-GCM at the storage layer when the operator configures DOCURAMA_STORAGE_ENCRYPTION_KEY; integrity is additionally anchored by SHA-256 at ingest and PAdES sealing. Rows written before activation stay readable and are re-encrypted on their next save; tampering of stored bytes fails the authentication tag check on read. Volume/disk encryption remains the operator's defence-in-depth.",
     "Implemented", "quarterly",
     [("code", "app/services/storage_crypto.py", "AES-256-GCM envelope format with key-id rotation support"),
      ("code", "app/services/storage_backend.py EncryptedBackend", "transparent wrap of local and S3; presigns disabled so ciphertext never leaves via object URLs"),
      ("test", "tests/test_sprint6_honest_gaps.py", "roundtrip, tamper rejection, wrong key, legacy tolerance, rotation"),
      ("config", ".env.example", "DOCURAMA_STORAGE_ENCRYPTION_KEY activation variable")]),
    ("ISO-05", "Logging & monitoring", "ISO27001",
     "Structured JSON request logging, health endpoints, and the hash-chained security ledger for authentication and administrative events.",
     "Implemented", "quarterly",
     [("code", "app/core/observability.py", "request logging middleware"),
      ("code", "app/services/audit_chain.py", "security ledger")]),
    ("ISO-06", "Backup & restore", "ISO27001",
     "Scheduled backup units ship in deploy/ and a restore-drill harness (scripts/restore_drill.py) restores a backup into a scratch database, runs integrity checks, reconciles per-table row counts and re-verifies the audit hash chains on the restored copy; every drill is recorded as evidence via POST /api/admin/compliance/restore-drills. Scheduling drills is an operator responsibility (quarterly by policy).",
     "Implemented", "quarterly",
     [("config", "deploy/docurama-backup.timer", "scheduled backup unit"),
      ("code", "scripts/restore_drill.py", "restore + integrity + row-count + hash-chain verification harness"),
      ("endpoint", "POST /api/admin/compliance/restore-drills", "drill evidence records"),
      ("test", "tests/test_sprint6_honest_gaps.py", "harness detects chain tampering on a restored copy")]),
    ("ISO-07", "Vulnerability management", "ISO27001",
     "CI enforces dependency audits (pip-audit, npm audit), static analysis (bandit) and secret scanning (gitleaks) with critical findings blocking merges; the workflow also runs on a weekly schedule, container images are scanned with trivy (critical findings block) and an SBOM inventory is published as a build artifact. Findings triage into the risk register. Runtime host scanning remains the operator's responsibility.",
     "Implemented", "quarterly",
     [("config", ".github/workflows/ci.yml", "security-gates + container-scan jobs, weekly schedule trigger"),
      ("code", "scripts/sbom.py", "dependency inventory artifact generator"),
      ("code", "scripts/security_gates.sh", "local parity for every gate"),
      ("endpoint", "GET /api/admin/compliance/risks", "triage register")]),
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
     "A risk register (risk_register table, /api/admin/compliance/risks) scores likelihood and impact on 1-5 scales server-side, tracks inherent versus residual scores with one of the four standard treatments, an owner and a next review date; it ships seeded with the platform's initial assessment and drives the quarterly review cycle.",
     "Implemented", "annual",
     [("code", "app/models/models.py RiskRegisterEntry", "scored register with treatment and review cadence"),
      ("endpoint", "GET /api/admin/compliance/risks", "register CRUD with server-computed scores"),
      ("test", "tests/test_sprint6_honest_gaps.py", "score computation, vocabulary and seed assessment pinned")]),
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


# ---------------------------------------------------------------------------
# Initial risk assessment (SOC2-01)
#
# The platform's first formal assessment, derived from the gap analysis in
# IMPROVEMENTS.md section 15 and the controls this codebase actually ships.
# Scores are recomputed server-side on every write; the values below are the
# assessor's 1-5 scale judgements, not magic numbers.
# ---------------------------------------------------------------------------

_RISKS = [
    # (risk_key, title, description, category, L, I, treatment, notes,
    #  rL, rI, owner, status, control_refs)
    ("RSK-001", "Confidential document exposure on shared storage",
     "Stored PDFs readable by whoever can reach the storage volume or bucket. Treated by AES-256-GCM envelope encryption at the storage layer (operator activates via key configuration) and S3 presigns capped at short TTLs; plaintext only ever exists in process memory.",
     "confidentiality", 3, 4, "mitigate",
     "Encryption at rest implemented; key configuration and volume encryption remain operator defence-in-depth.",
     1, 4, "Platform operator", "mitigating", "ISO-04,SOC2-04"),
    ("RSK-002", "Dependency supply-chain vulnerability",
     "A compromised or vulnerable backend/frontend dependency reaches production. Treated by fail-on-critical CI gates (pip-audit, npm audit, bandit, gitleaks), a weekly scheduled run, container scanning with trivy, and an SBOM inventory artifact.",
     "security", 3, 4, "mitigate",
     "Gates enforce critical findings; triage lands in this register. Zero known criticals at assessment time.",
     2, 3, "Platform operator", "mitigating", "ISO-07"),
    ("RSK-003", "Signing-service unavailability during ceremonies",
     "Recipients with an open signing session cannot complete signatures while the service is down; unsigned envelopes sit in a legally-sensitive in-flight state. Single-replica local deployments are the dominant exposure; multi-replica plumbing (Redis pub/sub, S3 storage) exists but is operator-configured.",
     "availability", 3, 3, "mitigate",
     "Health endpoints, daemon supervision and bounded retention sweeps reduce blast radius; HA deployment is the operator's next step.",
     2, 3, "Platform operator", "open", "ISO-05"),
    ("RSK-004", "Operator credential compromise",
     "A platform-admin credential leak yields full tenant access. Treated by Argon2-grade password hashing, TOTP MFA, session revocation via token_version, scoped API keys hashed at rest, and secret scanning to keep credentials out of the repository.",
     "security", 2, 5, "mitigate",
     "Detection of anomalous admin behaviour is ledger-visible (security events) but not yet alerting; noted for the next cycle.",
     1, 5, "Platform operator", "mitigating", "ISO-01,ISO-02,ISO-03"),
    ("RSK-005", "Wrongful deletion despite legal hold",
     "A retention sweep deletes data that a legal hold should have protected. Treated by hold-aware sweep logic (workspace and envelope scope), in-flight envelope exemption, bounded batches and ledger-logged deletions; pinned by tests.",
     "privacy", 2, 4, "mitigate",
     "Hold checks are enforced in the sweep path and covered by the compliance suite.",
     1, 3, "Platform operator", "mitigating", "GDPR-04"),
    ("RSK-006", "TSA outage blocks timestamping",
     "The operator-configured RFC 3161 TSA becomes unreachable, degrading signature timestamps to local time claims. Trust of timestamps equals the operator's TSA choice; a qualified TSA is not bundled.",
     "vendor", 2, 3, "transfer",
     "Timestamp authority availability is the TSA provider's SLA; operators should configure a secondary TSA where their use case demands it.",
     2, 3, "Platform operator", "accepted", "EIDAS-02"),
    ("RSK-007", "Audit trail tampering",
     "An attacker with database write access rewrites history to conceal an action. Treated by hash-chained ledgers (per-envelope and platform-wide), verify endpoints, seal snapshots that detect row removal, and flush-listener enforcement so no write path bypasses chaining.",
     "security", 1, 5, "mitigate",
     "Tamper detection is pinned by tests; seals should be taken after sensitive administrative windows.",
     1, 2, "Platform operator", "mitigating", "GDPR-06"),
    ("RSK-008", "Unrecoverable data loss",
     "Storage or database corruption destroys envelopes with no viable restore path. Treated by scheduled backup units in deploy/ and a restore-drill harness that verifies integrity, row counts and audit-chain validity on a restored copy; drill execution is operator-scheduled quarterly.",
     "availability", 2, 5, "mitigate",
     "Harness ships in source; the first recorded drill closes the evidence loop.",
     1, 4, "Platform operator", "open", "ISO-06"),
    ("RSK-009", "Cross-tenant data leakage",
     "A tenant reads another tenant's envelopes, templates or recipients. Treated by workspace-scoped queries enforced at the model layer and pinned by dedicated isolation test suites over real HTTP endpoints.",
     "privacy", 2, 5, "mitigate",
     "Isolation suites exercise cross-tenant reads against live routes; new endpoints inherit the scoping helpers.",
     1, 4, "Platform operator", "mitigating", "SOC2-04"),
]


def build_risk_rows() -> list[dict]:
    """Return the initial risk assessment ready for insertion.

    Scores are computed here the same way the API computes them at write
    time (likelihood x impact), so seeds and API-written rows can never
    disagree about the arithmetic.
    """
    rows = []
    for (risk_key, title, description, category, likelihood, impact,
         treatment, notes, r_l, r_i, owner, status, control_refs) in _RISKS:
        rows.append({
            "risk_key": risk_key,
            "title": title,
            "description": description,
            "category": category,
            "likelihood": likelihood,
            "impact": impact,
            "inherent_score": likelihood * impact,
            "treatment": treatment,
            "treatment_notes": notes,
            "residual_likelihood": r_l,
            "residual_impact": r_i,
            "residual_score": r_l * r_i,
            "owner": owner,
            "status": status,
            "control_refs": control_refs,
        })
    return rows


async def ensure_risks_seeded(db) -> int:
    """Idempotently seed the risk register. Returns the number of rows added."""
    from sqlalchemy import func, select
    from app.models import RiskRegisterEntry

    existing = (await db.execute(select(func.count(RiskRegisterEntry.id)))).scalar()
    if existing:
        return 0
    added = 0
    for attrs in build_risk_rows():
        row = RiskRegisterEntry(**attrs)
        row.next_review_at = datetime.now(timezone.utc) + timedelta(days=90)
        db.add(row)
        added += 1
    await db.commit()
    return added
