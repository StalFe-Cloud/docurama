const API_BASE = '/api';

export interface Envelope {
  id: string;
  title: string;
  status: 'draft' | 'sent' | 'delivered' | 'signed' | 'completed' | 'voided' | 'declined';
  verification_code: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  recipients_count?: number;
  signed_count?: number;
  sha256_original?: string;
  sha256_signed?: string;
  // pending until completion, then sealed or unsealed.
  seal_status?: string | null;
  recipients?: Recipient[];
  fields?: FieldItem[];
  audit_events?: AuditEvent[];
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: string;
  routing_order: number;
  status: string;
  signing_token: string;
  signed_at?: string;
  declined_reason?: string;
  delegated_to_email?: string;
  delegated_to_name?: string;
  delegated_at?: string;
  reminders_sent_count?: number;
  last_reminded_at?: string;
  token_expires_at?: string | null;
  created_at: string;
}

export interface FieldItem {
  id: string;
  envelope_id: string;
  recipient_id?: string;
  field_type: string; // signature, initials, date, text, number, checkbox, radio, dropdown, file
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label?: string;
  placeholder?: string;
  validation_regex?: string;
  options?: string[];
  value?: string;
}

export interface AuditEvent {
  id: string;
  event_type: string;
  actor_name: string;
  actor_email?: string;
  ip_address?: string;
  description: string;
  created_at: string;
}

export interface TemplateFolder {
  id: string;
  name: string;
  color: string;
  parent_id?: string;
  created_at: string;
}

export interface TemplateItem {
  id: string;
  title: string;
  description?: string;
  folder_id?: string;
  tags?: string[];
  is_public_shared?: boolean;
  public_slug?: string;
  reminder_interval_days?: number;
  max_reminders?: number;
  pdf_path?: string;
  fields_data: any[];
  roles_data: any[];
  created_at: string;
  updated_at: string;
}

export interface DetectedField {
  field_type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  confidence: number;
}

export interface AutoDetectResult {
  total_detected: number;
  fields: DetectedField[];
}

export interface DocumentPage {
  page_number: number;
  width: number;
  height: number;
  aspect_ratio: number;
  url: string;
}

export interface DocumentPreview {
  doc_id: string;
  filename: string;
  page_count: number;
  pages: DocumentPage[];
}

export interface CompanyItem {
  id: string;
  name: string;
  subdomain?: string;
  timezone?: string;
  enforce_domain_auth?: boolean;
  is_active_company?: boolean;
  role?: string;
  members_count?: number;
  verified_domain?: string | null;
  domain_verification_status?: string;
  created_at?: string;
}

export interface CompanyMemberItem {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at?: string;
}

export interface CompanyInviteResult {
  success: boolean;
  membership_id: string;
  user_id: string;
  email: string;
  role: string;
  is_new_user: boolean;
  temporary_password?: string | null;
  message: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
}

export interface ApiKeyCreated extends ApiKeyItem {
  // Returned once at creation and never retrievable again.
  plaintext_key: string;
}

export interface SigningCertificateItem {
  id: string;
  label: string;
  subject?: string | null;
  issuer?: string | null;
  serial_number?: string | null;
  fingerprint_sha256?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_default: boolean;
  status: string;
  created_at?: string;
}

export interface AccountSettingSection {
  section: string;
  data: Record<string, any>;
  updated_at?: string | null;
}

export interface DomainItem {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  verification_token: string;
  verification_method: string;
  txt_record_host: string;
  txt_record_value: string;
  cname_record_host: string;
  cname_target: string;
  web_confirmation_url?: string;
  verified_at?: string;
  last_checked_at?: string;
  dns_check_details?: any;
  enforce_domain_auth?: boolean;
  auth_assurance_level?: string;
  created_at: string;
}

export interface DomainVerifyResult {
  success: boolean;
  domain: string;
  status: string;
  message: string;
  method_matched?: string;
  dns_details?: any;
  verified_at?: string;
  enforce_domain_auth?: boolean;
  auth_assurance_level?: string;
}

export interface VerificationResult {
  is_valid: boolean;
  envelope_title?: string;
  envelope_id?: string;
  verification_code?: string;
  status?: string;
  completed_at?: string;
  sha256?: string;
  certificate_subject?: string;
  certificate_issuer?: string;
  timestamp_rfc3161?: string;
  pades_ltv_verified: boolean;
  // Observed cryptographic state, reported by the backend from an actual inspection
  // of the document. Absent or false means "not established", never "assume valid".
  has_digital_signature?: boolean;
  signature_intact?: boolean;
  has_timestamp?: boolean;
  timestamp_utc?: string | null;
  pades_level?: string | null;
  seal_status?: string | null;
  audit_trail: AuditEvent[];
  issuer_domain_verified?: boolean;
  verified_domain?: string;
  message: string;
}

export interface WebhookItem {
  id: string;
  url: string;
  secret_token: string;
  events: string[];
  is_active: boolean;
  deliveries_count?: number;
  created_at: string;
}

export interface ContractRiskFlag {
  category: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  summary: string;
}

export interface ContractAnalysisReport {
  is_analyzed: boolean;
  document_type: string;
  page_count: number;
  word_count: number;
  estimated_read_minutes: number;
  overall_risk_assessment: string;
  risk_badge: 'emerald' | 'blue' | 'amber';
  key_commercial_terms: {
    governing_law: string;
    termination_notice: string;
    payment_terms: string;
    dispute_resolution: string;
  };
  risk_flags: ContractRiskFlag[];
  error?: string;
}

export interface CorrectionRequestItem {
  id: string;
  envelope_id: string;
  submitter_id: string;
  field_id?: string;
  clause_title?: string;
  suggested_correction: string;
  status: string;
  created_at: string;
}

export interface WebhookDeliveryItem {
  id: string;
  event_type: string;
  response_status?: number;
  attempts: number;
  is_success: boolean;
  created_at: string;
}

export const api = {
  // Auth
  getMe: async () => {
    const res = await fetch(`${API_BASE}/auth/me`);
    if (!res.ok) throw new Error('Not authenticated');
    return res.json();
  },
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Login failed');
    }
    return res.json();
  },
  logout: async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  },

  // Envelopes
  listEnvelopes: async (): Promise<Envelope[]> => {
    const res = await fetch(`${API_BASE}/envelopes`);
    if (!res.ok) throw new Error('Failed to fetch envelopes');
    return res.json();
  },
  getEnvelope: async (id: string): Promise<Envelope> => {
    const res = await fetch(`${API_BASE}/envelopes/${id}`);
    if (!res.ok) throw new Error('Failed to fetch envelope details');
    return res.json();
  },
  createEnvelope: async (formData: FormData): Promise<Envelope> => {
    const res = await fetch(`${API_BASE}/envelopes`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create envelope');
    }
    return res.json();
  },
  sendReminder: async (id: string) => {
    const res = await fetch(`${API_BASE}/envelopes/${id}/remind`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to dispatch reminders');
    return res.json();
  },
  getExportCsvUrl: (id: string) => `${API_BASE}/envelopes/${id}/export-csv`,
  bulkSendEnvelopes: async (templateId: string, csvFile: File) => {
    const fd = new FormData();
    fd.append('template_id', templateId);
    fd.append('csv_file', csvFile);
    const res = await fetch(`${API_BASE}/envelopes/bulk`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error('Bulk dispatch failed');
    return res.json();
  },
  voidEnvelope: async (id: string, reason: string) => {
    const fd = new FormData();
    fd.append('reason', reason);
    const res = await fetch(`${API_BASE}/envelopes/${id}/void`, {
      method: 'POST',
      body: fd,
    });
    return res.json();
  },

  // Folders
  listFolders: async (): Promise<TemplateFolder[]> => {
    const res = await fetch(`${API_BASE}/folders`);
    if (!res.ok) throw new Error('Failed to fetch folders');
    return res.json();
  },
  createFolder: async (name: string, color: string = '#4f46e5', parentId?: string): Promise<TemplateFolder> => {
    const res = await fetch(`${API_BASE}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, parent_id: parentId }),
    });
    if (!res.ok) throw new Error('Failed to create folder');
    return res.json();
  },
  deleteFolder: async (folderId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/folders/${folderId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete folder');
  },

  // Templates
  listTemplates: async (folderId?: string): Promise<TemplateItem[]> => {
    const url = folderId ? `${API_BASE}/templates?folder_id=${folderId}` : `${API_BASE}/templates`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch templates');
    return res.json();
  },
  createTemplate: async (formData: FormData): Promise<TemplateItem> => {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  autoDetectFields: async (file: File): Promise<AutoDetectResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/templates/auto-detect`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error('Auto field detection failed');
    return res.json();
  },
  getPublicTemplate: async (slug: string) => {
    const res = await fetch(`${API_BASE}/templates/public/${slug}`);
    if (!res.ok) throw new Error('Public form not found');
    return res.json();
  },
  startPublicTemplate: async (slug: string, name: string, email: string) => {
    const res = await fetch(`${API_BASE}/templates/public/${slug}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    if (!res.ok) throw new Error('Failed to initiate public form');
    return res.json();
  },

  // Documents & Previews
  uploadDocumentPreview: async (file: File): Promise<DocumentPreview> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/documents/preview`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error('Failed to generate document page previews');
    return res.json();
  },

  // Signing
  getSigningSession: async (token: string) => {
    const res = await fetch(`${API_BASE}/signing/${token}`);
    if (!res.ok) throw new Error('Signing session expired or invalid');
    return res.json();
  },
  getSigningPages: async (token: string): Promise<{ page_count: number; pages: DocumentPage[] }> => {
    const res = await fetch(`${API_BASE}/signing/${token}/pages`);
    if (!res.ok) throw new Error('Failed to fetch signing document pages');
    return res.json();
  },
  getMobileHandshake: async (token: string) => {
    const res = await fetch(`${API_BASE}/signing/${token}/mobile_handshake`);
    return res.json();
  },
  submitSignatures: async (token: string, payload: any) => {
    const res = await fetch(`${API_BASE}/signing/${token}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Signature submission failed');
    }
    return res.json();
  },
  declineSigning: async (token: string, reason: string) => {
    const res = await fetch(`${API_BASE}/signing/${token}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to decline signing');
    return res.json();
  },
  delegateSigning: async (token: string, name: string, email: string) => {
    const res = await fetch(`${API_BASE}/signing/${token}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    if (!res.ok) throw new Error('Failed to delegate signing');
    return res.json();
  },
  getContractAnalysis: async (token: string): Promise<ContractAnalysisReport> => {
    const res = await fetch(`${API_BASE}/signing/${token}/contract-analysis`);
    if (!res.ok) throw new Error('Failed to fetch contract analysis');
    return res.json();
  },
  requestCorrection: async (token: string, data: { suggested_correction: string; clause_title?: string; field_id?: string }): Promise<CorrectionRequestItem> => {
    const res = await fetch(`${API_BASE}/signing/${token}/request-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to submit correction request');
    }
    return res.json();
  },
  getCorrections: async (token: string): Promise<CorrectionRequestItem[]> => {
    const res = await fetch(`${API_BASE}/signing/${token}/corrections`);
    if (!res.ok) throw new Error('Failed to fetch corrections');
    return res.json();
  },

  // Verify
  verifyByCode: async (code: string): Promise<VerificationResult> => {
    const res = await fetch(`${API_BASE}/verify?code=${encodeURIComponent(code)}`);
    return res.json();
  },
  verifyByUpload: async (file: File): Promise<VerificationResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/verify/upload`, {
      method: 'POST',
      body: fd,
    });
    return res.json();
  },

  // Companies & Organizations
  getCompanies: async (): Promise<CompanyItem[]> => {
    const res = await fetch(`${API_BASE}/companies`);
    if (!res.ok) throw new Error('Failed to fetch companies');
    return res.json();
  },
  createCompany: async (data: { name: string; domain?: string; subdomain?: string; timezone?: string }): Promise<CompanyItem> => {
    const res = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create company');
    }
    return res.json();
  },
  switchCompany: async (companyId: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/companies/${companyId}/switch`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to switch company');
    }
    return res.json();
  },
  updateCompany: async (companyId: string, data: { name?: string; timezone?: string; enforce_domain_auth?: boolean }): Promise<CompanyItem> => {
    const res = await fetch(`${API_BASE}/companies/${companyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update company');
    }
    return res.json();
  },
  getCompanyMembers: async (companyId: string): Promise<CompanyMemberItem[]> => {
    const res = await fetch(`${API_BASE}/companies/${companyId}/members`);
    if (!res.ok) throw new Error('Failed to fetch company members');
    return res.json();
  },
  inviteCompanyMember: async (
    companyId: string,
    data: { email: string; role?: string; first_name?: string; last_name?: string }
  ): Promise<CompanyInviteResult> => {
    const res = await fetch(`${API_BASE}/companies/${companyId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to invite member');
    }
    return res.json();
  },
  removeCompanyMember: async (companyId: string, userId: string): Promise<{ success: boolean; message: string }> => {
    const res = await fetch(`${API_BASE}/companies/${companyId}/members/${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to remove member');
    }
    return res.json();
  },

  // Domains & Enterprise Authentication
  getDomains: async (): Promise<DomainItem[]> => {
    const res = await fetch(`${API_BASE}/domains`);
    if (!res.ok) throw new Error('Failed to fetch domains');
    return res.json();
  },
  createDomain: async (domain: string): Promise<DomainItem> => {
    const res = await fetch(`${API_BASE}/domains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to register domain');
    }
    return res.json();
  },
  verifyDomain: async (domainId: string): Promise<DomainVerifyResult> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}/verify`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Verification check failed');
    }
    return res.json();
  },
  toggleDomainAuth: async (domainId: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}/toggle-enforcement`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to toggle domain authentication enforcement');
    }
    return res.json();
  },
  validateDomainAuth: async (email: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/domains/validate-authentication`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('Failed to validate domain authentication');
    return res.json();
  },
  deleteDomain: async (domainId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/domains/${domainId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete domain');
  },

  // Webhooks
  getWebhooks: async (): Promise<WebhookItem[]> => {
    const res = await fetch(`${API_BASE}/webhooks`);
    if (!res.ok) throw new Error('Failed to fetch webhooks');
    return res.json();
  },
  createWebhook: async (url: string, events: string[] = ['*']): Promise<WebhookItem> => {
    const res = await fetch(`${API_BASE}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, events }),
    });
    if (!res.ok) throw new Error('Failed to create webhook');
    return res.json();
  },
  deleteWebhook: async (webhookId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/webhooks/${webhookId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete webhook');
  },
  testWebhook: async (webhookId: string, eventType: string = 'ping') => {
    const res = await fetch(`${API_BASE}/webhooks/${webhookId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType }),
    });
    return res.json();
  },
  getWebhookDeliveries: async (webhookId: string): Promise<WebhookDeliveryItem[]> => {
    const res = await fetch(`${API_BASE}/webhooks/${webhookId}/deliveries`);
    if (!res.ok) throw new Error('Failed to fetch deliveries');
    return res.json();
  },

  // Settings sections, API keys and signing certificates
  getSettingSection: async (section: string): Promise<AccountSettingSection> => {
    const res = await fetch(`${API_BASE}/settings/${section}`);
    if (!res.ok) throw new Error(`Failed to load ${section} settings`);
    return res.json();
  },
  updateSettingSection: async (section: string, data: Record<string, any>): Promise<AccountSettingSection> => {
    const res = await fetch(`${API_BASE}/settings/${section}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `Failed to save ${section} settings`);
    }
    return res.json();
  },
  getApiKeys: async (): Promise<ApiKeyItem[]> => {
    const res = await fetch(`${API_BASE}/api-keys`);
    if (!res.ok) throw new Error('Failed to fetch API keys');
    return res.json();
  },
  createApiKey: async (data: { name: string; scopes?: string[]; expires_in_days?: number }): Promise<ApiKeyCreated> => {
    const res = await fetch(`${API_BASE}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create API key');
    }
    return res.json();
  },
  revokeApiKey: async (keyId: string): Promise<{ success: boolean; message: string }> => {
    const res = await fetch(`${API_BASE}/api-keys/${keyId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to revoke API key');
    }
    return res.json();
  },
  getSigningCertificates: async (): Promise<SigningCertificateItem[]> => {
    const res = await fetch(`${API_BASE}/signing-certificates`);
    if (!res.ok) throw new Error('Failed to fetch signing certificates');
    return res.json();
  },
  registerSigningCertificate: async (data: {
    label: string;
    subject?: string;
    issuer?: string;
    serial_number?: string;
    valid_from?: string;
    valid_until?: string;
    is_default?: boolean;
  }): Promise<SigningCertificateItem> => {
    const res = await fetch(`${API_BASE}/signing-certificates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to register certificate');
    }
    return res.json();
  },
  setDefaultSigningCertificate: async (certId: string): Promise<SigningCertificateItem> => {
    const res = await fetch(`${API_BASE}/signing-certificates/${certId}/default`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to set default certificate');
    }
    return res.json();
  },
  deleteSigningCertificate: async (certId: string): Promise<{ success: boolean }> => {
    const res = await fetch(`${API_BASE}/signing-certificates/${certId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to remove certificate');
    }
    return res.json();
  }
};
