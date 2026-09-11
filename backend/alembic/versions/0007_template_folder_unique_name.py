"""deduplicate template folder names per account, then enforce uniqueness

Folder names only group templates, so duplicate names inside one workspace carry
no evidence: the oldest folder in each (account_id, name) pair survives and later
duplicates are deleted before the unique constraint lands.

Revision ID: 0007_template_folder_unique_name
Revises: 0006_reset_totp_stamps
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0007_template_folder_unique_name"
down_revision: Union[str, None] = "0006_reset_totp_stamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Keep the oldest folder per (account_id, name); reassign nothing - later
    # duplicates are deleted, which is safe because folders only group templates.
    # a.id > b.id breaks ties when created_at is identical.
    op.execute(
        """
        DELETE FROM template_folders a
        USING template_folders b
        WHERE a.account_id = b.account_id
          AND a.name = b.name
          AND (a.created_at > b.created_at
               OR (a.created_at = b.created_at AND a.id > b.id))
        """
    )
    op.create_unique_constraint(
        "uq_template_folder_account_name", "template_folders",
        ["account_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_template_folder_account_name", "template_folders",
                       type_="unique")
