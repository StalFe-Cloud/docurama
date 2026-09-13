"""persist settings that were previously frontend-only state

The settings screen rendered API keys, signing certificates, notification and SMS
preferences from hardcoded arrays in the React component, so nothing survived a
reload. These tables give those sections real storage.

Revision ID: 0004_settings_persistence
Revises: 0003_signing_token_expiry
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_settings_persistence"
down_revision: Union[str, None] = "0003_signing_token_expiry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("key_prefix", sa.String(length=16), nullable=False),
        sa.Column("hashed_key", sa.String(length=255), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_keys_account_id", "api_keys", ["account_id"], unique=False)
    op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"], unique=False)

    op.create_table(
        "signing_certificates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("issuer", sa.String(length=500), nullable=True),
        sa.Column("serial_number", sa.String(length=128), nullable=True),
        sa.Column("fingerprint_sha256", sa.String(length=64), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signing_certificates_account_id", "signing_certificates", ["account_id"], unique=False)
    op.create_index("ix_signing_certificates_status", "signing_certificates", ["status"], unique=False)

    op.create_table(
        "account_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "section", name="uq_account_setting_section"),
    )
    op.create_index("ix_account_settings_account_id", "account_settings", ["account_id"], unique=False)
    op.create_index("ix_account_settings_section", "account_settings", ["section"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_account_settings_section", table_name="account_settings")
    op.drop_index("ix_account_settings_account_id", table_name="account_settings")
    op.drop_table("account_settings")
    op.drop_index("ix_signing_certificates_status", table_name="signing_certificates")
    op.drop_index("ix_signing_certificates_account_id", table_name="signing_certificates")
    op.drop_table("signing_certificates")
    op.drop_index("ix_api_keys_key_prefix", table_name="api_keys")
    op.drop_index("ix_api_keys_account_id", table_name="api_keys")
    op.drop_table("api_keys")
