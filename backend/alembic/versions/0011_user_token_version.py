"""add per-user token_version for stateless session revocation

Session JWTs were purely stateless: they lived out their full TTL (7 days)
across password changes, TOTP disables and sign-outs. Users now carry an
integer version that is embedded in every session token at mint time and
checked on every authenticated request; the credential-rotation endpoints
bump it, which instantly orphans every token issued before the bump.

Revision ID: 0011_user_token_version
Revises: 0010_trial_and_premium_tiers
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011_user_token_version"
down_revision: Union[str, None] = "0010_trial_and_premium_tiers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
