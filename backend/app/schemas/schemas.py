from datetime import datetime
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, EmailStr, Field as PydanticField

class UserCreate(BaseModel):
    email: EmailStr
    # Same floor as password change and reset. Registration used to accept
    # anything, so the weakest credential in the system was set at sign-up.
    password: str = PydanticField(min_length=12)
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class CompanyCreate(BaseModel):
    name: str
    subdomain: Optional[str] = None
    domain: Optional[str] = None
    timezone: Optional[str] = "(GMT+00:00) UTC"

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None
    enforce_domain_auth: Optional[bool] = None

class CompanyInviteRequest(BaseModel):
    email: EmailStr
    role: str = "member"  # owner, admin, manager, member
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class CompanyInviteResponse(BaseModel):
    success: bool
    membership_id: str
    user_id: str
    email: str
    role: str
    is_new_user: bool
    temporary_password: Optional[str] = None
    message: str

class CompanyMemberOut(BaseModel):
    id: str
    user_id: str
    email: str
    name: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None

class CompanyOut(BaseModel):
    id: str
    name: str
    subdomain: Optional[str] = None
    timezone: Optional[str] = "(GMT+00:00) UTC"
    enforce_domain_auth: bool = False
    is_active_company: bool = False
    role: Optional[str] = "member"
    members_count: int = 1
    verified_domain: Optional[str] = None
    domain_verification_status: str = "unverified"  # unverified, pending, verified
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class CompanySwitchResponse(BaseModel):
    success: bool
    active_company_id: str
    company: CompanyOut
    access_token: str
    user: Any

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

class GenericAckResponse(BaseModel):
    """
    Deliberately uninformative. The reset request answers identically whether or not
    the address is registered, so this response cannot be used to enumerate accounts.
    """
    success: bool
    message: str

class TotpEnrolStart(BaseModel):
    secret: str
    provisioning_uri: str
    qr_base64: str

class TotpEnrolConfirm(BaseModel):
    code: str

class TotpEnrolResult(BaseModel):
    enabled: bool
    recovery_codes: List[str] = []
    message: str

class TotpStatus(BaseModel):
    enabled: bool
    confirmed_at: Optional[datetime] = None
    recovery_codes_remaining: int = 0

class TotpDisableRequest(BaseModel):
    # Re-authentication, so a walk-up on an unlocked session cannot strip the factor.
    password: str

class LoginChallengeResponse(BaseModel):
    """
    Returned when a password is correct but a second factor is required. Carries no
    session and no user detail, only a short-lived token naming the pending sign-in.
    """
    mfa_required: bool = True
    challenge_token: str
    message: str

class TotpLoginRequest(BaseModel):
    challenge_token: str
    # Either a 6-digit code or a recovery code.
    code: str

class StampOut(BaseModel):
    id: str
    kind: str
    url: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class StampSaveRequest(BaseModel):
    kind: str
    # A data URL from the drawing pad, or omitted when a file is uploaded.
    data_url: Optional[str] = None

class WorkspaceDeleteRequest(BaseModel):
    # Typing the name is the confirmation; a checkbox is too easy to click through.
    confirm_name: str

class WorkspaceDeleteResult(BaseModel):
    success: bool
    templates_removed: int
    envelopes_retained: int
    message: str

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

class PasswordChangeResponse(BaseModel):
    success: bool
    message: str

class UserOut(BaseModel):
    id: str
    email: EmailStr
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    role: str
    is_active: bool
    # Deployment-wide administration, distinct from the company role. Gates the platform
    # default mail profile in Settings.
    is_platform_admin: bool = False
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    companies: Optional[List[CompanyOut]] = []
    domain_verified: Optional[bool] = False
    verified_domain: Optional[str] = None
    auth_assurance_level: Optional[str] = "standard"
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
    token_expires_at: Optional[datetime] = None
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
    # pending until completion, then sealed or unsealed. Reflects what the signing
    # run actually achieved, never what it intended.
    seal_status: Optional[str] = None
    
    class Config:
        from_attributes = True

class EnvelopeDetailOut(BaseModel):
    id: str
    title: str
    status: str
    verification_code: str
    sha256_original: Optional[str] = None
    sha256_signed: Optional[str] = None
    seal_status: Optional[str] = None
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
    # Observed cryptographic state. These describe what was actually found in the
    # document rather than what the platform intended to apply.
    has_digital_signature: bool = False
    signature_intact: bool = False
    has_timestamp: bool = False
    timestamp_utc: Optional[str] = None
    pades_level: Optional[str] = None
    seal_status: Optional[str] = None
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
    enforce_domain_auth: Optional[bool] = False
    auth_assurance_level: Optional[str] = "enterprise_domain_verified"
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
    enforce_domain_auth: Optional[bool] = False
    auth_assurance_level: Optional[str] = "enterprise_domain_verified"

class DomainPublicStatus(BaseModel):
    domain: str
    is_verified: bool

class DomainAuthValidateRequest(BaseModel):
    email: EmailStr

class DomainAuthValidateResponse(BaseModel):
    is_authenticated: bool
    domain: str
    assurance_level: str  # "enterprise_domain_verified" or "standard"
    txt_record_host: Optional[str] = None
    verified_at: Optional[datetime] = None
    organization_name: Optional[str] = None
    message: str

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

# ---------------------------------------------------------------------------
# Settings: API keys, signing certificates, per-section preferences
# ---------------------------------------------------------------------------

class ApiKeyCreate(BaseModel):
    name: str = "API Key"
    scopes: Optional[List[str]] = None
    expires_in_days: Optional[int] = None

class ApiKeyOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    scopes: List[str] = []
    is_active: bool = True
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ApiKeyCreatedOut(ApiKeyOut):
    # Returned once at creation and never retrievable again.
    plaintext_key: str

class SigningCertificateOut(BaseModel):
    id: str
    label: str
    subject: Optional[str] = None
    issuer: Optional[str] = None
    serial_number: Optional[str] = None
    fingerprint_sha256: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    is_default: bool = False
    status: str = "active"
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class SigningCertificateCreate(BaseModel):
    label: str
    subject: Optional[str] = None
    issuer: Optional[str] = None
    serial_number: Optional[str] = None
    fingerprint_sha256: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    is_default: bool = False

class AccountSettingOut(BaseModel):
    section: str
    data: Dict[str, Any] = {}
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class AccountSettingUpdate(BaseModel):
    data: Dict[str, Any]

# ---------------------------------------------------------------------------
# Mail server profile
#
# The password is write-only. It is accepted on update, never returned on read;
# password_set reports whether one is stored.
# ---------------------------------------------------------------------------

class SmtpSettingsOut(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    password_set: bool = False
    from_email: str = ""
    from_name: str = "Docurama"
    use_tls: bool = True
    use_ssl: bool = False
    timeout: int = 20
    # "account", "platform", or None when nothing usable is configured. Lets the UI say
    # which profile mail is actually going out through.
    effective_source: Optional[str] = None
    scope: str = "account"

class SmtpSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    # Omit to leave the stored password untouched; send "" to clear it.
    password: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    use_tls: Optional[bool] = None
    use_ssl: Optional[bool] = None
    timeout: Optional[int] = None

class SmtpTestRequest(BaseModel):
    to_email: EmailStr

class SmtpTestResult(BaseModel):
    sent: bool
    source: Optional[str] = None
    message: str
