"""add hot-path indexes

Every tenant listing filtered envelopes by account_id with no index; every
signing session walked recipients/fields by envelope_id with no index; the
public verify-by-upload path did full scans on the sha256 columns. These
indexes ship as data-free DDL, so they are safe to add online on any size of
database.

Revision ID: 0012_hot_path_indexes
Revises: 0011_user_token_version
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012_hot_path_indexes"
down_revision: Union[str, None] = "0011_user_token_version"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (index name, table, columns)
_INDEXES = [
    ("ix_envelopes_account_id", "envelopes", ["account_id"]),
    ("ix_envelopes_account_status", "envelopes", ["account_id", "status"]),
    ("ix_envelopes_sha256_original", "envelopes", ["sha256_original"]),
    ("ix_envelopes_sha256_signed", "envelopes", ["sha256_signed"]),
    ("ix_recipients_envelope_id", "recipients", ["envelope_id"]),
    ("ix_fields_envelope_id", "fields", ["envelope_id"]),
    ("ix_audit_events_envelope_id", "audit_events", ["envelope_id"]),
    ("ix_signatures_envelope_id", "signatures", ["envelope_id"]),
    ("ix_signatures_recipient_id", "signatures", ["recipient_id"]),
    ("ix_webhook_deliveries_webhook_id", "webhook_deliveries", ["webhook_id"]),
    ("ix_templates_account_id", "templates", ["account_id"]),
    ("ix_domain_verifications_account_id", "domain_verifications", ["account_id"]),
]


def upgrade() -> None:
    for name, table, columns in _INDEXES:
        op.create_index(name, table, columns, unique=False)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
