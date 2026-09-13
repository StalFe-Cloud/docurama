/**
 * Legal content — final launch (PART L).
 *
 * Single source of truth for the legal entity presentation and the four
 * published legal documents. When Docurama SAS is formally registered, only
 * LEGAL_ENTITY below needs to change — no architectural changes, no page
 * rewrites. Until then, registration fields stay empty and the pages say so
 * honestly instead of inventing identifiers.
 *
 * Every claim here describes actual platform behaviour (trial, Fair Exit,
 * subprocessors, self-host restriction). Nothing claims certification,
 * qualified status, or legal guarantee — see the vocabulary guard.
 */

export const LEGAL_ENTITY = {
  brand: 'DOCURAMA',
  product_of: 'STALFE',
  address_lines: ['1 Rue Marguerin', '75014 Paris', 'France'],
  contact_email: 'sales@docurama.eu',
  privacy_email: 'sales@docurama.eu',
  security_email: 'security@docurama.eu',
  // Published only when non-empty (formal registration later).
  siren: '',
  siret: '',
  vat: '',
  rcs: '',
  registration_note:
    'Company registration identifiers (SIREN, SIRET, RCS, VAT) will be published on this page once Docurama SAS is formally registered. No identifier is claimed before it exists.',
  publishing_director: 'STALFE — Docurama',
  dmca_agent:
    'DMCA and TAKE IT DOWN notices are accepted through the public intake endpoints (POST /api/legal/dmca and POST /api/legal/take-it-down) and are routed to the platform administrators. The designated agent contact is the address above; registration details are published here as they are completed.',
};

export interface LegalDoc {
  id: 'terms' | 'privacy' | 'dpa' | 'imprint';
  title: string;
  updated: string;
  sections: Array<{ h: string; ps: string[]; list?: string[] }>;
}

const ENTITY_LINE = `${LEGAL_ENTITY.brand}, a product of ${LEGAL_ENTITY.product_of}, ${LEGAL_ENTITY.address_lines.join(', ')}.`;

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: 'terms',
    title: 'Terms of Service',
    updated: 'Launch edition',
    sections: [
      {
        h: '1. Who provides Docurama',
        ps: [
          `Docurama is operated by ${ENTITY_LINE} These Terms govern your use of the Docurama cloud service at app.docurama.eu and the public website at docurama.eu.`,
          'By creating an account you accept these Terms. If you use Docurama on behalf of an organisation, you confirm you are authorised to bind it.',
        ],
      },
      {
        h: '2. Accounts and the 14-day trial',
        ps: [
          'Every new cloud workspace starts with a 14-day trial of the Plus plan. No credit card is required, and there is no permanent free tier.',
          'After the trial ends, the account becomes read-only: your documents, envelopes, templates, and audit trails remain fully viewable and exportable, but sending new envelopes and other writes that consume paid entitlements are disabled until you upgrade. We never delete your signing evidence because a trial expired.',
        ],
      },
      {
        h: '3. Plans and billing',
        ps: [
          'Cloud plans: Plus at €19 per month (or €15 per month when billed annually at €180), and Business Team at €49 per month (or €39 per month when billed annually at €468), which includes 3 seats; additional seats cost €15 per month each. Enterprise pricing is custom, sales-led, with a reference starting point of €1,500 per year.',
          'Billing cycles run 35 days: twelve billed cycles cover 420 days of service — 55 days more than a calendar year. Annual billing charges twelve such cycles in advance.',
          'Enterprise customers choose a deployment model — Managed Public Cloud, Managed Private Cloud, On-Premises, or Air-Gapped where technically appropriate — as part of their contract. Self-hosted deployment is available exclusively under an Enterprise agreement and is never a free alternative to a cloud plan.',
        ],
      },
      {
        h: '4. The Fair Exit Guarantee',
        ps: [
          'On annual billing, if you end your subscription early, every unused full 35-day cycle refunds to your original payment method, pro-rata at your committed per-cycle rate — self-serve, in one click. The cycle in progress always runs its course: you keep full access for the days you have already paid for.',
          'On monthly billing, nothing beyond the current cycle is pre-paid, so cancelling simply runs coverage to the end of the paid cycle. There are no retention phone calls and no exit penalties.',
        ],
      },
      {
        h: '5. Your content and signing evidence',
        ps: [
          'You keep all rights to the documents you upload and send through Docurama. We store and process them only to provide the service.',
          'Signed documents carry a cryptographic seal (PAdES with X.509 certificates), an RFC 3161 timestamp, and an audit trail. Completed envelopes and their audit evidence are retained even when your subscription lapses, so verification of documents you have issued keeps working.',
          'You must not use Docurama to send unlawful content, to mislead signers about what they are signing, or to infringe the rights of others.',
        ],
      },
      {
        h: '6. Availability and support',
        ps: [
          'We work continuously to keep the service available and secure. Contractual service-level agreements are offered only where an Enterprise contract explicitly provides them; we do not promise an SLA that no contract supports.',
          'Business Team and Enterprise plans include priority or dedicated support as described on the pricing page.',
        ],
      },
      {
        h: '7. Notices, copyright and takedown',
        ps: [
          'Copyright and content notices are handled through our public DMCA and TAKE IT DOWN intake, described on the Imprint page. Reported material can be disabled pending resolution, and counter-notices are processed under the published service levels.',
        ],
      },
      {
        h: '8. Termination and changes',
        ps: [
          'You can cancel at any time from your account; the Fair Exit Guarantee above applies. We may suspend accounts for unlawful use or non-payment after notice.',
          'If we change these Terms materially, we notify account holders in advance through the service or by email.',
        ],
      },
      {
        h: '9. Governing law',
        ps: [
          'These Terms are governed by French law. Disputes fall under the jurisdiction of the courts of Paris, France, unless mandatory consumer law assigns otherwise. Statutory consumer rights are unaffected.',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Notice',
    updated: 'Launch edition',
    sections: [
      {
        h: '1. Who is responsible',
        ps: [
          `${ENTITY_LINE} is responsible for the processing of personal data described in this notice. Contact: ${LEGAL_ENTITY.privacy_email}.`,
        ],
      },
      {
        h: '2. What we process and why',
        ps: [
          'Account data (name, email, password hash, role, workspace settings) to provide and secure the service — performance of the contract.',
          'Document and envelope data (uploaded PDFs, recipient names and emails, signing status, audit events, IP addresses captured for signature evidence) to deliver the signing workflow and produce verifiable evidence — performance of the contract.',
          'Billing data (subscription state through our payment processor; we do not store card numbers) to manage subscriptions — performance of the contract.',
          'Email delivery logs (whether service messages were accepted, and why not) to operate notifications and diagnose delivery — legitimate interest.',
          'Marketing consent (recorded only when explicitly given, with its timestamp) — consent, withdrawable at any time.',
        ],
      },
      {
        h: '3. Processors and subprocessors',
        ps: [
          'We engage processors to operate the service: EU hosting for application and storage, a payment processor for subscription billing, transactional email delivery, and a timestamp authority that receives only a document hash for RFC 3161 timestamping — never the document itself.',
          'The authoritative, current list of subprocessors with their roles and data locations is published in the Trust Center. Where a processor stores or accesses data outside the European Economic Area, transfers rely on the European Commission\'s Standard Contractual Clauses and additional safeguards where required.',
        ],
      },
      {
        h: '4. Where data lives',
        ps: [
          'Application and document storage are hosted in European data centres by default. The Trust Center subprocessor registry is the source of truth for locations; we publish what is true rather than blanket claims, and Enterprise contracts can constrain residency further.',
        ],
      },
      {
        h: '5. Retention',
        ps: [
          'Account data is kept while your account is active. Expired trials never trigger deletion: documents, envelopes, templates, and audit trails are retained read-only until you upgrade or request deletion.',
          'Audit evidence for signed envelopes is retained so that verification of issued documents keeps working. You can request deletion of your workspace data; statutory retention obligations (for example, billing records) take precedence where they apply.',
        ],
      },
      {
        h: '6. Your rights',
        ps: [
          'You can access, correct, export, and delete your personal data, and object to or restrict processing. Workspace administrators can export data directly from the product; you can also exercise rights through the platform or by writing to us.',
          'You have the right to lodge a complaint with a supervisory authority, in particular the CNIL in France.',
        ],
      },
      {
        h: '7. Cookies',
        ps: [
          'We use a single session cookie for authentication (HttpOnly, scoped to the application origin) and store interface preferences locally in your browser. We do not run advertising or cross-site tracking cookies.',
        ],
      },
      {
        h: '8. Changes',
        ps: [
          'We publish material changes to this notice in the service before they take effect. The Trust Center reflects the current subprocessor list at all times.',
        ],
      },
    ],
  },
  {
    id: 'dpa',
    title: 'Data Processing Agreement (DPA)',
    updated: 'Launch edition',
    sections: [
      {
        h: '1. Roles and scope',
        ps: [
          'This DPA is incorporated into the Terms of Service and applies where Docurama processes personal data on behalf of a customer who acts as controller (' + LEGAL_ENTITY.brand + ' acting as processor). It covers the document, envelope, recipient, and audit data the customer directs us to process in order to provide the service.',
        ],
      },
      {
        h: '2. Processing instructions',
        ps: [
          'We process personal data only on the customer\'s documented instructions (configuration of envelopes, recipients, templates, retention, and workspace settings in the product), unless EU or Member State law requires otherwise. Informing us of a change of instructions is done through workspace configuration or written notice.',
        ],
      },
      {
        h: '3. Confidentiality and personnel',
        ps: [
          'Personnel authorised to process personal data are bound by confidentiality obligations and access is restricted to what service operation requires. Access reviews are part of the platform\'s compliance programme.',
        ],
      },
      {
        h: '4. Security',
        ps: [
          'We maintain technical and organisational measures appropriate to the risk: encryption of documents at rest, TLS in transit, hashed credentials and API keys, structured and secret-free logging, tenant isolation enforced server-side and tested adversarially, and hash-chained security event records. The Trust Center describes the implemented measures factually rather than aspirationally.',
        ],
      },
      {
        h: '5. Subprocessors',
        ps: [
          'The customer authorises the subprocessors published in the Trust Center registry. We notify customers of intended additions or replacements through that registry\'s change process in advance, giving the opportunity to object on reasonable data-protection grounds. Where a subprocessor is outside the EEA, Standard Contractual Clauses apply as stated in the Privacy Notice.',
        ],
      },
      {
        h: '6. Data subject requests and assistance',
        ps: [
          'We assist the controller in responding to data subject requests (access, rectification, erasure, portability, restriction) where the controller cannot fulfil a request itself. Workspace administrators can export account data directly from the product at any time.',
        ],
      },
      {
        h: '7. Personal data breach',
        ps: [
          'We notify the controller without undue delay after becoming aware of a personal data breach affecting the customer\'s data, with the information available to support the controller\'s own notification obligations. Security incidents are recorded and progressed in the platform\'s incident register with computed deadlines.',
        ],
      },
      {
        h: '8. Return and deletion',
        ps: [
          'On termination, the customer can export their data. Deletion of account data follows the retention rules in the Privacy Notice; audit evidence tied to issued documents can be retained so that verification keeps working, as recorded in the workspace\'s retention configuration.',
        ],
      },
      {
        h: '9. Documentation and audit',
        ps: [
          'We make available the documentation reasonably required to demonstrate compliance — the Trust Center publication, this DPA, and the security contact for further requests. Enterprise agreements can add audit rights by contract.',
        ],
      },
    ],
  },
  {
    id: 'imprint',
    title: 'Imprint / Legal notice',
    updated: 'Launch edition',
    sections: [
      {
        h: 'Publisher',
        ps: [
          `${LEGAL_ENTITY.brand} — a product of ${LEGAL_ENTITY.product_of}.`,
          LEGAL_ENTITY.address_lines.join(', ') + '.',
          `Contact: ${LEGAL_ENTITY.contact_email}`,
          `Publishing director: ${LEGAL_ENTITY.publishing_director}.`,
        ],
      },
      {
        h: 'Company registration',
        ps: [LEGAL_ENTITY.registration_note],
      },
      {
        h: 'Hosting',
        ps: [
          'The production service is hosted in European data centres; the current hosting provider and subprocessor set is published in the Trust Center.',
        ],
      },
      {
        h: 'DMCA agent and takedown',
        ps: [LEGAL_ENTITY.dmca_agent],
      },
      {
        h: 'Platform descriptions on this site',
        ps: [
          'Docurama describes its technical implementation — PAdES signatures, X.509 certificates, RFC 3161 timestamping, cryptographic verification, tamper-evident evidence. We do not claim certification, qualified status for the platform, or legal effect beyond what the underlying technology and law actually provide.',
        ],
      },
    ],
  },
];
