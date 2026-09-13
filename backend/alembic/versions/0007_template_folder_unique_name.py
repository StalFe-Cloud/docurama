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
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        dedupe = """
        DELETE FROM template_folders a
        USING template_folders b
        WHERE a.account_id = b.account_id
          AND a.name = b.name
          AND (a.created_at > b.created_at
               OR (a.created_at = b.created_at AND a.id > b.id))
        """
    else:
        # Portable self-join form (SQLite, MySQL): subquery selects the
        # duplicates, the outer DELETE removes them.
        dedupe = """
        DELETE FROM template_folders WHERE id IN (
            SELECT a.id FROM template_folders a
            JOIN template_folders b
              ON a.account_id = b.account_id
             AND a.name = b.name
             AND (a.created_at > b.created_at
                  OR (a.created_at = b.created_at AND a.id > b.id))
        )
        """
    op.execute(dedupe)
    if bind.dialect.name == "sqlite":
        # SQLite cannot ALTER TABLE ... ADD CONSTRAINT; batch mode recreates
        # the table with the constraint declared inline.
        with op.batch_alter_table("template_folders") as batch_op:
            batch_op.create_unique_constraint(
                "uq_template_folder_account_name", ["account_id", "name"],
            )
    else:
        op.create_unique_constraint(
            "uq_template_folder_account_name", "template_folders",
            ["account_id", "name"],
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("template_folders") as batch_op:
            batch_op.drop_constraint("uq_template_folder_account_name")
    else:
        op.drop_constraint("uq_template_folder_account_name", "template_folders",
                           type_="unique")
