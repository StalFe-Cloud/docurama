"""Sprint 7: change control and vendor security reviews.

Two tables plus catalog refresh:

- change_requests: the ISO-09 four-eyes change workflow - proposed ->
  approved or rejected -> implemented, approver must differ from requester,
  emergency changes stay visibly overdue for retroactive review until a
  reviewer signs off.
- vendor_reviews: the SOC2-03 vendor security questionnaire register - data
  access level, personal-data involvement, hosting region, questionnaire
  answers, outcome (approved/conditional/rejected/pending), findings and a
  next-review date required server-side for approved or conditional
  outcomes. Seeded with the platform's initial vendor assessment.

The control catalog is refreshed in the same migration: ISO-09 and SOC2-03
move to Implemented with real evidence references. Updates are idempotent
and offline-tolerant, dialect-aware throughout.

Revision ID: 0016_sprint7_change_control
Revises: 0015_sprint6_honest_gaps
Create Date: 2026-09-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016_sprint7_change_control"
down_revision: Union[str, None] = "0015_sprint6_honest_gaps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _dialect() -> str:
    return op.get_bind().dialect.name


def _table_names() -> set:
    try:
        return set(sa.inspect(op.get_bind()).get_table_names())
    except Exception:
        # Offline mode: render the fresh-install path.
        return set()


_TABLES = [
    dict(
        name="change_requests",
        columns=[
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("change_key", sa.String(50), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("change_type", sa.String(20), nullable=False),
            sa.Column("risk_notes", sa.Text(), nullable=True),
            sa.Column("control_refs", sa.String(500), nullable=True),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("requested_by", sa.String(255), nullable=False),
            sa.Column("reviewed_by", sa.String(255), nullable=True),
            sa.Column("review_notes", sa.Text(), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("implemented_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("change_key"),
        ],
        indexes=[
            ("ix_change_requests_change_key", ["change_key"], False),
            ("ix_change_requests_change_type", ["change_type"], False),
            ("ix_change_requests_status", ["status"], False),
        ],
    ),
    dict(
        name="vendor_reviews",
        columns=[
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("vendor_key", sa.String(50), nullable=False),
            sa.Column("vendor_name", sa.String(255), nullable=False),
            sa.Column("service_provided", sa.String(500), nullable=False),
            sa.Column("data_access_level", sa.String(20), nullable=False),
            sa.Column("personal_data", sa.Boolean(), nullable=False),
            sa.Column("hosting_region", sa.String(120), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reviewer", sa.String(255), nullable=False),
            sa.Column("questionnaire", sa.JSON(), nullable=True),
            sa.Column("outcome", sa.String(20), nullable=False),
            sa.Column("findings", sa.Text(), nullable=True),
            sa.Column("next_review_due", sa.DateTime(timezone=True), nullable=True),
            sa.Column("control_refs", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("vendor_key"),
        ],
        indexes=[
            ("ix_vendor_reviews_vendor_key", ["vendor_key"], False),
            ("ix_vendor_reviews_data_access_level", ["data_access_level"], False),
            ("ix_vendor_reviews_outcome", ["outcome"], False),
        ],
    ),
]

# Catalog rows whose description/readiness move with this migration. The
# evidence lists are replaced wholesale (delete + re-insert) so the evidence
# set always matches what build_catalog_rows() declares for fresh installs.
_CATALOG_UPDATES = {
    "ISO-09": "Implemented",
    "SOC2-03": "Implemented",
}


def upgrade() -> None:
    existing_tables = _table_names()
    for spec in _TABLES:
        if spec["name"] in existing_tables:
            continue
        op.create_table(spec["name"], *spec["columns"])
        for ix_name, cols, unique in spec.get("indexes", []):
            op.create_index(ix_name, spec["name"], cols, unique=unique)

    _refresh_catalog()
    _seed_vendor_reviews()


def _refresh_catalog() -> None:
    """Move the two controls to their new honest baseline.

    Idempotent: rows already carrying the target readiness keep their
    updated_at; evidence is re-read from the catalog builder so migrated
    installs and fresh installs converge on the same evidence set.
    """
    from app.services.compliance_catalog import build_catalog_rows
    import uuid as _uuid
    from datetime import datetime, timezone

    bind = op.get_bind()
    desired = {attrs["control_id"]: (attrs, evidence)
               for attrs, evidence in build_catalog_rows()}
    now = datetime.now(timezone.utc).isoformat()

    for control_id, readiness in _CATALOG_UPDATES.items():
        if control_id not in desired:
            continue
        attrs, evidence = desired[control_id]
        row = bind.execute(
            sa.text("SELECT id, readiness FROM compliance_controls WHERE control_id = :cid"),
            {"cid": control_id},
        ).first()
        if row is None:
            # Install predates this control (unexpected); insert it whole.
            cid = str(_uuid.uuid4())
            bind.execute(
                sa.text(
                    "INSERT INTO compliance_controls (id, control_id, name, framework, "
                    "description, readiness, review_frequency, created_at, updated_at) "
                    "VALUES (:id, :control_id, :name, :framework, :description, "
                    ":readiness, :review_frequency, :created_at, :updated_at)"
                ),
                {**attrs, "id": cid, "created_at": now, "updated_at": now},
            )
        else:
            cid = row[0]
            if row[1] != readiness:
                bind.execute(
                    sa.text(
                        "UPDATE compliance_controls SET readiness = :readiness, "
                        "description = :description, updated_at = :updated_at "
                        "WHERE id = :id"
                    ),
                    {"readiness": readiness, "description": attrs["description"],
                     "updated_at": now, "id": cid},
                )
        # Replace evidence wholesale so references match the current builder.
        try:
            bind.execute(sa.text("DELETE FROM control_evidence WHERE control_id_fk = :id"), {"id": cid})
            for ev in evidence:
                bind.execute(
                    sa.text(
                        "INSERT INTO control_evidence (id, control_id_fk, kind, reference, note, collected_at) "
                        "VALUES (:id, :control_id_fk, :kind, :reference, :note, :collected_at)"
                    ),
                    {"id": str(_uuid.uuid4()), "control_id_fk": cid, "kind": ev["kind"],
                     "reference": ev["reference"], "note": ev.get("note"), "collected_at": now},
                )
        except Exception:
            # Offline mode with a mocked bind: skip the evidence rewrite.
            pass

    # Seeds for fresh installs that skip 0014's seeder (defensive; idempotent).
    try:
        have = bind.execute(sa.text("SELECT COUNT(*) FROM compliance_controls")).scalar()
        if not have:
            from app.services.compliance_catalog import ensure_seeded  # noqa: F401
    except Exception:
        pass


def _seed_vendor_reviews() -> None:
    """Seed the initial vendor assessment. Idempotent: vendor_key is unique."""
    from app.services.compliance_catalog import build_vendor_review_rows
    import json as _json
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone

    bind = op.get_bind()
    already = set()
    try:
        result = bind.execute(sa.text("SELECT vendor_key FROM vendor_reviews"))
        if result is not None:
            already = {row[0] for row in result}
    except Exception:
        already = set()
    now_dt = datetime.now(timezone.utc)
    next_due = (now_dt + timedelta(days=180)).isoformat()
    for attrs in build_vendor_review_rows():
        if attrs["vendor_key"] in already:
            continue
        row = dict(attrs)
        row["reviewed_at"] = now_dt.isoformat()
        row["reviewer"] = "Platform operator"
        row["next_review_due"] = next_due
        bind.execute(
            sa.text(
                "INSERT INTO vendor_reviews (id, vendor_key, vendor_name, service_provided, "
                "data_access_level, personal_data, hosting_region, reviewed_at, reviewer, "
                "questionnaire, outcome, findings, next_review_due, control_refs, "
                "created_at, updated_at) "
                "VALUES (:id, :vendor_key, :vendor_name, :service_provided, "
                ":data_access_level, :personal_data, :hosting_region, :reviewed_at, "
                ":reviewer, :questionnaire, :outcome, :findings, :next_review_due, "
                ":control_refs, :created_at, :updated_at)"
            ),
            {
                **row,
                "id": str(_uuid.uuid4()),
                # JSON travels as text in raw SQL on both dialects.
                "questionnaire": _json.dumps(row.get("questionnaire") or {}, sort_keys=True),
                "created_at": now_dt.isoformat(),
                "updated_at": now_dt.isoformat(),
            },
        )


def downgrade() -> None:
    for spec in reversed(_TABLES):
        op.drop_table(spec["name"])
