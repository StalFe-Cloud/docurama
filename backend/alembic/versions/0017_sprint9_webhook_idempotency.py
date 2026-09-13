"""Sprint 9: Stripe webhook idempotency ledger.

One table:

- stripe_events: persisted processing state for verified Stripe webhook
  events. The webhook is the only path that mutates plan state; Stripe
  delivers at-least-once and operators can redeliver from the dashboard, so
  every accepted event id is recorded exactly once (primary key on the
  Stripe event id). A replay meets the existing row and is acked with 200
  without re-applying the action.

Idempotent and offline-tolerant, dialect-aware throughout: fresh installs
get the table from Base.metadata; existing installs upgrade here.

Revision ID: 0017_sprint9_webhook_idempotency
Revises: 0016_sprint7_change_control
Create Date: 2026-09-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017_sprint9_webhook_idempotency"
down_revision: Union[str, None] = "0016_sprint7_change_control"
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


def upgrade() -> None:
    if "stripe_events" in _table_names():
        return
    op.create_table(
        "stripe_events",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("event_type", sa.String(120), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("account_id", sa.String(36), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stripe_events_event_type", "stripe_events", ["event_type"], unique=False)
    op.create_index("ix_stripe_events_account_id", "stripe_events", ["account_id"], unique=False)


def downgrade() -> None:
    if _dialect() == "sqlite":
        return
    op.drop_index("ix_stripe_events_account_id", table_name="stripe_events")
    op.drop_index("ix_stripe_events_event_type", table_name="stripe_events")
    op.drop_table("stripe_events")
