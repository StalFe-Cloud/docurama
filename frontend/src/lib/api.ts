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
  created_at: string;
}

export interface FieldItem {
  id: string;
  envelope_id: string;
  recipient_id?: string;
  field_type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label?: string;
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

export interface TemplateItem {
  id: string;
  title: string;
  description?: string;
  pdf_path?: string;
  fields_data: any[];
  roles_data: any[];
  created_at: string;
  updated_at: string;
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
  voidEnvelope: async (id: string, reason: string) => {
    const fd = new FormData();
    fd.append('reason', reason);
    const res = await fetch(`${API_BASE}/envelopes/${id}/void`, {
      method: 'POST',
      body: fd,
    });
    return res.json();
  },

  // Templates
  listTemplates: async (): Promise<TemplateItem[]> => {
    const res = await fetch(`${API_BASE}/templates`);
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

  // Signing
  getSigningSession: async (token: string) => {
    const res = await fetch(`${API_BASE}/signing/${token}`);
    if (!res.ok) throw new Error('Signing session expired or invalid');
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
  }
};
