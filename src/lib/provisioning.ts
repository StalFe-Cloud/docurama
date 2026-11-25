/**
 * Docurama platform provisioning catalog — docurama.eu.
 * Docurama is a flagship product engineered and operated by VOIRIA (VOIRIA SASU).
 *
 * Single source of truth for:
 *  - Company identity: VOIRIA SASU, 1 Rue Marguerin, Paris, Île-de-France 75014, France.
 *    SIREN 131 914 012, SIRET 131 914 012 00011, RCS Paris, VAT FR90131914012.
 *  - The 12 role-based email addresses (transactional, business, legal/privacy,
 *    RFC 5321/2142 standards) with mailbox vs alias semantics.
 *  - Every DNS sub-domain on docurama.eu and its purpose.
 *  - The full DNS record set for GDPR/eIDAS/RFC-compliant mail deliverability
 *    (MX, SPF, DKIM, DMARC, MTA-STS, TLS-RPT, CAA) and the BIND zone export.
 */

export interface CompanyIdentity {
  legalName: string;
  productName: string;
  productRelationship: string;
  address: string;
  country: string;
  registrationNumber: string;
  siren: string;
  siret: string;
  rcs: string;
  vatNumber: string;
  shareCapital: string;
  dpoEmail: string;
  legalEmail: string;
  securityEmail: string;
  adminEmail: string;
  contactEmail: string;
  phone: string;
  dataResidency: string;
  officialRegistryUrl: string;
  websiteUrl: string;
}

export const COMPANY: CompanyIdentity = {
  legalName: "VOIRIA SASU",
  productName: "Docurama",
  productRelationship: "Docurama is a product of VOIRIA",
  address: "1 Rue Marguerin, 75014 Paris, France",
  country: "France",
  registrationNumber: "131 914 012 R.C.S. Paris (SIRET 131 914 012 00011)",
  siren: "131 914 012",
  siret: "131 914 012 00011",
  rcs: "Paris",
  vatNumber: "FR90131914012",
  shareCapital: "Société par Actions Simplifiée Unipersonnelle (SASU)",
  dpoEmail: "legal@voiria.com",
  legalEmail: "legal@voiria.com",
  securityEmail: "technology@voiria.com",
  adminEmail: "admin@docurama.eu",
  contactEmail: "contact@voiria.com",
  phone: "+33 1 42 68 53 00",
  dataResidency: "EU (Paris / EU-West)",
  officialRegistryUrl: "https://annuaire-entreprises.data.gouv.fr/entreprise/voiria-voir-ia-131914012",
  websiteUrl: "https://voiria.com",
};

export type EmailKind = "MAILBOX_SMTP" | "MAILBOX" | "SHARED_INBOX" | "ALIAS" | "REPORTS";
export type EmailCategory =
  | "Transactional & System"
  | "Business & Support"
  | "Legal, Privacy & Compliance"
  | "RFC Standards & Reputation";

export interface EmailAccount {
  address: string;
  displayName: string;
  kind: EmailKind;
  category: EmailCategory;
  purpose: string;
  forwardsTo?: string;
  rfc?: string;
  priority: "P0" | "P1" | "P2";
  notes?: string;
  provisioned: boolean;
}

export const EMAIL_ACCOUNTS: EmailAccount[] = [
  // 1 — Essential transactional & system
  {
    address: "notifications@docurama.eu",
    displayName: "Docurama Sign",
    kind: "MAILBOX_SMTP",
    category: "Transactional & System",
    purpose:
      "Outbound signing invitations, OTPs, verification emails, completion certificates, envelope audit events and password resets. Configured in Platform Settings → SMTP.",
    rfc: "SMTP submission",
    priority: "P0",
    notes: "Sender identity: “Docurama Sign <notifications@docurama.eu>” for deliverability and trust. Real mailbox with SMTP credentials.",
    provisioned: true,
  },
  {
    address: "admin@docurama.eu",
    displayName: "Docurama Administration",
    kind: "MAILBOX",
    category: "Transactional & System",
    purpose:
      "Platform administrator alerts, database/certificate expiry warnings, security ledger notices and system bootstrap.",
    forwardsTo: "docurama@voiria.com",
    priority: "P0",
    notes: "Primary administrator address. Forwards to VOIRIA platform ops (docurama@voiria.com).",
    provisioned: true,
  },
  // 2 — Business, sales & support
  {
    address: "support@docurama.eu",
    displayName: "Docurama Support",
    kind: "SHARED_INBOX",
    category: "Business & Support",
    purpose: "Customer technical support, user inquiries and onboarding assistance.",
    forwardsTo: "support@voiria.com",
    priority: "P1",
    notes: "Real mailbox or shared inbox (support team).",
    provisioned: true,
  },
  {
    address: "sales@docurama.eu",
    displayName: "Docurama Sales",
    kind: "ALIAS",
    category: "Business & Support",
    purpose: "Enterprise sales inquiries, custom self-hosted deployments and high-volume quota requests.",
    forwardsTo: "enterprise@voiria.com",
    priority: "P1",
    provisioned: true,
  },
  {
    address: "billing@docurama.eu",
    displayName: "Docurama Billing",
    kind: "ALIAS",
    category: "Business & Support",
    purpose: "Invoices, VAT receipts, payment notifications and subscription inquiries.",
    forwardsTo: "admin@docurama.eu",
    priority: "P1",
    provisioned: true,
  },
  {
    address: "contact@docurama.eu",
    displayName: "Docurama Contact",
    kind: "ALIAS",
    category: "Business & Support",
    purpose: "General inquiries, partnership requests and website contact-form fallback.",
    forwardsTo: "contact@voiria.com",
    priority: "P2",
    notes: "hello@docurama.eu reserved as an equivalent alias.",
    provisioned: true,
  },
  // 3 — Legal, privacy & compliance (GDPR / eIDAS)
  {
    address: "privacy@docurama.eu",
    displayName: "Docurama Privacy (DPO)",
    kind: "ALIAS",
    category: "Legal, Privacy & Compliance",
    purpose: "GDPR data subject requests (DSAR/DSR — access, erasure, portability and export).",
    forwardsTo: "legal@voiria.com",
    rfc: "GDPR Art. 13/14, Art. 30",
    priority: "P0",
    notes: "Directly forwards to VOIRIA Legal & DPO (legal@voiria.com).",
    provisioned: true,
  },
  {
    address: "legal@docurama.eu",
    displayName: "Docurama Legal",
    kind: "ALIAS",
    category: "Legal, Privacy & Compliance",
    purpose: "Contract notices, terms updates, DPA requests and DMCA / IP claims.",
    forwardsTo: "legal@voiria.com",
    priority: "P0",
    notes: "Forwards to VOIRIA Legal & Compliance (legal@voiria.com).",
    provisioned: true,
  },
  {
    address: "security@docurama.eu",
    displayName: "Docurama Security",
    kind: "ALIAS",
    category: "Legal, Privacy & Compliance",
    purpose:
      "Vulnerability disclosures, RFC 9116 security.txt contact, incident notifications and SOC/ISO compliance.",
    forwardsTo: "technology@voiria.com",
    rfc: "RFC 9116 §2.5.5",
    priority: "P0",
    notes: "Listed in docurama.eu/.well-known/security.txt. Forwards to VOIRIA DeepTech & Security (technology@voiria.com).",
    provisioned: true,
  },
  // 4 — RFC standards & mail reputation
  {
    address: "postmaster@docurama.eu",
    displayName: "Postmaster",
    kind: "ALIAS",
    category: "RFC Standards & Reputation",
    purpose: "RFC 5321 mandatory SMTP administrative mailbox for delivery issues and bounce handling.",
    forwardsTo: "admin@docurama.eu",
    rfc: "RFC 5321 §4.5.1",
    priority: "P0",
    notes: "Mandatory for every internet mail domain.",
    provisioned: true,
  },
  {
    address: "abuse@docurama.eu",
    displayName: "Abuse Desk",
    kind: "ALIAS",
    category: "RFC Standards & Reputation",
    purpose: "RFC 2142 mandatory address for spam complaints, phishing reports and network abuse.",
    forwardsTo: "security@docurama.eu",
    rfc: "RFC 2142 §4",
    priority: "P0",
    notes: "Protects IP/domain reputation on spam lists.",
    provisioned: true,
  },
  {
    address: "dmarc@docurama.eu",
    displayName: "DMARC Aggregated Reports",
    kind: "REPORTS",
    category: "RFC Standards & Reputation",
    purpose:
      "Receives XML aggregate (rua) and forensic (ruf) reports from recipient mail servers (Google, Microsoft, Yahoo).",
    rfc: "RFC 7489 §6.3",
    priority: "P1",
    notes: "Target of rua=mailto:dmarc@docurama.eu in the DMARC TXT record.",
    provisioned: true,
  },
];

export interface Subdomain {
  host: string;
  fqdn: string;
  purpose: string;
  recordType: "A" | "AAAA" | "CNAME";
  target: string;
  audience: string;
  env: string;
  tls: string;
  live: boolean;
}

export const SUBDOMAINS: Subdomain[] = [
  {
    host: "@",
    fqdn: "docurama.eu",
    purpose: "Apex domain - marketing site, pricing, eIDAS compliance docs, public legal pages",
    recordType: "A",
    target: "51.75.20.14 (OVH Gravelines, France)",
    audience: "Public",
    env: "Production",
    tls: "TLS 1.3 (Let's Encrypt / Cloudflare)",
    live: true,
  },
  {
    host: "www",
    fqdn: "www.docurama.eu",
    purpose: "Web redirect to apex (docurama.eu)",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Public",
    env: "Production",
    tls: "TLS 1.3",
    live: true,
  },
  {
    host: "app",
    fqdn: "app.docurama.eu",
    purpose: "User workspace & document portal - compose, send, sign, review, audit log",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Registered users",
    env: "Production",
    tls: "TLS 1.3 · HSTS 1yr",
    live: true,
  },
  {
    host: "verify",
    fqdn: "verify.docurama.eu",
    purpose:
      "Public cryptographic verification surface - zero-login check of document hashes, PAdES seals and audit certificates",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Public",
    env: "Production",
    tls: "TLS 1.3 · public",
    live: true,
  },
  {
    host: "api",
    fqdn: "api.docurama.eu",
    purpose:
      "Public REST API for enterprise integrations, webhooks, envelope dispatch and verification queries",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "API consumers",
    env: "Production",
    tls: "TLS 1.3 · Bearer auth",
    live: true,
  },
  {
    host: "admin",
    fqdn: "admin.docurama.eu",
    purpose:
      "Platform administrator console - tenant oversight, legal holds, compliance audit, billing and DNS provisioning",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Platform Admins",
    env: "Production",
    tls: "TLS 1.3 · 2FA mandatory",
    live: true,
  },
  {
    host: "mail",
    fqdn: "mail.docurama.eu",
    purpose:
      "Dedicated outbound transactional mail relay (Postfix / Haraka) for signing invitations and OTPs",
    recordType: "A",
    target: "51.75.124.20",
    audience: "Mail servers",
    env: "Production",
    tls: "MTA-STS · STARTTLS mandatory",
    live: true,
  },
  {
    host: "mta-sts",
    fqdn: "mta-sts.docurama.eu",
    purpose:
      "MTA Strict Transport Security policy host (RFC 8461) - enforces encrypted inbound SMTP across Europe",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Mail transfer agents",
    env: "Production",
    tls: "Valid HTTPS required by RFC",
    live: true,
  },
  {
    host: "status",
    fqdn: "status.docurama.eu",
    purpose: "Real-time service status, uptime, signing throughput and incident history",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Public",
    env: "Production",
    tls: "TLS 1.3",
    live: true,
  },
  {
    host: "docs",
    fqdn: "docs.docurama.eu",
    purpose: "Developer documentation, API reference, webhook guides and SDK downloads",
    recordType: "CNAME",
    target: "docurama.eu",
    audience: "Public",
    env: "Production",
    tls: "TLS 1.3",
    live: true,
  },
  {
    host: "staging",
    fqdn: "staging.docurama.eu",
    purpose:
      "Pre-production staging environment for testing new signing releases and eIDAS conformance",
    recordType: "A",
    target: "51.75.20.15",
    audience: "Internal QA",
    env: "Staging",
    tls: "TLS 1.3 · Basic auth gate",
    live: false,
  },
];

export interface DnsRecord {
  id: string;
  group: "MX" | "SPF" | "DKIM" | "DMARC" | "MTA-STS" | "TLS-RPT" | "CAA" | "PTR";
  name: string;
  type: "MX" | "TXT" | "CNAME" | "CAA" | "PTR";
  value: string;
  priority?: number;
  ttl: number;
  purpose: string;
  rfc?: string;
  verified: boolean;
}

export const DNS_RECORDS: DnsRecord[] = [
  {
    id: "mx-primary",
    group: "MX",
    name: "docurama.eu",
    type: "MX",
    priority: 10,
    value: "mail.docurama.eu",
    ttl: 3600,
    purpose: "Primary inbound mail exchanger",
    rfc: "RFC 5321",
    verified: true,
  },
  {
    id: "mx-backup",
    group: "MX",
    name: "docurama.eu",
    type: "MX",
    priority: 20,
    value: "mail-backup.docurama.eu",
    ttl: 3600,
    purpose: "Secondary backup mail exchanger",
    rfc: "RFC 5321",
    verified: true,
  },
  {
    id: "spf",
    group: "SPF",
    name: "docurama.eu",
    type: "TXT",
    value: "v=spf1 ip4:51.75.124.20 include:spf.docurama.eu -all",
    ttl: 3600,
    purpose: "Sender Policy Framework - hard-fail unauthorized sending hosts",
    rfc: "RFC 7208",
    verified: true,
  },
  {
    id: "dkim-s1",
    group: "DKIM",
    name: "s1._domainkey.docurama.eu",
    type: "CNAME",
    value: "s1.domainkey.docurama.eu",
    ttl: 3600,
    purpose: "Primary 2048-bit RSA DKIM selector for transactional mail",
    rfc: "RFC 6376",
    verified: true,
  },
  {
    id: "dkim-s2",
    group: "DKIM",
    name: "s2._domainkey.docurama.eu",
    type: "CNAME",
    value: "s2.domainkey.docurama.eu",
    ttl: 3600,
    purpose: "Secondary DKIM key for seamless zero-downtime key rotation",
    rfc: "RFC 6376",
    verified: true,
  },
  {
    id: "dmarc",
    group: "DMARC",
    name: "_dmarc.docurama.eu",
    type: "TXT",
    value:
      "v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc@docurama.eu; ruf=mailto:security@docurama.eu; fo=1; aspf=s; adkim=s",
    ttl: 3600,
    purpose: "Strict DMARC reject policy with aggregate and forensic reporting",
    rfc: "RFC 7489",
    verified: true,
  },
  {
    id: "mta-sts-txt",
    group: "MTA-STS",
    name: "_mta-sts.docurama.eu",
    type: "TXT",
    value: "v=STSv1; id=2026112501",
    ttl: 86400,
    purpose: "MTA-STS discovery record enforcing TLS encryption for inbound SMTP",
    rfc: "RFC 8461",
    verified: true,
  },
  {
    id: "tls-rpt",
    group: "TLS-RPT",
    name: "_smtp._tls.docurama.eu",
    type: "TXT",
    value: "v=TLSRPTv1; rua=mailto:security@docurama.eu",
    ttl: 86400,
    purpose: "TLS reporting destination for deliverability and cipher monitoring",
    rfc: "RFC 8460",
    verified: true,
  },
  {
    id: "caa-le",
    group: "CAA",
    name: "docurama.eu",
    type: "CAA",
    value: "0 issue \"letsencrypt.org\"",
    ttl: 3600,
    purpose: "Restrict Certificate Authority issuance to Let's Encrypt",
    rfc: "RFC 8659",
    verified: true,
  },
  {
    id: "caa-ssl",
    group: "CAA",
    name: "docurama.eu",
    type: "CAA",
    value: "0 issue \"sectigo.com\"",
    ttl: 3600,
    purpose: "Secondary CA authorization for enterprise EV/OV certificates",
    rfc: "RFC 8659",
    verified: true,
  },
  {
    id: "caa-iodef",
    group: "CAA",
    name: "docurama.eu",
    type: "CAA",
    value: "0 iodef \"mailto:security@docurama.eu\"",
    ttl: 3600,
    purpose: "Report unauthorized certificate issuance attempts",
    rfc: "RFC 8659",
    verified: true,
  },
  {
    id: "ptr",
    group: "PTR",
    name: "20.124.75.51.in-addr.arpa",
    type: "PTR",
    value: "mail.docurama.eu",
    ttl: 3600,
    purpose: "Reverse DNS for outbound relay IP matching SMTP HELO/EHLO identity",
    rfc: "RFC 1912 §2.1",
    verified: true,
  },
];

export interface ProvisioningState {
  provisionedEmails: string[];
  liveSubdomains: string[];
  verifiedRecords: string[];
}

export const DEFAULT_PROVISIONING_STATE: ProvisioningState = {
  provisionedEmails: EMAIL_ACCOUNTS.map((e) => e.address),
  liveSubdomains: SUBDOMAINS.filter((s) => s.live !== false).map((s) => (s.host === "@" ? "" : s.host)),
  verifiedRecords: DNS_RECORDS.map((r) => r.id),
};

export function buildZoneFile(
  company: CompanyIdentity = COMPANY,
  state: ProvisioningState = DEFAULT_PROVISIONING_STATE,
): string {
  const serial = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01";
  const subLines = SUBDOMAINS.map((s) => {
    const isLive = state.liveSubdomains.includes(s.host === "@" ? "" : s.host);
    const label = s.host === "@" ? "@" : s.host;
    const target =
      s.recordType === "CNAME"
        ? s.target.endsWith(".")
          ? s.target
          : s.target + "."
        : s.target.split(" ")[0];
    return `${label.padEnd(12)} ${s.recordType.padEnd(6)} ${target.padEnd(34)} ; ${isLive ? "LIVE" : "PENDING"} — ${s.purpose}`;
  });
  const mxLines = DNS_RECORDS.filter((r) => r.type === "MX").map(
    (r) =>
      `@            MX     ${String(r.priority).padEnd(4)} ${r.value}.`.padEnd(47) +
      ` ; ${r.purpose}`,
  );
  const txtLines = DNS_RECORDS.filter((r) => r.type === "TXT" && r.group !== "CAA").map(
    (r) =>
      `${(r.name === "docurama.eu" ? "@" : r.name.replace(/\.docurama\.eu$/, "")).padEnd(24)} TXT    "${r.value}"`.padEnd(
        80,
      ) + ` ; ${r.group}${state.verifiedRecords.includes(r.id) ? " [verified]" : ""}`,
  );
  const cnameLines = DNS_RECORDS.filter((r) => r.type === "CNAME" && r.group === "DKIM").map(
    (r) =>
      `${r.name.replace(/\.docurama\.eu$/, "").padEnd(24)} CNAME  ${r.value}.`.padEnd(60) +
      ` ; ${r.purpose}`,
  );
  const caaLines = DNS_RECORDS.filter((r) => r.group === "CAA").map(
    (r) => `@            CAA    ${r.value}`.padEnd(40) + ` ; ${r.purpose}`,
  );

  return `; ─────────────────────────────────────────────────────────────────────────────
; ${company.legalName} — ${company.address}
; Product: ${company.productName} (docurama.eu) — ${company.productRelationship}
; SIREN: ${company.siren} · SIRET: ${company.siret} · RCS: ${company.rcs} · TVA: ${company.vatNumber}
; DNS zone: docurama.eu — generated by the Docurama platform console
; Provisioned: ${new Date().toISOString()}
; ─────────────────────────────────────────────────────────────────────────────
$ORIGIN docurama.eu.
$TTL 3600

@            SOA    ns1.docurama.eu. hostmaster.docurama.eu. (
                    ${serial}   ; serial YYYYMMDDnn
                    7200        ; refresh
                    3600        ; retry
                    1209600     ; expire
                    3600 )      ; negative TTL

; ── Nameservers ──
@            NS     ns1.docurama.eu.
@            NS     ns2.docurama.eu.
ns1          A      51.75.20.14
ns2          A      51.75.20.15

; ── Hosts & sub-domains ──
${subLines.join("\n")}

; ── Mail exchangers ──
${mxLines.join("\n")}

; ── SPF / DMARC / MTA-STS / TLS-RPT (TXT) ──
${txtLines.join("\n")}

; ── DKIM (CNAME to provider) ──
${cnameLines.join("\n")}

; ── Certificate Authority Authorisation ──
${caaLines.join("\n")}

; ── Reverse DNS for the outbound relay ──
; 20.124.75.51.in-addr.arpa. 3600 IN PTR mail.docurama.eu.
`;
}
