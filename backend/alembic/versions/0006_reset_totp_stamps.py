"""password reset tokens, TOTP enrolment, saved stamps, workspace soft-delete

Backs the features whose UI existed but reported success without doing anything:
password reset, two-factor authentication, and saved signature stamps. Also adds the
account soft-delete used by workspace removal, which keeps completed envelopes and
their audit trails resolvable at the verification portal.

Revision ID: 0006_reset_totp_stamps
Revises: 0005_platform_settings
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006_reset_totp_stamps"
down_revision: Union[str, None] = "0005_platform_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hashed_token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_ip", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_tokens_hashed_token", "password_reset_tokens", ["hashed_token"])

    op.create_table(
        "user_stamps",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", name="uq_user_stamp_kind"),
    )
    op.create_index("ix_user_stamps_user_id", "user_stamps", ["user_id"])

    # TOTP. Disabled by default: enrolment only flips totp_enabled once a submitted
    # code verifies, so an interrupted setup cannot lock anyone out.
    op.add_column("users", sa.Column("totp_secret_encrypted", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("totp_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("totp_recovery_codes", sa.JSON(), nullable=True))

    # Workspace removal detaches the account rather than dropping the row: envelopes
    # reference it, and their verification codes must keep resolving afterwards.
    op.add_column("accounts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_accounts_deleted_at", "accounts", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_accounts_deleted_at", table_name="accounts")
    op.drop_column("accounts", "deleted_at")

    for column in ("totp_recovery_codes", "totp_confirmed_at", "totp_enabled", "totp_secret_encrypted"):
        op.drop_column("users", column)

    op.drop_index("ix_user_stamps_user_id", table_name="user_stamps")
    op.drop_table("user_stamps")

    op.drop_index("ix_password_reset_tokens_hashed_token", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
