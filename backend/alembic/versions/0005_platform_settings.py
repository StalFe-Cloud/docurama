"""platform-wide settings and the platform administrator flag

SMTP configuration moves out of environment variables and into the product, so a
deployment needs somewhere to hold the default profile that tenants without their own
fall back to, and a way to say who may edit it.

Revision ID: 0005_platform_settings
Revises: 0004_settings_persistence
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_platform_settings"
down_revision: Union[str, None] = "0004_settings_persistence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_settings_section", "platform_settings", ["section"], unique=True)

    op.add_column("users", sa.Column("is_platform_admin", sa.Boolean(), nullable=True))
    op.execute("UPDATE users SET is_platform_admin = FALSE WHERE is_platform_admin IS NULL")

    # Promote the earliest account's owner, so an existing deployment has someone able to
    # configure the platform default without a manual database edit. Granting it to every
    # admin would hand deployment-wide control to every tenant administrator.
    op.execute(
        """
        UPDATE users SET is_platform_admin = TRUE
        WHERE id = (
            SELECT u.id FROM users u
            JOIN accounts a ON a.id = u.account_id
            ORDER BY a.created_at ASC, u.created_at ASC
            LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_column("users", "is_platform_admin")
    op.drop_index("ix_platform_settings_section", table_name="platform_settings")
    op.drop_table("platform_settings")
