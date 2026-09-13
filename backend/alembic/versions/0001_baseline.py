"""baseline schema

Frozen snapshot of the Docurama schema as of the introduction of Alembic. It
replaces the previous Base.metadata.create_all() call plus the ad-hoc ALTER TABLE
statements that ran on every application start.

An already-deployed database is stamped with this revision rather than running it;
see backend/entrypoint.sh.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'accounts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('subdomain', sa.String(length=100), nullable=True),
        sa.Column('timezone', sa.String(length=100), nullable=True),
        sa.Column('enforce_domain_auth', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_accounts_subdomain', 'accounts', ['subdomain'], unique=True)

    op.create_table(
        'domain_verifications',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('verification_token', sa.String(length=128), nullable=False),
        sa.Column('verification_method', sa.String(length=50), nullable=True),
        sa.Column('txt_record_host', sa.String(length=255), nullable=False),
        sa.Column('txt_record_value', sa.String(length=255), nullable=False),
        sa.Column('cname_record_host', sa.String(length=255), nullable=False),
        sa.Column('cname_target', sa.String(length=255), nullable=False),
        sa.Column('web_confirmation_url', sa.String(length=500), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dns_check_details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_domain_verifications_domain', 'domain_verifications', ['domain'], unique=True)
    op.create_index('ix_domain_verifications_status', 'domain_verifications', ['status'], unique=False)
    op.create_index('ix_domain_verifications_verification_token', 'domain_verifications', ['verification_token'], unique=True)

    op.create_table(
        'template_folders',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('color', sa.String(length=50), nullable=True),
        sa.Column('parent_id', sa.String(length=36), sa.ForeignKey('template_folders.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('first_name', sa.String(length=100), nullable=True),
        sa.Column('last_name', sa.String(length=100), nullable=True),
        sa.Column('role', sa.String(length=50), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    op.create_table(
        'webhooks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('secret_token', sa.String(length=128), nullable=False),
        sa.Column('events', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'account_memberships',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'account_id', name='uq_user_account_membership'),
    )
    op.create_index('ix_account_memberships_user_id', 'account_memberships', ['user_id'], unique=False)
    op.create_index('ix_account_memberships_account_id', 'account_memberships', ['account_id'], unique=False)

    op.create_table(
        'envelopes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=True),
        sa.Column('created_by_user_id', sa.String(length=36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('original_pdf_path', sa.String(length=500), nullable=False),
        sa.Column('signed_pdf_path', sa.String(length=500), nullable=True),
        sa.Column('certificate_pdf_path', sa.String(length=500), nullable=True),
        sa.Column('sha256_original', sa.String(length=64), nullable=True),
        sa.Column('sha256_signed', sa.String(length=64), nullable=True),
        sa.Column('verification_code', sa.String(length=64), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_envelopes_status', 'envelopes', ['status'], unique=False)
    op.create_index('ix_envelopes_verification_code', 'envelopes', ['verification_code'], unique=True)

    op.create_table(
        'templates',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('account_id', sa.String(length=36), sa.ForeignKey('accounts.id'), nullable=True),
        sa.Column('folder_id', sa.String(length=36), sa.ForeignKey('template_folders.id'), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('pdf_path', sa.String(length=500), nullable=True),
        sa.Column('fields_data', sa.JSON(), nullable=True),
        sa.Column('roles_data', sa.JSON(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('is_public_shared', sa.Boolean(), nullable=True),
        sa.Column('public_slug', sa.String(length=100), nullable=True),
        sa.Column('reminder_interval_days', sa.Integer(), nullable=True),
        sa.Column('max_reminders', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_templates_public_slug', 'templates', ['public_slug'], unique=True)

    op.create_table(
        'webhook_deliveries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('webhook_id', sa.String(length=36), sa.ForeignKey('webhooks.id'), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('response_status', sa.Integer(), nullable=True),
        sa.Column('response_body', sa.Text(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=True),
        sa.Column('is_success', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'audit_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('envelope_id', sa.String(length=36), sa.ForeignKey('envelopes.id'), nullable=False),
        sa.Column('event_type', sa.String(length=50), nullable=False),
        sa.Column('actor_name', sa.String(length=255), nullable=False),
        sa.Column('actor_email', sa.String(length=255), nullable=True),
        sa.Column('ip_address', sa.String(length=100), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('hash_state', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'recipients',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('envelope_id', sa.String(length=36), sa.ForeignKey('envelopes.id'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=True),
        sa.Column('routing_order', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('signing_token', sa.String(length=128), nullable=False),
        sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('declined_reason', sa.Text(), nullable=True),
        sa.Column('delegated_to_email', sa.String(length=255), nullable=True),
        sa.Column('delegated_to_name', sa.String(length=255), nullable=True),
        sa.Column('delegated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reminders_sent_count', sa.Integer(), nullable=True),
        sa.Column('last_reminded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_recipients_signing_token', 'recipients', ['signing_token'], unique=True)

    op.create_table(
        'fields',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('envelope_id', sa.String(length=36), sa.ForeignKey('envelopes.id'), nullable=False),
        sa.Column('recipient_id', sa.String(length=36), sa.ForeignKey('recipients.id'), nullable=True),
        sa.Column('field_type', sa.String(length=50), nullable=False),
        sa.Column('page_number', sa.Integer(), nullable=True),
        sa.Column('x', sa.Float(), nullable=True),
        sa.Column('y', sa.Float(), nullable=True),
        sa.Column('width', sa.Float(), nullable=True),
        sa.Column('height', sa.Float(), nullable=True),
        sa.Column('required', sa.Boolean(), nullable=True),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('placeholder', sa.String(length=255), nullable=True),
        sa.Column('validation_regex', sa.String(length=255), nullable=True),
        sa.Column('options', sa.JSON(), nullable=True),
        sa.Column('value', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'signatures',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('envelope_id', sa.String(length=36), sa.ForeignKey('envelopes.id'), nullable=False),
        sa.Column('recipient_id', sa.String(length=36), sa.ForeignKey('recipients.id'), nullable=False),
        sa.Column('signature_type', sa.String(length=50), nullable=True),
        sa.Column('signature_data', sa.Text(), nullable=False),
        sa.Column('signer_name', sa.String(length=255), nullable=False),
        sa.Column('ip_address', sa.String(length=100), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'correction_requests',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('envelope_id', sa.String(length=36), sa.ForeignKey('envelopes.id'), nullable=False),
        sa.Column('submitter_id', sa.String(length=36), sa.ForeignKey('recipients.id'), nullable=False),
        sa.Column('field_id', sa.String(length=36), sa.ForeignKey('fields.id'), nullable=True),
        sa.Column('clause_title', sa.String(length=255), nullable=True),
        sa.Column('suggested_correction', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('correction_requests')
    op.drop_table('signatures')
    op.drop_table('fields')
    op.drop_index('ix_recipients_signing_token', table_name='recipients')
    op.drop_table('recipients')
    op.drop_table('audit_events')
    op.drop_table('webhook_deliveries')
    op.drop_index('ix_templates_public_slug', table_name='templates')
    op.drop_table('templates')
    op.drop_index('ix_envelopes_status', table_name='envelopes')
    op.drop_index('ix_envelopes_verification_code', table_name='envelopes')
    op.drop_table('envelopes')
    op.drop_index('ix_account_memberships_user_id', table_name='account_memberships')
    op.drop_index('ix_account_memberships_account_id', table_name='account_memberships')
    op.drop_table('account_memberships')
    op.drop_table('webhooks')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
    op.drop_table('template_folders')
    op.drop_index('ix_domain_verifications_domain', table_name='domain_verifications')
    op.drop_index('ix_domain_verifications_status', table_name='domain_verifications')
    op.drop_index('ix_domain_verifications_verification_token', table_name='domain_verifications')
    op.drop_table('domain_verifications')
    op.drop_index('ix_accounts_subdomain', table_name='accounts')
    op.drop_table('accounts')
