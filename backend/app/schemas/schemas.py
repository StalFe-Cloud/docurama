from datetime import datetime
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, EmailStr, Field as PydanticField

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: EmailStr
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    role: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

# Field Schemas
class FieldBase(BaseModel):
    field_type: str  # signature, initials, date, text, name, email, checkbox
    page_number: int = 1
    x: float
    y: float
    width: float = 150.0
    height: float = 50.0
    required: bool = True
    label: Optional[str] = None
    value: Optional[str] = None

class FieldCreate(FieldBase):
    recipient_id: Optional[str] = None

class FieldOut(FieldBase):
    id: str
    envelope_id: str
    recipient_id: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

# Recipient Schemas
class RecipientBase(BaseModel):
    name: str
    email: EmailStr
    role: str = "signer"  # signer, viewer, approver
    routing_order: int = 1

class RecipientCreate(RecipientBase):
    pass

class RecipientOut(RecipientBase):
    id: str
    status: str
    signing_token: str
    signed_at: Optional[datetime] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

# Audit Event Schemas
class AuditEventOut(BaseModel):
    id: str
    event_type: str
    actor_name: str
    actor_email: Optional[str] = None
    ip_address: Optional[str] = None
    description: str
    created_at: datetime
    
    class Config:
        from_attributes = True

# Envelope Schemas
class EnvelopeCreate(BaseModel):
    title: str
    recipients: List[RecipientCreate]
    fields: Optional[List[FieldCreate]] = []

class EnvelopeOut(BaseModel):
    id: str
    title: str
    status: str
    verification_code: str
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    recipients_count: Optional[int] = 0
    signed_count: Optional[int] = 0
    
    class Config:
        from_attributes = True

class EnvelopeDetailOut(BaseModel):
    id: str
    title: str
    status: str
    verification_code: str
    sha256_original: Optional[str] = None
    sha256_signed: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    recipients: List[RecipientOut] = []
    fields: List[FieldOut] = []
    audit_events: List[AuditEventOut] = []
    
    class Config:
        from_attributes = True

# Signing Studio Schemas
class SigningSessionOut(BaseModel):
    envelope_id: str
    envelope_title: str
    recipient: RecipientOut
    pdf_url: str
    fields: List[FieldOut]
    all_recipients: List[RecipientOut]

class SignatureSubmission(BaseModel):
    field_id: str
    value: str  # text or signature base64

class SubmitSignaturesRequest(BaseModel):
    signatures: List[SignatureSubmission]
    signature_data_url: Optional[str] = None  # primary signature image
    signature_type: Optional[str] = "draw"

# Public Verification Schemas
class VerificationResponse(BaseModel):
    is_valid: bool
    envelope_title: Optional[str] = None
    envelope_id: Optional[str] = None
    verification_code: Optional[str] = None
    status: Optional[str] = None
    completed_at: Optional[datetime] = None
    sha256: Optional[str] = None
    certificate_subject: Optional[str] = None
    certificate_issuer: Optional[str] = None
    timestamp_rfc3161: Optional[str] = None
    pades_ltv_verified: bool = False
    audit_trail: List[AuditEventOut] = []
    issuer_domain_verified: bool = False
    verified_domain: Optional[str] = None
    message: str = ""

# Template Schemas
class TemplateCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    fields_data: Optional[List[Any]] = []
    roles_data: Optional[List[Any]] = []

class TemplateOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    pdf_path: Optional[str] = None
    fields_data: List[Any] = []
    roles_data: List[Any] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Domain Verification Schemas
class DomainCreate(BaseModel):
    domain: str

class DomainOut(BaseModel):
    id: str
    domain: str
    status: str
    verification_token: str
    verification_method: str
    txt_record_host: str
    txt_record_value: str
    cname_record_host: str
    cname_target: str
    web_confirmation_url: Optional[str] = None
    verified_at: Optional[datetime] = None
    last_checked_at: Optional[datetime] = None
    dns_check_details: Optional[Dict[str, Any]] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class DomainVerifyResponse(BaseModel):
    success: bool
    domain: str
    status: str
    message: str
    method_matched: Optional[str] = None
    dns_details: Optional[Dict[str, Any]] = None
    verified_at: Optional[datetime] = None

class DomainPublicStatus(BaseModel):
    domain: str
    is_verified: bool
    verified_at: Optional[datetime] = None
    organization_name: Optional[str] = None
