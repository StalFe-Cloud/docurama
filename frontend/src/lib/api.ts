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

  // Domains
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
  }
};
