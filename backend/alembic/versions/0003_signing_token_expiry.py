"""expire signing links

Signing tokens previously never expired, so an invitation link remained redeemable
forever. Existing recipients are given an expiry measured from their creation date.

Revision ID: 0003_signing_token_expiry
Revises: 0002_envelope_seal_state
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_signing_token_expiry"
down_revision: Union[str, None] = "0002_envelope_seal_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_TTL_DAYS = 90


def upgrade() -> None:
    op.add_column("recipients", sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True))
    # Backfill from creation date so links already in circulation acquire an expiry
    # rather than remaining valid forever.
    op.execute(
        f"UPDATE recipients SET token_expires_at = created_at + INTERVAL '{DEFAULT_TTL_DAYS} days' "
        "WHERE token_expires_at IS NULL AND created_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("recipients", "token_expires_at")
