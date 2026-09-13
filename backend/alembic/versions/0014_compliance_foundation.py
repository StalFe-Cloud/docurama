"""Compliance & Trust Foundation schema.

Eleven tables plus chain columns on the existing audit trail:

- security_events: the platform-wide, hash-chained ledger (auth, admin,
  privacy, operational events) with prev_hash/event_hash per row.
- audit_events gains seq/prev_hash/event_hash for per-envelope chaining; the
  columns are nullable so historical rows stay valid, and the flush listener
  chains every new row regardless of source.
- dsar_requests / consent_records / legal_holds / retention_policies: the
  privacy engine (five-state DSAR lifecycle, consent ledger, holds that block
  retention, configurable policy overrides with a platform default).
- security_incidents: incident response with the GDPR 72-hour notification
  clock computed at insert and never extended.
- subprocessors: the processor registry the trust center publishes.
- compliance_controls / control_evidence: the readiness catalog (Implemented
  / Partial / Missing / Needs Review) with pointers at real evidence.
- access_reviews: recorded periodic reviews.
- audit_chain_seals: point-in-time chain-tip snapshots.

Dialect-aware throughout: SQLite takes batch-mode column adds, Postgres takes
plain ADD COLUMN. The control catalog is seeded here for migrated installs;
the same catalog is idempotently (re)seeded by the API layer for
metadata-created test databases, so both paths converge.

Revision ID: 0014_compliance_foundation
Revises: 0013_sprint3_cloud_launch
Create Date: 2026-09-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014_compliance_foundation"
down_revision: Union[str, None] = "0013_sprint3_cloud_launch"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _dialect() -> str:
    return op.get_bind().dialect.name


def _existing_columns(table: str) -> set:
    try:
        inspector = sa.inspect(op.get_bind())
    except Exception:
        # Offline mode renders against a MockConnection with no inspector;
        # assume absent so the fresh-install path is emitted.
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _add_columns(table: str, columns: list) -> None:
    """Idempotent, dialect-aware column add."""
    existing = _existing_columns(table)
    for name, col in columns:
        if name in existing:
            continue
        if _dialect() == "sqlite":
            with op.batch_alter_table(table) as batch:
                batch.add_column(col)
        else:
            op.add_column(table, col)


def _audit_cols() -> list:
    return [
        ("seq", sa.Column("seq", sa.Integer(), nullable=True)),
        ("prev_hash", sa.Column("prev_hash", sa.String(64), nullable=True)),
        ("event_hash", sa.Column("event_hash", sa.String(64), nullable=True)),
    ]


_TABLES = [
    dict(
        name="security_events",
        columns=[
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36), nullable=True),
            sa.Column("actor_user_id", sa.String(36), nullable=True),
            sa.Column("actor_email", sa.String(255), nullable=True),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("severity", sa.String(20), nullable=False, server_default="info"),
            sa.Column("ip_address", sa.String(100), nullable=True),
            sa.Column("user_agent", sa.String(500), nullable=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("detail", sa.JSON(), nullable=True),
            sa.Column("prev_hash", sa.String(64), nullable=False),
            sa.Column("event_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ],
        indexes=[
            ("ix_security_events_seq", ["seq"], True),
            ("ix_security_events_event_type", ["event_type"], False),
            ("ix_security_events_account_id", ["account_id"], False),
        ],
    ),
    dict(
        name="dsar_requests",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=False),
            sa.Column("subject_email", sa.String(255), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("state", sa.String(20), nullable=False, server_default="queued"),
            sa.Column("requested_by_user_id", sa.String(36),
                      sa.ForeignKey("users.id"), nullable=True),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("result_ref", sa.String(500), nullable=True),
            sa.Column("result_summary", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[
            ("ix_dsar_requests_account_id", ["account_id"], False),
            ("ix_dsar_requests_subject_email", ["subject_email"], False),
            ("ix_dsar_requests_state", ["state"], False),
        ],
    ),
    dict(
        name="consent_records",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=False),
            sa.Column("subject_email", sa.String(255), nullable=False),
            sa.Column("purpose", sa.String(100), nullable=False),
            sa.Column("granted", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("evidence_ref", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[
            ("ix_consent_records_account_id", ["account_id"], False),
            ("ix_consent_records_subject_email", ["subject_email"], False),
        ],
    ),
    dict(
        name="legal_holds",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("scope_envelope_id", sa.String(36), nullable=True),
            sa.Column("created_by_user_id", sa.String(36),
                      sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[
            ("ix_legal_holds_account_id", ["account_id"], False),
            ("ix_legal_holds_scope_envelope_id", ["scope_envelope_id"], False),
        ],
    ),
    dict(
        name="retention_policies",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=True),
            sa.Column("resource_type", sa.String(50), nullable=False),
            sa.Column("retention_days", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(20), nullable=False, server_default="delete"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("updated_by_user_id", sa.String(36),
                      sa.ForeignKey("users.id"), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[("ix_retention_policies_account_id", ["account_id"], False)],
    ),
    dict(
        name="security_incidents",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(20), nullable=False, server_default="detected"),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=True),
            sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("contained_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("gdpr_notification_deadline", sa.DateTime(timezone=True), nullable=False),
            sa.Column("authority_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("subjects_notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reported_by", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[
            ("ix_security_incidents_severity", ["severity"], False),
            ("ix_security_incidents_status", ["status"], False),
            ("ix_security_incidents_account_id", ["account_id"], False),
        ],
    ),
    dict(
        name="subprocessors",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("purpose", sa.String(500), nullable=False),
            sa.Column("data_location", sa.String(255), nullable=False,
                      server_default="Operator-configured"),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("url", sa.String(500), nullable=True),
            sa.Column("added_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[("ix_subprocessors_status", ["status"], False)],
    ),
    dict(
        name="compliance_controls",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("control_id", sa.String(50), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("framework", sa.String(50), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("owner_role", sa.String(100), nullable=False,
                      server_default="Platform operator"),
            sa.Column("readiness", sa.String(20), nullable=False, server_default="Missing"),
            sa.Column("review_frequency", sa.String(20), nullable=False, server_default="annual"),
            sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[("ix_compliance_controls_control_id", ["control_id"], True),
                 ("ix_compliance_controls_framework", ["framework"], False)],
    ),
    dict(
        name="control_evidence",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("control_id_fk", sa.String(36),
                      sa.ForeignKey("compliance_controls.id"), nullable=False),
            sa.Column("kind", sa.String(30), nullable=False, server_default="test"),
            sa.Column("reference", sa.String(500), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[("ix_control_evidence_control_id_fk", ["control_id_fk"], False)],
    ),
    dict(
        name="access_reviews",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reviewer_user_id", sa.String(36),
                      sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewer_email", sa.String(255), nullable=False),
            sa.Column("scope", sa.String(255), nullable=False,
                      server_default="platform admin + workspace owners"),
            sa.Column("findings", sa.Text(), nullable=True),
            sa.Column("accounts_reviewed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("changes_required", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        ],
    ),
    dict(
        name="audit_chain_seals",
        columns=[
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("scope", sa.String(100), nullable=False),
            sa.Column("last_seq", sa.Integer(), nullable=False),
            sa.Column("last_event_hash", sa.String(64), nullable=False),
            sa.Column("event_count", sa.Integer(), nullable=False),
            sa.Column("sealed_by", sa.String(255), nullable=False, server_default="system"),
            sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        ],
        indexes=[("ix_audit_chain_seals_scope", ["scope"], False)],
    ),
]


def _table_names() -> set:
    try:
        return set(sa.inspect(op.get_bind()).get_table_names())
    except Exception:
        return set()


def _index_names(table: str) -> set:
    try:
        return {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(table)}
    except Exception:
        return set()


def upgrade() -> None:
    _add_columns("audit_events", _audit_cols())

    existing_tables = _table_names()
    for spec in _TABLES:
        if spec["name"] in existing_tables:
            continue
        op.create_table(spec["name"], *spec["columns"])
        for ix_name, cols, unique in spec.get("indexes", []):
            op.create_index(ix_name, spec["name"], cols, unique=unique)

    # Chain columns benefit from index support on per-envelope walks.
    if "ix_audit_events_envelope_id" not in _index_names("audit_events"):
        op.create_index("ix_audit_events_envelope_id", "audit_events", ["envelope_id"])

    _seed_catalog()


def _seed_catalog() -> None:
    """Seed the readiness catalog. Idempotent: control_id is unique."""
    from app.services.compliance_catalog import build_catalog_rows
    import uuid as _uuid
    from datetime import datetime, timezone

    bind = op.get_bind()
    already = set()
    try:
        result = bind.execute(sa.text("SELECT control_id FROM compliance_controls"))
        if result is not None:
            already = {row[0] for row in result}
    except Exception:
        # Offline mode / fresh database: no rows to dedupe against.
        already = set()
    for attrs, evidence in build_catalog_rows():
        if attrs["control_id"] in already:
            continue
        cid = str(_uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        bind.execute(
            sa.text(
                "INSERT INTO compliance_controls (id, control_id, name, framework, "
                "description, readiness, review_frequency, created_at, updated_at) "
                "VALUES (:id, :control_id, :name, :framework, :description, "
                ":readiness, :review_frequency, :created_at, :updated_at)"
            ),
            {**attrs, "id": cid, "created_at": now, "updated_at": now},
        )
        for ev in evidence:
            bind.execute(
                sa.text(
                    "INSERT INTO control_evidence (id, control_id_fk, kind, reference, note, collected_at) "
                    "VALUES (:id, :control_id_fk, :kind, :reference, :note, :collected_at)"
                ),
                {"id": str(_uuid.uuid4()), "control_id_fk": cid, "kind": ev["kind"],
                 "reference": ev["reference"], "note": ev.get("note"),
                 "collected_at": now},
            )


def downgrade() -> None:
    # Chain columns are additive and nullable; removing them degrades the
    # audit trail, which a downgrade is allowed to do.
    for spec in reversed(_TABLES):
        op.drop_table(spec["name"])
    if _dialect() == "sqlite":
        with op.batch_alter_table("audit_events") as batch:
            batch.drop_column("event_hash")
            batch.drop_column("prev_hash")
            batch.drop_column("seq")
    else:
        op.drop_column("audit_events", "event_hash")
        op.drop_column("audit_events", "prev_hash")
        op.drop_column("audit_events", "seq")
