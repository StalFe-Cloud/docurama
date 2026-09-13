"""add account plans, expiration, and quota limits

Allows multi-tenant and cloud accounts to subscribe to plans (free, pro,
business, enterprise) and enforce envelope and seat limits per billing cycle.
Self-host deployments default to unlimited or unconstrained usage.

Revision ID: 0009_account_plans_and_quotas
Revises: 0008_verification_channels
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009_account_plans_and_quotas"
down_revision: Union[str, None] = "0008_verification_channels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("plan", sa.String(length=32), nullable=False, server_default="free")
    )
    op.add_column(
        "accounts",
        sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column("custom_envelope_limit", sa.Integer(), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column("custom_seat_limit", sa.Integer(), nullable=True)
    )
    op.add_column(
        "accounts",
        sa.Column("billing_cycle_anchor", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("accounts", "billing_cycle_anchor")
    op.drop_column("accounts", "custom_seat_limit")
    op.drop_column("accounts", "custom_envelope_limit")
    op.drop_column("accounts", "plan_expires_at")
    op.drop_column("accounts", "plan")
