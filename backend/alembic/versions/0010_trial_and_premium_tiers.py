"""add trial lifecycle and premium billing fields to accounts

Replaces permanent free tier in cloud mode with a 7-day no-card trial
of the Plus tier, and adds billing interval and Stripe integration fields.

Revision ID: 0010_trial_and_premium_tiers
Revises: 0009_account_plans_and_quotas
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010_trial_and_premium_tiers"
down_revision: Union[str, None] = "0009_account_plans_and_quotas"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("is_trial", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "accounts",
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column("billing_interval", sa.String(length=16), nullable=False, server_default="monthly")
    )
    op.add_column(
        "accounts",
        sa.Column("stripe_customer_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column("stripe_subscription_id", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("accounts", "stripe_subscription_id")
    op.drop_column("accounts", "stripe_customer_id")
    op.drop_column("accounts", "billing_interval")
    op.drop_column("accounts", "trial_ends_at")
    op.drop_column("accounts", "is_trial")
