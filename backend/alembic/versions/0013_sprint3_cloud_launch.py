"""Sprint 3 cloud-launch schema: domain activation, marketing email, legal intake

Four concerns land together because they share one release:

- Domain activation (§18): domain_verifications.join_mode + the
  domain_join_requests approval queue. Only a VERIFIED domain may carry a join
  mode; the column default 'none' leaves every existing domain untouched.
- Marketing email accountability (§17): marketing_unsubscribes suppression
  list + email_send_logs metadata trail, and the users.marketing_consent(_at)
  pair that records consent exactly when it was given.
- Legal intake: the legal_notices table behind the public DMCA / TAKE IT DOWN
  endpoints, with verbatim statements and reporter IP.
- Billing sync columns: accounts.current_period_end / cancel_at_period_end,
  written only by the signature-verified webhook.

Column additions are written idempotently (an earlier partial run of this
migration must not wedge the second attempt) and dialect-aware: SQLite cannot
ALTER-add most constraints, so the fresh-install batch path creates columns
through batch mode while Postgres takes plain ADD COLUMN.

Revision ID: 0013_sprint3_cloud_launch
Revises: 0012_hot_path_indexes
Create Date: 2026-09-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013_sprint3_cloud_launch"
down_revision: Union[str, None] = "0012_hot_path_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _dialect() -> str:
    return op.get_bind().dialect.name


def _existing_columns(table: str) -> set:
    bind = op.get_bind()
    from sqlalchemy import inspect

    try:
        inspector = inspect(bind)
    except Exception:
        # Offline mode renders against a MockConnection with no inspector;
        # assume absent so the fresh-install path is emitted.
        return set()
    try:
        return {col["name"] for col in inspector.get_columns(table)}
    except Exception:
        return set()


def _add_column_if_missing(table: str, column: sa.Column) -> None:
    if column.name in _existing_columns(table):
        return
    if _dialect() == "sqlite":
        with op.batch_alter_table(table) as batch:
            batch.add_column(column)
    else:
        op.add_column(table, column)


def _table_exists(name: str) -> bool:
    from sqlalchemy import inspect

    try:
        inspector = inspect(op.get_bind())
    except Exception:
        return False
    return name in inspector.get_table_names()


def upgrade() -> None:
    # --- column additions (idempotent, dialect-aware) ---
    _add_column_if_missing(
        "users", sa.Column("marketing_consent", sa.Boolean(), nullable=False,
                           server_default=sa.false())
    )
    _add_column_if_missing(
        "users", sa.Column("marketing_consent_at", sa.DateTime(timezone=True), nullable=True)
    )
    _add_column_if_missing(
        "domain_verifications", sa.Column("join_mode", sa.String(20), nullable=False,
                                          server_default="none")
    )
    _add_column_if_missing(
        "accounts", sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True)
    )
    _add_column_if_missing(
        "accounts", sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False,
                              server_default=sa.false())
    )

    # --- new tables (create_table is idempotent-guarded against partial runs) ---
    if not _table_exists("legal_notices"):
        op.create_table(
            "legal_notices",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("kind", sa.String(20), nullable=False, server_default="dmca"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
            sa.Column("sla", sa.String(40), nullable=False, server_default=""),
            sa.Column("reporter_name", sa.String(255), nullable=False),
            sa.Column("reporter_email", sa.String(255), nullable=False),
            sa.Column("reporter_company", sa.String(255), nullable=True),
            sa.Column("content_location", sa.String(1000), nullable=False),
            sa.Column("original_work_reference", sa.String(2000), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("reporter_ip", sa.String(100), nullable=True),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_by", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not _table_exists("marketing_unsubscribes"):
        op.create_table(
            "marketing_unsubscribes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
            sa.Column("reason", sa.String(50), nullable=False, server_default="user_request"),
            sa.Column("source", sa.String(100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not _table_exists("email_send_logs"):
        op.create_table(
            "email_send_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("kind", sa.String(50), nullable=False),
            sa.Column("recipient", sa.String(255), nullable=False),
            sa.Column("subject", sa.String(500), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="sent"),
            sa.Column("error", sa.String(500), nullable=True),
            sa.Column("related_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        )

    if not _table_exists("domain_join_requests"):
        op.create_table(
            "domain_join_requests",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36),
                      sa.ForeignKey("accounts.id"), nullable=False, index=True),
            sa.Column("domain_id", sa.String(36),
                      sa.ForeignKey("domain_verifications.id"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"),
                      nullable=False, index=True),
            sa.Column("user_email", sa.String(255), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
            sa.Column("decided_by", sa.String(255), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    for table in ("domain_join_requests", "email_send_logs", "marketing_unsubscribes", "legal_notices"):
        if _table_exists(table):
            op.drop_table(table)
    for table, column in (
        ("accounts", "cancel_at_period_end"),
        ("accounts", "current_period_end"),
        ("domain_verifications", "join_mode"),
        ("users", "marketing_consent_at"),
        ("users", "marketing_consent"),
    ):
        if column in _existing_columns(table):
            if _dialect() == "sqlite":
                with op.batch_alter_table(table) as batch:
                    batch.drop_column(column)
            else:
                op.drop_column(table, column)
