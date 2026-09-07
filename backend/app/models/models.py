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
    domain_verifications = relationship("DomainVerification", back_populates="account", cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=True, default="")
    last_name = Column(String(100), nullable=True, default="")
    role = Column(String(50), default="admin")  # admin, member
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="users")
    envelopes = relationship("Envelope", back_populates="creator")

class Template(Base):
    __tablename__ = "templates"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    pdf_path = Column(String(500), nullable=True)
    fields_data = Column(JSON, default=list)  # list of field definitions
    roles_data = Column(JSON, default=list)   # list of role definitions
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    
    account = relationship("Account", back_populates="templates")

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
    # Statuses: waiting, sent, opened, signed, declined
    status = Column(String(50), default="waiting")
    signing_token = Column(String(128), unique=True, index=True, nullable=False)
    signed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    
    envelope = relationship("Envelope", back_populates="recipients")
    fields = relationship("Field", back_populates="recipient")
    signatures = relationship("Signature", back_populates="recipient")

class Field(Base):
    __tablename__ = "fields"
    
    id = Column(String(36), primary_key=True, default=gen_uuid)
    envelope_id = Column(String(36), ForeignKey("envelopes.id"), nullable=False)
    recipient_id = Column(String(36), ForeignKey("recipients.id"), nullable=True)
    # Types: signature, initials, date, text, name, email, checkbox
    field_type = Column(String(50), nullable=False)
    page_number = Column(Integer, default=1)
    x = Column(Float, default=0.0)      # Percentage 0-100 or points
    y = Column(Float, default=0.0)      # Percentage 0-100 or points
    width = Column(Float, default=150.0)
    height = Column(Float, default=50.0)
    required = Column(Boolean, default=True)
    label = Column(String(255), nullable=True)
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
    # Events: created, sent, opened, mobile_handshake, signed, completed, voided
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
    # Statuses: pending, verified, failed
    status = Column(String(50), default="pending", index=True)
    verification_token = Column(String(128), unique=True, nullable=False)
    # Verification method: dns_txt, dns_cname, web_confirmation
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
