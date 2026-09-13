"""record the real cryptographic seal outcome on each envelope

Previously the verification portal asserted PAdES-LTV regardless of what had
actually been applied. These columns persist what the signing run genuinely
achieved so that verification can report observed facts.

Revision ID: 0002_envelope_seal_state
Revises: 0001_baseline
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_envelope_seal_state"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("envelopes", sa.Column("seal_status", sa.String(length=20), nullable=True))
    op.add_column("envelopes", sa.Column("seal_details", sa.JSON(), nullable=True))
    op.create_index("ix_envelopes_seal_status", "envelopes", ["seal_status"], unique=False)

    # Envelopes completed before this migration have an unknown seal outcome. They are
    # left as 'pending' rather than backfilled to 'sealed', because claiming a seal that
    # was never verified is the exact defect this column exists to prevent.
    op.execute("UPDATE envelopes SET seal_status = 'pending' WHERE seal_status IS NULL")


def downgrade() -> None:
    op.drop_index("ix_envelopes_seal_status", table_name="envelopes")
    op.drop_column("envelopes", "seal_details")
    op.drop_column("envelopes", "seal_status")
