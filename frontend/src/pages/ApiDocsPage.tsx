import React, { useState } from 'react';
import {
  Code,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  FileText,
  Send,
  Users,
  Webhook,
  Key,
  ChevronDown,
  ChevronRight,
  Search,
  Sparkles,
  ArrowRight,
  Terminal,
  Cpu,
  Layers,
  BookOpen
} from 'lucide-react';

interface ApiDocsPageProps {
  embedded?: boolean;
}

export const ApiDocsPage: React.FC<ApiDocsPageProps> = ({ embedded = false }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('templates');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState<'curl' | 'python' | 'javascript'>('curl');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEndpoints, setExpandedEndpoints] = useState<{ [key: string]: boolean }>({
    'list-templates': true,
    'create-submission': true
  });

  const origin = window.location.origin;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const toggleEndpoint = (id: string) => {
    setExpandedEndpoints((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const endpoints = [
    // ----------------------------------------------------
    // TEMPLATES
    // ----------------------------------------------------
    {
      id: 'list-templates',
      category: 'templates',
      method: 'GET',
      path: '/api/templates',
      title: 'List all templates',
      description: 'Retrieve a paginated list of all active document templates in the workspace.',
      params: [
        { name: 'q', type: 'string', required: false, desc: 'Filter templates by title query.' },
        { name: 'limit', type: 'integer', required: false, desc: 'Maximum items to return (default: 20, max: 100).' },
        { name: 'after', type: 'integer', required: false, desc: 'Cursor identifier for forward pagination.' }
      ],
      curl: `curl --location '${origin}/api/templates?limit=10' \\
  --header 'X-Auth-Token: YOUR_API_KEY'`,
      python: `import requests

response = requests.get(
    "${origin}/api/templates",
    headers={"X-Auth-Token": "YOUR_API_KEY"},
    params={"limit": 10}
)
print(response.json())`,
      javascript: `const response = await fetch('${origin}/api/templates?limit=10', {
  headers: {
    'X-Auth-Token': 'YOUR_API_KEY'
  }
});
const data = await response.json();
console.log(data);`,
      response: {
        data: [
          {
            id: 101,
            name: 'Enterprise Master Services Agreement',
            created_at: '2026-09-01T10:00:00Z',
            submitters: [{ name: 'Client Executive', role: 'First Party' }, { name: 'Docurama Officer', role: 'Second Party' }],
            fields_count: 8,
            documents: [{ name: 'MSA_2026.pdf', pages: 6 }]
          }
        ],
        pagination: { has_more: false, next_cursor: null }
      }
    },
    {
      id: 'get-template',
      category: 'templates',
      method: 'GET',
      path: '/api/templates/{id}',
      title: 'Get a template',
      description: 'Retrieve full metadata, schema, and field placement definitions for a template.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Unique template identifier.' }
      ],
      curl: `curl --location '${origin}/api/templates/101' \\
  --header 'X-Auth-Token: YOUR_API_KEY'`,
      python: `import requests

response = requests.get(
    "${origin}/api/templates/101",
    headers={"X-Auth-Token": "YOUR_API_KEY"}
)
print(response.json())`,
      javascript: `const response = await fetch('${origin}/api/templates/101', {
  headers: { 'X-Auth-Token': 'YOUR_API_KEY' }
});
console.log(await response.json());`,
      response: {
        id: 101,
        name: 'Enterprise Master Services Agreement',
        fields: [
          { name: 'Full Name', type: 'text', role: 'Client Executive', required: true },
          { name: 'Signature', type: 'signature', role: 'Client Executive', required: true },
          { name: 'Signed Date', type: 'date', role: 'Client Executive', required: true }
        ]
      }
    },
    {
      id: 'create-template-pdf',
      category: 'templates',
      method: 'POST',
      path: '/api/templates/pdf',
      title: 'Create template from PDF',
      description: 'Upload a base PDF file and define submitter roles and signature fields.',
      params: [
        { name: 'name', type: 'string', required: true, desc: 'Title of the new template.' },
        { name: 'documents', type: 'array', required: true, desc: 'Base64 encoded PDF payload or file URLs.' },
        { name: 'fields', type: 'array', required: false, desc: 'Optional pre-calculated field coordinates.' }
      ],
      curl: `curl --location '${origin}/api/templates/pdf' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{
    "name": "Vendor Non-Disclosure Agreement",
    "documents": [
      { "name": "NDA.pdf", "file": "JVBERi0xLjcKC..." }
    ]
  }'`,
      python: `import requests

payload = {
    "name": "Vendor Non-Disclosure Agreement",
    "documents": [{"name": "NDA.pdf", "file": "JVBERi0xLjcKC..."}]
}
res = requests.post("${origin}/api/templates/pdf", headers={"X-Auth-Token": "YOUR_API_KEY"}, json=payload)
print(res.json())`,
      javascript: `const res = await fetch('${origin}/api/templates/pdf', {
  method: 'POST',
  headers: { 'X-Auth-Token': 'YOUR_API_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Vendor Non-Disclosure Agreement',
    documents: [{ name: 'NDA.pdf', file: 'JVBERi0xLjcKC...' }]
  })
});`,
      response: {
        id: 102,
        name: 'Vendor Non-Disclosure Agreement',
        status: 'ready'
      }
    },
    {
      id: 'clone-template',
      category: 'templates',
      method: 'POST',
      path: '/api/templates/{id}/clone',
      title: 'Clone a template',
      description: 'Duplicate an existing template and its exact field layout into a new template.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Source template ID to duplicate.' },
        { name: 'name', type: 'string', required: false, desc: 'Optional new name for cloned template.' }
      ],
      curl: `curl --location '${origin}/api/templates/101/clone' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{ "name": "Copy of MSA 2026" }'`,
      python: `import requests
res = requests.post("${origin}/api/templates/101/clone", headers={"X-Auth-Token": "YOUR_API_KEY"}, json={"name": "Copy of MSA 2026"})`,
      javascript: `const res = await fetch('${origin}/api/templates/101/clone', { method: 'POST', headers: { 'X-Auth-Token': 'YOUR_API_KEY', 'Content-Type': 'application/json' } });`,
      response: { id: 103, name: 'Copy of MSA 2026', cloned_from: 101 }
    },
    {
      id: 'delete-template',
      category: 'templates',
      method: 'DELETE',
      path: '/api/templates/{id}',
      title: 'Archive a template',
      description: 'Soft-delete or archive a template so it cannot be used for new submissions.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Template identifier.' }
      ],
      curl: `curl --location --request DELETE '${origin}/api/templates/103' \\
  --header 'X-Auth-Token: YOUR_API_KEY'`,
      python: `requests.delete("${origin}/api/templates/103", headers={"X-Auth-Token": "YOUR_API_KEY"})`,
      javascript: `await fetch('${origin}/api/templates/103', { method: 'DELETE', headers: { 'X-Auth-Token': 'YOUR_API_KEY' } });`,
      response: { success: true, archived_id: 103 }
    },

    // ----------------------------------------------------
    // SUBMISSIONS
    // ----------------------------------------------------
    {
      id: 'create-submission',
      category: 'submissions',
      method: 'POST',
      path: '/api/submissions',
      title: 'Create a signature submission',
      description: 'Dispatch a document signing request to one or more signers with prefilled field values and order sequence.',
      params: [
        { name: 'template_id', type: 'integer', required: true, desc: 'Target template ID.' },
        { name: 'send_email', type: 'boolean', required: false, desc: 'Whether to automatically send invitation emails (default: true).' },
        { name: 'submitters', type: 'array', required: true, desc: 'List of recipients with role, email, and prefilled field values.' }
      ],
      curl: `curl --location '${origin}/api/submissions' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{
    "template_id": 101,
    "send_email": true,
    "submitters": [
      {
        "role": "Client Executive",
        "name": "Sarah Connor",
        "email": "sarah@cyberdyne.com",
        "values": {
          "Full Name": "Sarah Connor",
          "Company": "Cyberdyne Systems"
        }
      }
    ]
  }'`,
      python: `import requests

payload = {
    "template_id": 101,
    "send_email": True,
    "submitters": [
        {
            "role": "Client Executive",
            "name": "Sarah Connor",
            "email": "sarah@cyberdyne.com",
            "values": {"Full Name": "Sarah Connor"}
        }
    ]
}
res = requests.post("${origin}/api/submissions", headers={"X-Auth-Token": "YOUR_API_KEY"}, json=payload)
print(res.json())`,
      javascript: `const res = await fetch('${origin}/api/submissions', {
  method: 'POST',
  headers: { 'X-Auth-Token': 'YOUR_API_KEY', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    template_id: 101,
    submitters: [{ role: 'Client Executive', name: 'Sarah Connor', email: 'sarah@cyberdyne.com' }]
  })
});`,
      response: {
        id: 4012,
        slug: 'sub_89fd483a9',
        status: 'pending',
        submitters: [
          {
            id: 881,
            email: 'sarah@cyberdyne.com',
            status: 'sent',
            slug: 'sig_a91b2c3d',
            embed_url: `${origin}/s/sig_a91b2c3d`
          }
        ]
      }
    },
    {
      id: 'create-submission-emails',
      category: 'submissions',
      method: 'POST',
      path: '/api/submissions/emails',
      title: 'Quick single-signer submission',
      description: 'Shorthand endpoint to quickly dispatch a signing request to a single email address.',
      params: [
        { name: 'template_id', type: 'integer', required: true, desc: 'Target template ID.' },
        { name: 'emails', type: 'string', required: true, desc: 'Signer email address.' }
      ],
      curl: `curl --location '${origin}/api/submissions/emails' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{
    "template_id": 101,
    "emails": "sarah@cyberdyne.com"
  }'`,
      python: `requests.post("${origin}/api/submissions/emails", headers={"X-Auth-Token": "YOUR_API_KEY"}, json={"template_id": 101, "emails": "sarah@cyberdyne.com"})`,
      javascript: `await fetch('${origin}/api/submissions/emails', { method: 'POST', headers: { 'X-Auth-Token': 'YOUR_API_KEY', 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 101, emails: 'sarah@cyberdyne.com' }) });`,
      response: {
        id: 4013,
        status: 'pending',
        submitters: [{ email: 'sarah@cyberdyne.com', status: 'sent' }]
      }
    },
    {
      id: 'get-submission',
      category: 'submissions',
      method: 'GET',
      path: '/api/submissions/{id}',
      title: 'Get submission details',
      description: 'Retrieve current status, audit events, and submitter progress for an active envelope.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Submission envelope ID.' }
      ],
      curl: `curl --location '${origin}/api/submissions/4012' \\
  --header 'X-Auth-Token: YOUR_API_KEY'`,
      python: `requests.get("${origin}/api/submissions/4012", headers={"X-Auth-Token": "YOUR_API_KEY"})`,
      javascript: `await fetch('${origin}/api/submissions/4012', { headers: { 'X-Auth-Token': 'YOUR_API_KEY' } });`,
      response: {
        id: 4012,
        status: 'completed',
        completed_at: '2026-09-07T11:45:00Z',
        audit_trail: {
          rfc3161_timestamped: true,
          tsa_server: 'http://timestamp.digicert.com',
          sha256_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
        }
      }
    },
    {
      id: 'get-submission-documents',
      category: 'submissions',
      method: 'GET',
      path: '/api/submissions/{id}/documents',
      title: 'Download signed documents',
      description: 'Stream or download the completed PDF with cryptographic seals and combined audit trail log.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Submission envelope ID.' }
      ],
      curl: `curl --location '${origin}/api/submissions/4012/documents' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --output 'Completed_Document.pdf'`,
      python: `with requests.get("${origin}/api/submissions/4012/documents", headers={"X-Auth-Token": "YOUR_API_KEY"}, stream=True) as r:
    with open("Completed_Document.pdf", "wb") as f:
        f.write(r.content)`,
      javascript: `const res = await fetch('${origin}/api/submissions/4012/documents', { headers: { 'X-Auth-Token': 'YOUR_API_KEY' } });
const blob = await res.blob();`,
      response: {
        message: 'Binary PDF Stream (application/pdf) with PAdES-LTV signature verification'
      }
    },

    // ----------------------------------------------------
    // SUBMITTERS
    // ----------------------------------------------------
    {
      id: 'list-submitters',
      category: 'submitters',
      method: 'GET',
      path: '/api/submitters',
      title: 'List submitters',
      description: 'List signers across all workspace envelopes with status filtering.',
      params: [
        { name: 'submission_id', type: 'integer', required: false, desc: 'Filter by specific submission.' },
        { name: 'status', type: 'string', required: false, desc: 'sent | opened | completed | declined' }
      ],
      curl: `curl --location '${origin}/api/submitters?status=completed' \\
  --header 'X-Auth-Token: YOUR_API_KEY'`,
      python: `requests.get("${origin}/api/submitters?status=completed", headers={"X-Auth-Token": "YOUR_API_KEY"})`,
      javascript: `await fetch('${origin}/api/submitters?status=completed', { headers: { 'X-Auth-Token': 'YOUR_API_KEY' } });`,
      response: {
        data: [
          { id: 881, name: 'Sarah Connor', email: 'sarah@cyberdyne.com', status: 'completed' }
        ]
      }
    },
    {
      id: 'update-submitter',
      category: 'submitters',
      method: 'PUT',
      path: '/api/submitters/{id}',
      title: 'Update submitter info',
      description: 'Update the email address, prefilled values, or phone number of a pending signer.',
      params: [
        { name: 'id', type: 'integer', required: true, desc: 'Submitter ID.' },
        { name: 'email', type: 'string', required: false, desc: 'New email address.' },
        { name: 'values', type: 'object', required: false, desc: 'Key-value pairs to pre-fill.' }
      ],
      curl: `curl --location --request PUT '${origin}/api/submitters/881' \\
  --header 'X-Auth-Token: YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{ "email": "sarah.new@cyberdyne.com" }'`,
      python: `requests.put("${origin}/api/submitters/881", headers={"X-Auth-Token": "YOUR_API_KEY"}, json={"email": "sarah.new@cyberdyne.com"})`,
      javascript: `await fetch('${origin}/api/submitters/881', { method: 'PUT', headers: { 'X-Auth-Token': 'YOUR_API_KEY', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sarah.new@cyberdyne.com' }) });`,
      response: { id: 881, email: 'sarah.new@cyberdyne.com', status: 'updated' }
    },

    // ----------------------------------------------------
    // WEBHOOKS
    // ----------------------------------------------------
    {
      id: 'webhook-events',
      category: 'webhooks',
      method: 'EVENT',
      path: 'POST https://your-server.com/webhook',
      title: 'Webhook Event Notifications',
      description: 'Docurama dispatches signed HTTP POST events when documents and submissions change state.',
      params: [
        { name: 'event_type', type: 'string', required: true, desc: 'submission.created | submission.completed | form.started | form.completed' },
        { name: 'X-Docurama-Signature', type: 'header', required: true, desc: 'HMAC-SHA256 signature calculated with your Webhook Secret.' }
      ],
      curl: `# Signature Verification Example (Python):
import hmac, hashlib

def verify_signature(payload_body, signature_header, secret):
    expected = hmac.new(secret.encode(), payload_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)`,
      python: `# Handling the webhook payload:
@app.post("/webhook")
async def handle_docurama_webhook(request: Request):
    payload = await request.json()
    event = payload.get("event_type")
    if event == "submission.completed":
        submission_id = payload["data"]["id"]
        print(f"Document {submission_id} has been fully signed and sealed!")`,
      javascript: `// Express.js Webhook Handler
app.post('/webhook', (req, res) => {
  const event = req.body.event_type;
  if (event === 'submission.completed') {
    console.log('Document signed:', req.body.data.id);
  }
  res.status(200).send('OK');
});`,
      response: {
        event_type: 'submission.completed',
        timestamp: '2026-09-07T11:45:00Z',
        data: {
          id: 4012,
          template_id: 101,
          status: 'completed',
          submitters: [
            { name: 'Sarah Connor', email: 'sarah@cyberdyne.com', completed_at: '2026-09-07T11:44:12Z' }
          ],
          download_url: `${origin}/api/submissions/4012/documents`
        }
      }
    }
  ];

  const filteredEndpoints = endpoints.filter((ep) => {
    const matchesCategory = selectedCategory === 'all' || ep.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === '' ||
      ep.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className={`w-full ${embedded ? 'pt-2' : 'max-w-6xl mx-auto px-4 py-8'}`}>
      {/* Header Banner if standalone */}
      {!embedded && (
        <div className="mb-8">
          <div className="text-xs font-semibold text-[#5645d4] tracking-wider uppercase mb-2">
            REST API &bull; Cryptographic Protocols
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#1a1a1a] tracking-tight">
            API Reference &amp; Integration Guide
          </h1>
          <p className="text-xs text-[#5d5b54] mt-1.5 max-w-3xl leading-relaxed">
            Complete documentation for programmatic document signing, template management, automated dispatch sequences, and real-time webhook listeners.
          </p>
        </div>
      )}

      {/* Quick Info & Authentication Card */}
      <div className="bg-white rounded-lg p-5 border border-[#e5e3df] mb-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider">BASE URL</span>
            <div className="font-mono text-xs bg-[#f6f5f4] p-2.5 rounded-md border border-[#e5e3df] text-[#1a1a1a] select-all">
              {`${origin}/api`}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider">AUTHENTICATION HEADER</span>
            <div className="font-mono text-xs bg-[#f6f5f4] p-2.5 rounded-md border border-[#e5e3df] text-[#1a1a1a] select-all">
              X-Auth-Token: YOUR_API_KEY
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider">PAYLOAD ENCODING</span>
            <div className="font-mono text-xs bg-[#f6f5f4] p-2.5 rounded-md border border-[#e5e3df] text-[#1a1a1a]">
              application/json; charset=utf-8
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Controls & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'templates', label: 'Templates', icon: FileText },
            { id: 'submissions', label: 'Submissions', icon: Send },
            { id: 'submitters', label: 'Submitters', icon: Users },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook },
            { id: 'all', label: 'All Endpoints', icon: Layers }
          ].map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-[#000000] text-white shadow-sm'
                    : 'bg-white text-[#5d5b54] hover:text-[#1a1a1a] border border-[#e5e3df] hover:bg-[#f6f5f4]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="w-3.5 h-3.5 text-[#787671] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter endpoints..."
            className="base-input pl-10 pr-3 h-9 text-xs w-full bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4]"
          />
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-4">
        {filteredEndpoints.map((ep) => {
          const isExpanded = !!expandedEndpoints[ep.id];
          const badgeClass =
            ep.method === 'GET'
              ? 'bg-[#dcecfa] text-[#0075de]'
              : ep.method === 'POST'
              ? 'bg-[#d9f3e1] text-[#1aae39]'
              : ep.method === 'PUT'
              ? 'bg-[#ffe8d4] text-[#dd5b00]'
              : ep.method === 'DELETE'
              ? 'bg-[#fde0ec] text-[#e03131]'
              : 'bg-[#e6e0f5] text-[#5645d4]';

          return (
            <div
              key={ep.id}
              className="bg-white rounded-lg border border-[#e5e3df] shadow-sm overflow-hidden transition-all"
            >
              {/* Endpoint Header Bar */}
              <div
                onClick={() => toggleEndpoint(ep.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#fafaf9] select-none transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-mono text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${badgeClass}`}
                    >
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-semibold text-[#1a1a1a]">
                      {ep.path}
                    </span>
                  </div>
                  <span className="text-xs text-[#5d5b54] font-normal sm:border-l sm:border-[#e5e3df] sm:pl-4">
                    {ep.title}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[#787671]">
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180 text-[#1a1a1a]' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Endpoint Body */}
              {isExpanded && (
                <div className="p-4 sm:p-6 border-t border-[#e5e3df] bg-[#fafaf9] space-y-6">
                  <p className="text-xs text-[#37352f] leading-relaxed font-normal">{ep.description}</p>

                  {/* Parameters Table */}
                  {ep.params && ep.params.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider mb-2.5">
                        PARAMETERS
                      </h4>
                      <div className="rounded-lg border border-[#e5e3df] bg-white overflow-hidden shadow-xs">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#f6f5f4] text-[11px] font-semibold text-[#787671] border-b border-[#e5e3df]">
                            <tr>
                              <th className="py-2.5 px-3 font-medium">Field</th>
                              <th className="py-2.5 px-3 font-medium">Type</th>
                              <th className="py-2.5 px-3 font-medium">Required</th>
                              <th className="py-2.5 px-3 font-medium">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e5e3df]">
                            {ep.params.map((p, idx) => (
                              <tr key={idx} className="hover:bg-[#fafaf9]">
                                <td className="py-2.5 px-3 font-mono text-[#1a1a1a] font-medium">
                                  {p.name}
                                </td>
                                <td className="py-2.5 px-3 text-[#0075de] font-mono text-[11px]">
                                  {p.type}
                                </td>
                                <td className="py-2.5 px-3">
                                  {p.required ? (
                                    <span className="text-[#dd5b00] font-mono text-[10px] font-semibold">REQUIRED</span>
                                  ) : (
                                    <span className="text-[#787671] font-mono text-[10px]">OPTIONAL</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-[#37352f]">{p.desc}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Code Snippet & Response Preview */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Left: Request Snippet */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider">REQUEST</span>
                          <div className="flex rounded-full bg-[#0a1530] p-0.5 border border-[#1a2a52] text-[10px]">
                            {(['curl', 'python', 'javascript'] as const).map((l) => (
                              <button
                                key={l}
                                onClick={() => setActiveLang(l)}
                                className={`px-2.5 py-0.5 rounded-full font-mono uppercase transition-all ${
                                  activeLang === l
                                    ? 'bg-[#5645d4] text-white shadow-xs'
                                    : 'text-[#a4a097] hover:text-white'
                                }`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(ep[activeLang], `${ep.id}-${activeLang}`)}
                          className="btn btn-ghost px-2.5 py-1 text-xs flex items-center gap-1 text-[#5d5b54] hover:text-[#1a1a1a] rounded-md"
                        >
                          {copiedSnippet === `${ep.id}-${activeLang}` ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#1aae39]" />
                              <span className="text-[#1aae39]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="bg-[#0a1530] rounded-lg p-3.5 overflow-x-auto text-xs font-mono text-white border border-[#1a2a52] leading-relaxed max-h-72">
                        <pre>{ep[activeLang]}</pre>
                      </div>
                    </div>

                    {/* Right: Response Payload */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider">
                          RESPONSE (200 OK)
                        </span>
                        <button
                          onClick={() =>
                            copyToClipboard(JSON.stringify(ep.response, null, 2), `${ep.id}-res`)
                          }
                          className="btn btn-ghost px-2.5 py-1 text-xs flex items-center gap-1 text-[#5d5b54] hover:text-[#1a1a1a] rounded-md"
                        >
                          {copiedSnippet === `${ep.id}-res` ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#1aae39]" />
                              <span className="text-[#1aae39]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="bg-[#0a1530] rounded-lg p-3.5 overflow-x-auto text-xs font-mono text-white border border-[#1a2a52] leading-relaxed max-h-72">
                        <pre>{JSON.stringify(ep.response, null, 2)}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
