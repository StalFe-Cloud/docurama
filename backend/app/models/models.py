import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.core.database import Base

def utcnow():
    return datetime.now(timezone.utc)

def gen_uuid():
    return str(uuid.uuid4())

class Account(Base):
    __tablename__ = "accounts"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(255), nullable=False, default="Default Account")
    subdomain = Column(String(100), unique=True, nullable=True)
    timezone = Column(String(100), default="(GMT+00:00) UTC")
    enforce_domain_auth = Column(Boolean, default=False)
    # Subscription Plan, Trial, and Quotas
    plan = Column(String(32), nullable=False, default="plus")
    is_trial = Column(Boolean, default=False, nullable=False)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    billing_interval = Column(String(16), default="monthly", nullable=False)
    stripe_customer_id = Column(String(64), nullable=True)
    stripe_subscription_id = Column(String(64), nullable=True)
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    custom_envelope_limit = Column(Integer, nullable=True)
    custom_seat_limit = Column(Integer, nullable=True)
    billing_cycle_anchor = Column(DateTime(timezone=True), nullable=True)

    # Set when a workspace is removed. The row survives because envelopes reference it
    # and their verification codes must keep resolving.
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    users = relationship("User", back_populates="account", cascade="all, delete-orphan")
    memberships = relationship("AccountMembership", back_populates="account", cascade="all, delete-orphan")
    envelopes = relationship("Envelope", back_populates="account", cascade="all, delete-orphan")
    templates = relationship("Template", back_populates="account", cascade="all, delete-orphan")
    template_folders = relationship("TemplateFolder", back_populates="account", cascade="all, delete-orphan")
    domain_verifications = relationship("DomainVerification", back_populates="account", cascade="all, delete-orphan")
    webhooks = relationship("Webhook", back_populates="account", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="account", cascade="all, delete-orphan")
    signing_certificates = relationship("SigningCertificate", back_populates="account", cascade="all, delete-orphan")
    settings = relationship("AccountSetting", back_populates="account", cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=True, default="")
    last_name = Column(String(100), nullable=True, default="")
    role = Column(String(50), default="admin")  # admin, manager, member
    is_active = Column(Boolean, default=True)
    # Deployment-wide administration, distinct from company roles. Gates the platform
    # settings that every tenant falls back to, such as the default mail server.
    is_platform_admin = Column(Boolean, default=False)

    # Two-factor authentication. The secret is encrypted at rest with the same Fernet
    # helper used for mail passwords. totp_enabled is set only after a submitted code
    # verifies, so generating a secret cannot lock anyone out of their own account.
    totp_secret_encrypted = Column(Text, nullable=True)
    totp_enabled = Column(Boolean, default=False, nullable=False)
    totp_confirmed_at = Column(DateTime(timezone=True), nullable=True)
    # Hashed, single-use. Without these a lost device is a lost account, because a
    # password reset alone does not clear a second factor.
    totp_recovery_codes = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="users")
    memberships = relationship("AccountMembership", back_populates="user", cascade="all, delete-orphan")
    envelopes = relationship("Envelope", back_populates="creator")

class AccountMembership(Base):
    __tablename__ = "account_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_user_account_membership"),
    )
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), default="member")  # owner, admin, manager, member
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    user = relationship("User", back_populates="memberships")
    account = relationship("Account", back_populates="memberships")

class TemplateFolder(Base):
    __tablename__ = "template_folders"
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_template_folder_account_name"),
    )

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    name = Column(String(255), nullable=False)
    color = Column(String(50), default="#4f46e5")
    parent_id = Column(String(36), ForeignKey("template_folders.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    account = relationship("Account", back_populates="template_folders")
    templates = relationship("Template", back_populates="folder")

class Template(Base):
    __tablename__ = "templates"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    folder_id = Column(String(36), ForeignKey("template_folders.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    pdf_path = Column(String(500), nullable=True)
    fields_data = Column(JSON, default=list)  # list of field definitions
    roles_data = Column(JSON, default=list)   # list of role definitions
    tags = Column(JSON, default=list)         # list of strings
    
    is_public_shared = Column(Boolean, default=False)
    public_slug = Column(String(100), unique=True, index=True, nullable=True)
    reminder_interval_days = Column(Integer, default=3)
    max_reminders = Column(Integer, default=3)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="templates")
    folder = relationship("TemplateFolder", back_populates="templates")

class Envelope(Base):
    __tablename__ = "envelopes"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    created_by_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    title = Column(String(255), nullable=False)
    # Statuses: draft, sent, delivered, signed, completed, voided, declined
    status = Column(String(50), default="draft", index=True)
    
    original_pdf_path = Column(String(500), nullable=False)
    signed_pdf_path = Column(String(500), nullable=True)
    certificate_pdf_path = Column(String(500), nullable=True)
    
    sha256_original = Column(String(64), nullable=True)
    sha256_signed = Column(String(64), nullable=True)
    verification_code = Column(String(64), unique=True, index=True, default=gen_uuid)

    # Cryptographic seal outcome, recorded at completion time. The verification
    # portal reads these instead of asserting that a seal was applied.
    # Statuses: pending, sealed, unsealed
    seal_status = Column(String(20), default="pending", index=True)
    seal_details = Column(JSON, default=dict)
    
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="envelopes")
    creator = relationship("User", back_populates="envelopes")
    recipients = relationship("Recipient", back_populates="envelope", cascade="all, delete-orphan", order_by="Recipient.routing_order")
    fields = relationship("Field", back_populates="envelope", cascade="all, delete-orphan")
    audit_events = relationship("AuditEvent", back_populates="envelope", cascade="all, delete-orphan", order_by="AuditEvent.created_at")

class Recipient(Base):
    __tablename__ = "recipients"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    # Roles: signer, viewer, approver
    role = Column(String(50), default="signer")
    routing_order = Column(Integer, default=1)
    # Statuses: waiting, sent, opened, signed, declined, delegated
    status = Column(String(50), default="waiting")
    signing_token = Column(String(128), unique=True, index=True, nullable=False)
    # Signing links expire so an unused invitation cannot be redeemed indefinitely.
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    signed_at = Column(DateTime(timezone=True), nullable=True)
    
    declined_reason = Column(Text, nullable=True)
    delegated_to_email = Column(String(255), nullable=True)
    delegated_to_name = Column(String(255), nullable=True)
    delegated_at = Column(DateTime(timezone=True), nullable=True)
    reminders_sent_count = Column(Integer, default=0)
    last_reminded_at = Column(DateTime(timezone=True), nullable=True)

    # Signer identity verification: none, email_otp, sms_otp, whatsapp_otp, telegram_otp
    verification_channel = Column(String(50), default="none", nullable=False)
    phone = Column(String(50), nullable=True)
    verification_code_hash = Column(String(255), nullable=True)
    verification_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    verification_attempts = Column(Integer, default=0, nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    envelope = relationship("Envelope", back_populates="recipients")
    fields = relationship("Field", back_populates="recipient")
    signatures = relationship("Signature", back_populates="recipient")

class Field(Base):
    __tablename__ = "fields"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    recipient_id = Column(String(36), ForeignKey("recipients.id"), nullable=True)
    # Types: signature, initials, date, text, number, checkbox, radio, dropdown, file
    field_type = Column(String(50), nullable=False)
    page_number = Column(Integer, default=1)
    x = Column(Float, default=0.0)      # Percentage 0-100 or points
    y = Column(Float, default=0.0)      # Percentage 0-100 or points
    width = Column(Float, default=150.0)
    height = Column(Float, default=50.0)
    required = Column(Boolean, default=True)
    label = Column(String(255), nullable=True)
    placeholder = Column(String(255), nullable=True)
    validation_regex = Column(String(255), nullable=True)
    options = Column(JSON, default=list)  # For dropdown/radio
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    envelope = relationship("Envelope", back_populates="fields")
    recipient = relationship("Recipient", back_populates="fields")

class Signature(Base):
    __tablename__ = "signatures"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    recipient_id = Column(String(36), ForeignKey("recipients.id"), nullable=False)
    signature_type = Column(String(50), default="draw")  # draw, type, upload, mobile
    signature_data = Column(Text, nullable=False)        # base64 data URL
    signer_name = Column(String(255), nullable=False)
    ip_address = Column(String(100), nullable=True)
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    recipient = relationship("Recipient", back_populates="signatures")

class AuditEvent(Base):
    __tablename__ = "audit_events"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    # Events: created, sent, opened, mobile_handshake, signed, completed, voided, declined, delegated, reminder_sent
    event_type = Column(String(50), nullable=False)
    actor_name = Column(String(255), nullable=False, default="System")
    actor_email = Column(String(255), nullable=True)
    ip_address = Column(String(100), nullable=True)
    user_agent = Column(String(500), nullable=True)
    description = Column(Text, nullable=False)
    hash_state = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    envelope = relationship("Envelope", back_populates="audit_events")

class DomainVerification(Base):
    __tablename__ = "domain_verifications"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    domain = Column(String(255), unique=True, index=True, nullable=False)
    status = Column(String(50), default="pending", index=True)
    verification_token = Column(String(128), unique=True, nullable=False)
    verification_method = Column(String(50), default="dns_txt")
    
    txt_record_host = Column(String(255), nullable=False)
    txt_record_value = Column(String(255), nullable=False)
    cname_record_host = Column(String(255), nullable=False)
    cname_target = Column(String(255), nullable=False, default="")  # set from settings.CNAME_TARGET
    web_confirmation_url = Column(String(500), nullable=True)
    
    verified_at = Column(DateTime(timezone=True), nullable=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    dns_check_details = Column(JSON, default=dict)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="domain_verifications")

class Webhook(Base):
    __tablename__ = "webhooks"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    url = Column(String(500), nullable=False)
    secret_token = Column(String(128), nullable=False, default=gen_uuid)
    events = Column(JSON, default=list)  # ["envelope.created", "envelope.completed", "recipient.signed"]
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="webhooks")
    deliveries = relationship("WebhookDelivery", back_populates="webhook", cascade="all, delete-orphan", order_by="WebhookDelivery.created_at.desc()")

class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    webhook_id = Column(String(36), ForeignKey("webhooks.id"), nullable=False)
    event_type = Column(String(50), nullable=False)
    payload = Column(JSON, nullable=False)
    response_status = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    attempts = Column(Integer, default=1)
    is_success = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    webhook = relationship("Webhook", back_populates="deliveries")

class CorrectionRequest(Base):
    __tablename__ = "correction_requests"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    submitter_id = Column(String(36), ForeignKey("recipients.id"), nullable=False)
    field_id = Column(String(36), ForeignKey("fields.id"), nullable=True)
    
    clause_title = Column(String(255), nullable=True)
    suggested_correction = Column(Text, nullable=False)
    status = Column(String(50), default="open")  # open, resolved, rejected
    resolution_notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    envelope = relationship("Envelope", backref="correction_requests")
    submitter = relationship("Recipient", backref="correction_requests")
    field = relationship("Field", backref="correction_requests")

class ApiKey(Base):
    """
    Account-scoped API credential. Only the hash is stored, so a leaked database
    row cannot be replayed as a key; the plaintext is shown once at creation.
    """
    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    name = Column(String(255), nullable=False, default="API Key")
    # Displayed in the UI so a key can be recognised without revealing it.
    key_prefix = Column(String(16), nullable=False, index=True)
    hashed_key = Column(String(255), nullable=False)
    scopes = Column(JSON, default=list)  # ["read", "write"]

    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    account = relationship("Account", back_populates="api_keys")

class SigningCertificate(Base):
    """
    Metadata for a PKCS#12 signing certificate available to an account. The key
    material itself stays on disk and is never held in the database.
    """
    __tablename__ = "signing_certificates"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)

    label = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=True)
    issuer = Column(String(500), nullable=True)
    serial_number = Column(String(128), nullable=True)
    fingerprint_sha256 = Column(String(64), nullable=True)

    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_until = Column(DateTime(timezone=True), nullable=True)
    is_default = Column(Boolean, default=False)
    # Statuses: active, expired, revoked
    status = Column(String(50), default="active", index=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    account = relationship("Account", back_populates="signing_certificates")

class AccountSetting(Base):
    """
    Per-account settings for one UI section (notifications, sms, mcp, branding).
    A row per section keeps unrelated settings from contending on write.
    """
    __tablename__ = "account_settings"
    __table_args__ = (
        UniqueConstraint("account_id", "section", name="uq_account_setting_section"),
    )

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    section = Column(String(50), nullable=False, index=True)
    data = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    account = relationship("Account", back_populates="settings")


class PlatformSetting(Base):
    """
    Deployment-wide settings, for values that belong to the installation rather than
    to any one tenant. An account with no profile of its own falls back to these, which
    is what lets a new customer send mail without first standing up a mail server.

    Same shape as AccountSetting deliberately: one row per section, so unrelated
    settings do not contend on write.
    """
    __tablename__ = "platform_settings"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    section = Column(String(50), unique=True, nullable=False, index=True)
    data = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class PasswordResetToken(Base):
    """
    A single-use, time-limited token for recovering an account by email.

    Only the hash is stored, following the API key pattern: a leaked database row
    cannot be replayed as a reset link. The plaintext exists solely in the email.
    """
    __tablename__ = "password_reset_tokens"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    hashed_token = Column(String(255), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Set the moment the token is redeemed, so a link cannot be used twice even
    # within its validity window.
    used_at = Column(DateTime(timezone=True), nullable=True)

    requested_ip = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", backref="password_reset_tokens")

class UserStamp(Base):
    """
    A saved signature or initials image, reused at signing time.

    The image lives on the storage volume like every other document artefact; only
    its path is held here.
    """
    __tablename__ = "user_stamps"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", name="uq_user_stamp_kind"),
    )

    id = Column(String(36), primary_key=True, default=gen_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # signature or initials
    kind = Column(String(20), nullable=False)
    file_path = Column(String(500), nullable=False)
    content_type = Column(String(50), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", backref="stamps")
