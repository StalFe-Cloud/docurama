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
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

# Field Schemas
class FieldBase(BaseModel):
    field_type: str  # signature, initials, date, text, number, checkbox, radio, dropdown, file
    page_number: int = 1
    x: float
    y: float
    width: float = 150.0
    height: float = 50.0
    required: bool = True
    label: Optional[str] = None
    placeholder: Optional[str] = None
    validation_regex: Optional[str] = None
    options: Optional[List[str]] = []
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
    declined_reason: Optional[str] = None
    delegated_to_email: Optional[str] = None
    delegated_to_name: Optional[str] = None
    delegated_at: Optional[datetime] = None
    reminders_sent_count: Optional[int] = 0
    last_reminded_at: Optional[datetime] = None
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
    value: str

class SubmitSignaturesRequest(BaseModel):
    signatures: List[SignatureSubmission]
    signature_data_url: Optional[str] = None
    signature_type: Optional[str] = "draw"

class DeclineRequest(BaseModel):
    reason: str

class DelegateRequest(BaseModel):
    name: str
    email: EmailStr

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

# Folder Schemas
class FolderCreate(BaseModel):
    name: str
    color: Optional[str] = "#4f46e5"
    parent_id: Optional[str] = None

class FolderOut(BaseModel):
    id: str
    name: str
    color: str
    parent_id: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

# Template Schemas
class TemplateCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    folder_id: Optional[str] = None
    tags: Optional[List[str]] = []
    is_public_shared: Optional[bool] = False
    public_slug: Optional[str] = None
    reminder_interval_days: Optional[int] = 3
    max_reminders: Optional[int] = 3
    fields_data: Optional[List[Any]] = []
    roles_data: Optional[List[Any]] = []

class TemplateOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    folder_id: Optional[str] = None
    tags: List[str] = []
    is_public_shared: bool = False
    public_slug: Optional[str] = None
    reminder_interval_days: int = 3
    max_reminders: int = 3
    pdf_path: Optional[str] = None
    fields_data: List[Any] = []
    roles_data: List[Any] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Auto Detect Schemas
class DetectedField(BaseModel):
    field_type: str
    page_number: int
    x: float
    y: float
    width: float
    height: float
    name: Optional[str] = None
    confidence: float = 1.0

class AutoDetectResponse(BaseModel):
    total_detected: int
    fields: List[DetectedField]

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

# Webhook Schemas
class WebhookCreate(BaseModel):
    url: str
    events: Optional[List[str]] = [
        "envelope.created", "envelope.sent", "envelope.completed", 
        "envelope.declined", "recipient.opened", "recipient.signed"
    ]
    is_active: Optional[bool] = True

class WebhookDeliveryOut(BaseModel):
    id: str
    event_type: str
    response_status: Optional[int] = None
    attempts: int
    is_success: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class WebhookOut(BaseModel):
    id: str
    url: str
    secret_token: str
    events: List[str]
    is_active: bool
    created_at: datetime
    deliveries_count: Optional[int] = 0
    
    class Config:
        from_attributes = True

class WebhookTestRequest(BaseModel):
    event_type: Optional[str] = "ping"

# In-line Correction Request Schemas
class CorrectionRequestCreate(BaseModel):
    suggested_correction: str
    clause_title: Optional[str] = None
    field_id: Optional[str] = None

class CorrectionRequestOut(BaseModel):
    id: str
    envelope_id: str
    submitter_id: str
    field_id: Optional[str] = None
    clause_title: Optional[str] = None
    suggested_correction: str
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True
