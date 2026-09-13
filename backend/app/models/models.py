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
    # Subscription sync (Sprint 3): the webhook is the only writer, and only
    # after signature verification. cancel_at_period_end records click parity -
    # the customer keeps the paid plan until current_period_end.
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, default=False, nullable=False)

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
    # Stateless-session revocation. Session JWTs carry the value at mint time and
    # get_current_user refuses any token whose version no longer matches, so a
    # password change, a TOTP disable or an explicit sign-out kills every token
    # issued before it without needing a server-side denylist.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")
    # Marketing consent (GDPR Art. 7): recorded with its timestamp at
    # registration, never assumed. Absence of a row value means no consent.
    marketing_consent = Column(Boolean, default=False, nullable=False)
    marketing_consent_at = Column(DateTime(timezone=True), nullable=True)
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
    # Tamper-evident chaining (Sprint 5): each event commits to its predecessor
    # within the same envelope. Nullable so historical rows stay valid; the
    # flush listener chains every new row. See app/services/audit_chain.py.
    seq = Column(Integer, nullable=True)
    prev_hash = Column(String(64), nullable=True)
    event_hash = Column(String(64), nullable=True)
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
    # Enterprise domain activation (§18): how signups on this domain join the
    # workspace. 'none' (default) means registration is untouched; only a
    # verified domain may carry a join mode.
    join_mode = Column(String(20), default="none", nullable=False)
    
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


class LegalNotice(Base):
    """
    Public legal intake: DMCA notices and TAKE IT DOWN requests.

    The sworn statements are stored verbatim because they are the legal
    instrument. reporter_ip is stored for abuse-pattern detection and is
    surfaced only through the platform-admin queue.
    """
    __tablename__ = "legal_notices"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    kind = Column(String(20), nullable=False, default="dmca")  # dmca | take_it_down
    status = Column(String(20), nullable=False, default="pending", index=True)
    sla = Column(String(40), nullable=False, default="")
    reporter_name = Column(String(255), nullable=False)
    reporter_email = Column(String(255), nullable=False)
    reporter_company = Column(String(255), nullable=True, default="")
    content_location = Column(String(1000), nullable=False)
    original_work_reference = Column(String(2000), nullable=False)
    description = Column(Text, nullable=False)
    reporter_ip = Column(String(100), nullable=True)
    resolution = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class MarketingUnsubscribe(Base):
    """
    Suppression list for outbound marketing email (§17).

    A marketing send that is not checked against this table is a CAN-SPAM
    violation waiting to happen; transactional mail (signing links, security
    notices) is deliberately out of scope here and must never be suppressed.
    """
    __tablename__ = "marketing_unsubscribes"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    reason = Column(String(50), nullable=False, default="user_request")
    source = Column(String(100), nullable=True, default="")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class EmailSendLog(Base):
    """
    Accountability record for outbound email (§17).

    Stores metadata only - never bodies or secrets - so a deliverability
    question ('did the invitation actually go out?') has a factual answer.
    """
    __tablename__ = "email_send_logs"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    kind = Column(String(50), nullable=False)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=True, default="")
    status = Column(String(20), nullable=False, default="sent")  # sent | failed | suppressed
    error = Column(String(500), nullable=True, default="")
    related_id = Column(String(36), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


class DomainJoinRequest(Base):
    """
    Enterprise domain-activation approval queue (§18).

    In approval mode, an activated signup waits here until a workspace admin
    approves; only then do they become a member. The row is the audit trail of
    who joined the tenant through the domain and who decided what.
    """
    __tablename__ = "domain_join_requests"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    domain_id = Column(String(36), ForeignKey("domain_verifications.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    user_email = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending | approved | rejected
    decided_by = Column(String(255), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# Compliance & Trust Foundation (Sprint 5)
#
# These tables implement the controls of the enterprise compliance program:
# a hash-chained security event ledger, DSAR request tracking with the five
# honest states, consent records, configurable retention with legal holds,
# security incident response with the 72-hour GDPR clock, a subprocessor
# registry, a control/evidence catalog, and access reviews. Every readiness
# statement made anywhere about these controls uses the vocabulary
# Implemented / Partial / Missing / Needs Review — never "certified".
# ---------------------------------------------------------------------------

class SecurityEvent(Base):
    """Platform-level, hash-chained audit ledger.

    Unlike envelope-scoped AuditEvents, this ledger records authentication,
    administrative, privacy and operational events. Each row commits to its
    predecessor via prev_hash/event_hash, so deletion or mutation of any row
    is detectable by POST-free verification (GET /api/admin/audit/verify).
    """
    __tablename__ = "security_events"

    seq = Column(Integer, nullable=False, unique=True, index=True)
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), nullable=True, index=True)
    actor_user_id = Column(String(36), nullable=True)
    actor_email = Column(String(255), nullable=True)
    # Types: login_success, login_failed, logout, password_changed,
    # password_reset_requested, totp_enabled, totp_disabled, api_key_created,
    # api_key_revoked, dsar_created, dsar_completed, dsar_failed,
    # consent_recorded, consent_revoked, retention_deleted, legal_hold_added,
    # legal_hold_released, incident_recorded, incident_updated,
    # subprocessor_recorded, access_review_recorded, control_reviewed
    event_type = Column(String(50), nullable=False, index=True)
    # info | warning | critical
    severity = Column(String(20), nullable=False, default="info")
    ip_address = Column(String(100), nullable=True)
    user_agent = Column(String(500), nullable=True)
    description = Column(Text, nullable=False)
    detail = Column(JSON, default=dict)
    prev_hash = Column(String(64), nullable=False)
    event_hash = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), nullable=False)


class DsarRequest(Base):
    """A data-subject request (export or erasure) with an honest lifecycle.

    States: queued -> processing -> completed | failed, with queued ->
    cancelled also allowed. Nothing may jump to completed without the work
    actually having been done; failures carry a machine-readable reason.
    """
    __tablename__ = "dsar_requests"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    subject_email = Column(String(255), nullable=False, index=True)
    # export | delete
    kind = Column(String(20), nullable=False)
    # queued | processing | completed | failed | cancelled
    state = Column(String(20), nullable=False, default="queued", index=True)
    requested_by_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    failure_reason = Column(Text, nullable=True)
    result_ref = Column(String(500), nullable=True)
    result_summary = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)


class ConsentRecord(Base):
    """A ledger row for a data subject's consent to a named purpose."""
    __tablename__ = "consent_records"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    subject_email = Column(String(255), nullable=False, index=True)
    purpose = Column(String(100), nullable=False)
    granted = Column(Boolean, nullable=False, default=True)
    granted_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    evidence_ref = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class LegalHold(Base):
    """A hold that suspends retention-driven deletion for a scope."""
    __tablename__ = "legal_holds"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    reason = Column(Text, nullable=False)
    # NULL scope means the whole workspace; otherwise only this envelope.
    scope_envelope_id = Column(String(36), nullable=True, index=True)
    created_by_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    released_at = Column(DateTime(timezone=True), nullable=True)


class RetentionPolicy(Base):
    """Configurable retention for a resource type.

    An account_id of NULL is the platform default that every workspace
    inherits until it defines its own override.
    """
    __tablename__ = "retention_policies"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True, index=True)
    # envelopes | security_events
    resource_type = Column(String(50), nullable=False)
    retention_days = Column(Integer, nullable=False)
    # delete | anonymize
    action = Column(String(20), nullable=False, default="delete")
    enabled = Column(Boolean, nullable=False, default=True)
    updated_by_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SecurityIncident(Base):
    """A security incident with the GDPR 72-hour authority-notification clock."""
    __tablename__ = "security_incidents"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    # low | medium | high | critical
    severity = Column(String(20), nullable=False, default="medium", index=True)
    # detected | contained | resolved
    status = Column(String(20), nullable=False, default="detected", index=True)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True, index=True)
    detected_at = Column(DateTime(timezone=True), nullable=False)
    contained_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    # detected_at + 72h, computed at insert; never extended.
    gdpr_notification_deadline = Column(DateTime(timezone=True), nullable=False)
    authority_notified_at = Column(DateTime(timezone=True), nullable=True)
    subjects_notified_at = Column(DateTime(timezone=True), nullable=True)
    reported_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Subprocessor(Base):
    """Registry of processors that handle platform data."""
    __tablename__ = "subprocessors"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(255), nullable=False)
    purpose = Column(String(500), nullable=False)
    data_location = Column(String(255), nullable=False, default="Operator-configured")
    # active | planned | retired
    status = Column(String(20), nullable=False, default="active", index=True)
    url = Column(String(500), nullable=True)
    added_at = Column(DateTime(timezone=True), default=utcnow)
    removed_at = Column(DateTime(timezone=True), nullable=True)


class ComplianceControl(Base):
    """One control of the compliance program with its honest readiness state."""
    __tablename__ = "compliance_controls"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    control_id = Column(String(50), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    # GDPR | ISO27001 | SOC2 | eIDAS
    framework = Column(String(50), nullable=False, index=True)
    description = Column(Text, nullable=False)
    owner_role = Column(String(100), nullable=False, default="Platform operator")
    # Implemented | Partial | Missing | Needs Review — the only legal values.
    readiness = Column(String(20), nullable=False, default="Missing")
    # quarterly | annual | continuous
    review_frequency = Column(String(20), nullable=False, default="annual")
    last_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    evidence = relationship("ControlEvidence", back_populates="control", cascade="all, delete-orphan")


class ControlEvidence(Base):
    """A pointer to real evidence for a control: code, tests, config or logs."""
    __tablename__ = "control_evidence"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    control_id_fk = Column(String(36), ForeignKey("compliance_controls.id"), nullable=False, index=True)
    # test | code | config | runbook | endpoint
    kind = Column(String(30), nullable=False, default="test")
    reference = Column(String(500), nullable=False)
    note = Column(Text, nullable=True)
    collected_at = Column(DateTime(timezone=True), default=utcnow)
    control = relationship("ComplianceControl", back_populates="evidence")


class AccessReview(Base):
    """A recorded periodic review of who has access to what."""
    __tablename__ = "access_reviews"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)
    reviewer_user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    reviewer_email = Column(String(255), nullable=False)
    scope = Column(String(255), nullable=False, default="platform admin + workspace owners")
    findings = Column(Text, nullable=True)
    accounts_reviewed = Column(Integer, nullable=False, default=0)
    changes_required = Column(Integer, nullable=False, default=0)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class AuditChainSeal(Base):
    """A point-in-time snapshot binding of a hash chain.

    A seal records the expected tip (last seq + hash) and row count of a
    ledger at sealing time. If a later verification walks to a different tip
    or count, rows were added, removed or rewritten after the seal.
    """
    __tablename__ = "audit_chain_seals"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    # security_events | audit_events:{envelope_id}
    scope = Column(String(100), nullable=False, index=True)
    last_seq = Column(Integer, nullable=False)
    last_event_hash = Column(String(64), nullable=False)
    event_count = Column(Integer, nullable=False)
    sealed_by = Column(String(255), nullable=False, default="system")
    sealed_at = Column(DateTime(timezone=True), default=utcnow)


class RiskRegisterEntry(Base):
    """A security/compliance risk with server-computed scores (SOC2-01).

    The register is the concrete instrument behind the risk-assessment
    control: likelihood and impact live on 1-5 scales, scores are computed
    server-side at write time (never trusted from clients), treatment follows
    one of the four standard options, and every entry carries an owner and a
    next review date so the register ages visibly instead of silently.
    """
    __tablename__ = "risk_register"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    # Stable human-facing identifier: RSK-001, RSK-002, ...
    risk_key = Column(String(50), nullable=False, unique=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    # security | privacy | availability | vendor | operational | compliance
    category = Column(String(50), nullable=False, default="security", index=True)
    # 1..5 scales; inherent/residual scores are derived, not stored blind.
    likelihood = Column(Integer, nullable=False, default=3)
    impact = Column(Integer, nullable=False, default=3)
    inherent_score = Column(Integer, nullable=False, default=9, index=True)
    # mitigate | accept | transfer | avoid
    treatment = Column(String(20), nullable=False, default="mitigate", index=True)
    treatment_notes = Column(Text, nullable=True)
    residual_likelihood = Column(Integer, nullable=False, default=2)
    residual_impact = Column(Integer, nullable=False, default=2)
    residual_score = Column(Integer, nullable=False, default=4)
    owner = Column(String(255), nullable=False, default="Platform operator")
    # open | mitigating | accepted | closed
    status = Column(String(20), nullable=False, default="open", index=True)
    # Comma-separated control IDs this risk is treated by (e.g. "ISO-04,GDPR-06").
    control_refs = Column(String(500), nullable=True)
    next_review_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    closed_at = Column(DateTime(timezone=True), nullable=True)


class RestoreDrill(Base):
    """A recorded restore drill: a backup was restored and verified (ISO-06).

    The harness (scripts/restore_drill.py) copies a backup into a scratch
    database, runs SQLite integrity checks, reconciles per-table row counts
    and re-verifies the audit hash chains on the restored copy; the resulting
    JSON report is what this row preserves as evidence. The API records the
    evidence; it cannot re-run the verification itself — that is what makes
    recording honest: the harness output travels with the record.
    """
    __tablename__ = "restore_drills"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    # Backup path or a description of the source the drill restored from.
    source = Column(String(500), nullable=False)
    rows_recovered = Column(Integer, nullable=False, default=0)
    tables_checked = Column(Integer, nullable=False, default=0)
    # Whether the audit hash chains re-verified on the restored copy.
    chain_valid = Column(Boolean, nullable=False, default=False)
    # Full harness report (integrity check, counts, chain verification).
    drill_output = Column(JSON, nullable=True)
    performed_by = Column(String(255), nullable=False, default="system")
    passed = Column(Boolean, nullable=False, default=False, index=True)
    notes = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow)
