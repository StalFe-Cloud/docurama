"""add verification channels, phone, and otp state to recipients

Signers can be required to complete an identity challenge before accessing
or signing a document. This migration adds columns to track the selected
channel (email, sms, whatsapp, telegram), recipient phone number, secure
OTP hash, expiration timestamp, attempt count, and confirmation timestamp.

Revision ID: 0008_verification_channels
Revises: 0007_template_folder_unique_name
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008_verification_channels"
down_revision: Union[str, None] = "0007_template_folder_unique_name"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Widen version_num so long revision names never cause StringDataRightTruncation
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE character varying(64)")

    op.add_column(
        "recipients",
        sa.Column("verification_channel", sa.String(length=50), nullable=False, server_default="none")
    )
    op.add_column(
        "recipients",
        sa.Column("phone", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "recipients",
        sa.Column("verification_code_hash", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "recipients",
        sa.Column("verification_code_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "recipients",
        sa.Column("verification_attempts", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "recipients",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("recipients", "verified_at")
    op.drop_column("recipients", "verification_attempts")
    op.drop_column("recipients", "verification_code_expires_at")
    op.drop_column("recipients", "verification_code_hash")
    op.drop_column("recipients", "phone")
    op.drop_column("recipients", "verification_channel")
