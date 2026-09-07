import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text, JSON
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
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    users = relationship("User", back_populates="account", cascade="all, delete-orphan")
    envelopes = relationship("Envelope", back_populates="account", cascade="all, delete-orphan")
    templates = relationship("Template", back_populates="account", cascade="all, delete-orphan")
    template_folders = relationship("TemplateFolder", back_populates="account", cascade="all, delete-orphan")
    domain_verifications = relationship("DomainVerification", back_populates="account", cascade="all, delete-orphan")
    webhooks = relationship("Webhook", back_populates="account", cascade="all, delete-orphan")

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
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="users")
    envelopes = relationship("Envelope", back_populates="creator")

class TemplateFolder(Base):
    __tablename__ = "template_folders"
    
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
    signed_at = Column(DateTime(timezone=True), nullable=True)
    
    declined_reason = Column(Text, nullable=True)
    delegated_to_email = Column(String(255), nullable=True)
    delegated_to_name = Column(String(255), nullable=True)
    delegated_at = Column(DateTime(timezone=True), nullable=True)
    reminders_sent_count = Column(Integer, default=0)
    last_reminded_at = Column(DateTime(timezone=True), nullable=True)
    
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
    cname_target = Column(String(255), nullable=False, default="docurama.example.com")
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
