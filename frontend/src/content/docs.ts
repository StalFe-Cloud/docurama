import type { Article } from './types';

/**
 * Documentation corpus (Sprint 8). English source of truth; localized
 * field-by-field through the content pipeline (see content/i18n/*.json).
 * Compliance vocabulary guardrail: program/readiness language only.
 */
export const DOCS: Article[] = [
  {
    slug: 'getting-started',
    category: 'Basics',
    title: 'Getting started: your first envelope',
    description: 'Create an envelope, add signers, place fields, and send — the whole path in about five minutes.',
    minutes: 5,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'An <strong>envelope</strong> is the container for everything you send out for signature: the documents, the people who sign, the order they sign in, and every field they complete. You work with envelopes on the Templates and Submissions pages, and Docurama tracks each one through a defined lifecycle so you always know where an agreement stands.',
      },
      { h2: '1. Start from a blank envelope or a template' },
      {
        p: 'From the workspace, choose <strong>New Document</strong>. A blank envelope opens the builder with an upload slot; picking a template instead pre-loads the documents and fields an earlier you (or our gallery) already wired up. Templates are the fastest route once you send anything twice.',
      },
      { h2: '2. Add documents and signers' },
      {
        p: 'Upload PDFs — they stay in EU storage, encrypted at rest with AES-GCM. Then add signers by email. Each signer gets a role, and roles matter: the signing order you define is the order Docurama enforces, and every routing decision is recorded on the audit trail.',
      },
      { h2: '3. Place the fields' },
      {
        p: 'Drag signature, date, text, and checkbox fields onto the page. Fields snap to sensible defaults (a full-width signature line, an auto-filled signing date). The builder shows you a live preview of exactly what each signer will see on their phone or laptop.',
      },
      { h2: '4. Send and track' },
      {
        p: 'Hit send. Signers receive a secure link (email or OTP channel, depending on your plan). The Submissions page shows live status — sent, viewed, signed, sealed — and gentle reminders go out automatically unless you switch them off. When the last signature lands, Docurama seals the envelope and your audit evidence is complete.',
      },
      {
        callout: 'Next: read "The envelope lifecycle" to see every state your envelope passes through, or browse the template gallery to skip setup entirely.',
      },
    ],
  },
  {
    slug: 'signing-fields',
    category: 'Basics',
    title: 'Signing fields and how they map into the PDF',
    description: 'What each field type does, where it lands in the sealed PDF, and why placement is recorded.',
    minutes: 6,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Fields are the interactive spots you place on a document. Each field belongs to a signer role, and each one becomes a visible, positioned element in the final sealed PDF. Docurama supports the field types below.',
      },
      { h2: 'Field types' },
      {
        list: [
          '<strong>Signature</strong> — drawn, typed, or uploaded image; rendered with the signer\u2019s identity line underneath.',
          '<strong>Date signed</strong> — auto-filled at the moment of signing in the signer\u2019s timezone; you never chase someone for a forgotten date.',
          '<strong>Text</strong> — single-line input for names, reference numbers, or short clauses; optional validation patterns.',
          '<strong>Checkbox</strong> — consent ticks and acknowledgements; every tick is timestamped.',
          '<strong>Stamp</strong> — workspace stamp images (company seals, approval marks) placed like any other field.',
        ],
      },
      { h2: 'How fields become part of the signed PDF' },
      {
        p: 'When a signer completes their part, Docurama renders the field values into the PDF exactly where you placed them. The signature field additionally carries the cryptographic signature object — this is what makes the file a PAdES document rather than a PDF with a picture of a signature on it.',
      },
      { h2: 'Placement is evidence' },
      {
        p: 'Field coordinates, the page they sat on, and the values entered are all recorded in the audit trail. If a counterparty later claims "that clause was not on page four when I signed", the audit trail can show what the document looked like at every step, hash-anchored at each stage.',
      },
      {
        callout: 'Tip: keep signature fields on signature lines and text fields for content. The verifier page renders field evidence more legibly when placement matches intent.',
      },
    ],
  },
  {
    slug: 'envelope-lifecycle',
    category: 'Workflow',
    title: 'The envelope lifecycle: draft to sealed',
    description: 'Every state an envelope passes through, what triggers transitions, and what each state means for your evidence.',
    minutes: 7,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Docurama models signing as a strict lifecycle. States are not decorations — each transition writes a hash-anchored entry to the security ledger, which is why the finished envelope can prove its own history.',
      },
      { h2: 'The states' },
      {
        list: [
          '<strong>Draft</strong> — documents and fields are still being arranged. Nothing has gone out.',
          '<strong>Sent</strong> — the first signer has been notified. The clock and the reminders start.',
          '<strong>Viewed</strong> — a signer opened the signing studio. Recorded per signer.',
          '<strong>Partially signed</strong> — one or more (not all) signers finished. Multi-role envelopes park here between signers.',
          '<strong>Completed</strong> — every signature collected. Docurama applies the final seal.',
          '<strong>Sealed</strong> — the PAdES signature and RFC 3161 timestamp are embedded; the audit certificate is generated.',
          '<strong>Declined / Voided</strong> — a signer refused, or you withdrew it. The attempt and its reason remain on the trail.',
        ],
      },
      { h2: 'Why transitions matter' },
      {
        p: 'Because every transition is recorded with a document hash, the lifecycle doubles as evidence. A sealed envelope answers "who signed what, when, from which channel, against which exact bytes" without anyone reconstructing it from memory or inbox screenshots.',
      },
      { h2: 'Reminders, expiry, and withdrawal' },
      {
        p: 'You control reminder cadence per envelope, can set an expiry date for the signing window, and can withdraw an envelope that went out by mistake. Withdrawal is itself auditable — the trail shows it was cancelled by you, at that moment, and signers are notified.',
      },
    ],
  },
  {
    slug: 'pades-explained',
    category: 'Trust',
    title: 'PAdES signatures, explained plainly',
    description: 'What PAdES actually is, what the X.509 seal and RFC 3161 timestamp each contribute, and where eIDAS fits in.',
    minutes: 8,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'PAdES (PDF Advanced Electronic Signatures, ETSI EN 319 142) is the European standard for embedding cryptographic signatures inside a PDF so that the signature survives the document — anyone with the file can verify it offline, decades from now, without access to Docurama at all.',
      },
      { h2: 'The three ingredients' },
      {
        list: [
          '<strong>X.509 signing certificate</strong> — a PKCS#12 identity that binds the signature to a signer identity. Docurama seals each completed envelope with it.',
          '<strong>RFC 3161 timestamp</strong> — a timestamp authority countersigns the exact moment of sealing, so later certificate expiry does not invalidate the proof.',
          '<strong>Document hash anchoring</strong> — the bytes of the document at each step are hashed into the audit chain, so any later alteration is detectable.',
        ],
      },
      { h2: 'Where eIDAS fits' },
      {
        p: 'eIDAS is the EU regulation that gives electronic signatures legal effect across member states. Docurama implements PAdES as the signature format under eIDAS and ESIGN, and the platform runs a documented compliance program with controls you can inspect in the Trust Center. What we do not do is claim certifications we have not earned — the Trust Center states readiness in its own words, per control.',
      },
      { h2: 'Qualified certificates and the timestamp authority' },
      {
        p: 'Two things in the stack belong to the deployment operator: the signing certificate (a qualified certificate if your process requires qualified signature level) and the choice of timestamp authority. Self-hosted operators configure their own; Docurama Cloud ships with a working default. The Trust Center marks this control honestly as needing the operator\u2019s qualified TSA choice where applicable.',
      },
      {
        callout: 'Practical takeaway: a PAdES file from Docurama verifies in Adobe Acrobat, in the EU verify page, or via the API — the proof travels with the document.',
      },
    ],
  },
  {
    slug: 'verify-a-document',
    category: 'Trust',
    title: 'How to verify a signed PDF',
    description: 'Three ways to check a Docurama-sealed document — Acrobat, the public verify page, and the API.',
    minutes: 4,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Verification answers one question: are these signatures intact and trustworthy? Because the proof is embedded in the PDF itself, you can verify anywhere — you do not need an account, and you do not need to trust the sender\u2019s word for it.',
      },
      { h2: 'Option 1: Adobe Acrobat (offline)' },
      {
        p: 'Open the PDF in Acrobat and look at the signature panel. A valid Docurama seal shows the signature as valid with an embedded timestamp. Acrobat performs the full cryptographic check locally, including the RFC 3161 countersignature.',
      },
      { h2: 'Option 2: the public verify page' },
      {
        p: 'Go to the <strong>Verify</strong> page and drop the file in. Docurama validates the signature, the timestamp, and the hash chain, then renders a human-readable summary: who signed, when, with what certificate identity, and whether any byte of the document changed after sealing. This page is public by design — counterparties can verify without an account.',
      },
      { h2: 'Option 3: the API' },
      {
        p: 'Programmatic verification uses the same engine. POST the document to the verify endpoint and receive a structured verdict your own systems can act on — useful for accounts-payable automation, onboarding pipelines, or archive integrity sweeps.',
      },
      {
        callout: 'If verification ever fails: check that you have the original sealed file (not a print-to-PDF copy). Re-saving through other tools can strip the signature layer.',
      },
    ],
  },
  {
    slug: 'templates-and-gallery',
    category: 'Workflow',
    title: 'Templates: build once, send forever',
    description: 'Turning repeat documents into templates, sharing them with a team, and collecting structured intake with public form links.',
    minutes: 5,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'If you send the same NDA, contract, or intake form twice, it should be a template. A template freezes the documents and field layout; each send clones it into a fresh envelope so the original never drifts.',
      },
      { h2: 'Creating a template' },
      {
        p: 'Build an envelope the way you normally would, then save it as a template instead of sending. Name it, pick sharing scope (just you, or the whole workspace), and it appears on the Templates page. Template fields keep their signer roles, so routing is pre-wired on every use.',
      },
      { h2: 'Public intake forms' },
      {
        p: 'Any template can expose a public form link (<code>/d/&lt;slug&gt;</code>). Counterparties fill the fields you marked as intake — no account needed — and the submission lands in your workspace as a prepared envelope awaiting your send. This is how HR onboarding forms, client intake, and vendor onboarding stop being email ping-pong.',
      },
      { h2: 'The gallery' },
      {
        p: 'The public template gallery ships ready-made documents — NDAs, service agreements, invoices, HR letters — with fields already placed sensibly. Duplicate one into your workspace, adjust, send. The gallery lives at the public <strong>Template gallery</strong> route and grows every sprint.',
      },
    ],
  },
  {
    slug: 'domain-join-workspaces',
    category: 'Teams',
    title: 'Domain-verified workspaces and team onboarding',
    description: 'Claim your company domain, control how colleagues join, and review pending join requests as the workspace admin.',
    minutes: 6,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'A domain-verified workspace ties your Docurama tenancy to your company\u2019s DNS identity. When the domain <code>yourcompany.com</code> is claimed and verified, Docurama can recognise colleagues signing up with matching email addresses and route them into the right workspace automatically — or queue them for your approval, your choice.',
      },
      { h2: 'Claiming the domain' },
      {
        p: 'In workspace settings, add your corporate domain. Docurama issues a DNS TXT challenge; publish the record at your DNS provider and trigger verification. The check is cryptographic — nobody can claim your domain by typing it.',
      },
      { h2: 'Join modes' },
      {
        list: [
          '<strong>Auto-join</strong> — a signup with a verified-domain email joins the workspace immediately; the account activates through the emailed activation link.',
          '<strong>Approval required</strong> — the signup is held as a pending join request. The workspace admin reviews it in the admin queue and approves or declines; the requester is notified either way.',
        ],
      },
      { h2: 'What the new member experiences' },
      {
        p: 'The signup lands on an activation page from a single-use email link (purpose-bound tokens — the link cannot be reused or repurposed). After activation, the member is inside the shared workspace with its templates, folders, and stamps. Login deliberately refuses inactive accounts, so an unactivated signup is just a dormant row, never a back door.',
      },
      { h2: 'Enterprise administration' },
      {
        p: 'Admins see the domain, its verification state, and the join-mode switch in one place, plus the pending-joins queue with full requester context. Every join-mode change, approval, and decline is recorded — the audit trail covers who joined and who let them in.',
      },
    ],
  },
  {
    slug: 'audit-trail-api',
    category: 'API',
    title: 'The audit trail and API access',
    description: 'What the audit certificate contains, how the hash chain works, and how to automate Docurama with API keys.',
    minutes: 7,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Every envelope carries an audit trail: an append-only, hash-chained record of the events in its life. Created, sent, viewed, signed, sealed — each event stores the document hash at that moment, and each entry is chained to its predecessor. Tamper with one entry and every later link stops matching.',
      },
      { h2: 'Reading the audit certificate' },
      {
        p: 'A sealed envelope generates a certificate document alongside the signed PDF. It lists the parties, the channels used, every lifecycle event with timestamps, and the chain anchors. Attach it to the contract in your archive and the "who and when" question is answered permanently.',
      },
      { h2: 'The security ledger' },
      {
        p: 'Platform-level security events (plan changes, domain verification, admin actions, compliance events) live on the same pattern: append-only, hash-chained, independently re-verifiable. The Trust Center\u2019s verification check walks the live chain on demand and reports honestly if anything fails.',
      },
      { h2: 'Automating with the API' },
      {
        list: [
          'Create API keys in workspace settings; keys are scoped to the workspace and revocable in one click.',
          'Create envelopes from templates, push documents, and poll or webhook for completion.',
          'Download the sealed PDF and audit certificate programmatically for archiving.',
          'Verify documents at scale — the verify endpoint returns a structured verdict for automation.',
        ],
      },
      {
        callout: 'Rate limits and full endpoint reference live at the API docs route. Keys are secrets: store them in your secret manager, never in frontend code.',
      },
    ],
  },
  {
    slug: 'compliance-program',
    category: 'Trust',
    title: 'The Docurama compliance program',
    description: 'How Docurama implements its controls, how readiness is stated, and what the operator configures in a production deployment.',
    minutes: 8,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Docurama treats compliance as an engineering discipline: controls implemented in source, evidence attached to each, and readiness stated in a fixed four-state vocabulary — Implemented, Partial, Missing, Needs Review. No badge-wall marketing; the Trust Center shows the same states the code does.',
      },
      { h2: 'What is implemented in the platform' },
      {
        list: [
          '<strong>Signature &amp; integrity</strong> — PAdES sealing, X.509 identities, RFC 3161 timestamps, hash-anchored audit chains.',
          '<strong>Data protection</strong> — AES-GCM encryption at rest, EU data residency, DSAR tooling, retention policies with enforcement.',
          '<strong>Governance</strong> — four-eyes change management, vendor security reviews, risk register, restore-drill evidence, weekly container scanning with SBOM.',
          '<strong>Operations</strong> — incident workflow, availability reporting, security ledger with live verification.',
        ],
      },
      { h2: 'How to read a control entry' },
      {
        p: 'Each control in the Trust Center shows its state, a plain-language description of what exists, and how to see the evidence. "Implemented" means the control runs in the deployed platform today. "Partial" means the code side is done but a piece belongs to the deployment operator — the classic case is the qualified timestamp authority, which a production operator must choose and configure.',
      },
      { h2: 'What the operator owns in production' },
      {
        list: [
          'Production secrets (signing keys, encryption keys) — never shipped in the repository.',
          'The qualified TSA choice where qualified signature level is required.',
          'Legal publications: terms, privacy notice, DPA.',
          'Stripe price configuration for live checkout.',
        ],
      },
      {
        callout: 'The rule we hold ourselves to: any sentence about compliance in the product must be reproducible from the controls catalog. If it cannot be evidenced, it is not written.',
      },
    ],
  },
  {
    slug: 'billing-35-day-cycle',
    category: 'Billing',
    title: 'Billing: the 35-day cycle, commitments, and Fair Exit',
    description: 'Why every cycle is 35 days, how commitment discounts apply, and exactly how the Fair Exit Guarantee refunds you.',
    minutes: 6,
    updated: '2026-09-10',
    blocks: [
      {
        p: 'Docurama bills in <strong>35-day cycles</strong> instead of the industry\u2019s 30. Ten days in an average month are weekends; a 30-day cycle quietly charges you for days you cannot work. Stretching the cycle to 35 days puts that time back: twelve cycles cover <strong>420 days of service — 55 days more than a calendar year</strong> — at the same twelve payments.',
      },
      { h2: 'The commitment ladder' },
      {
        list: [
          '<strong>Rolling</strong> — billed every 35 days, cancel anytime, 0% discount.',
          '<strong>3 months</strong> — three cycles (105 days of coverage), 5% off the cycle price.',
          '<strong>6 months</strong> — six cycles (210 days), 10% off.',
          '<strong>12 months</strong> — twelve cycles (420 days), 15% off.',
        ],
      },
      { h2: 'The Fair Exit Guarantee' },
      {
        p: 'Commitments should not feel like traps. On 6- and 12-month plans, every <strong>unused full cycle</strong> refunds to your payment method pro-rata, self-serve, one click — that is the Fair Exit Guarantee. On 3-month plans, unused cycles become account credit. On rolling plans there is nothing to refund: you were never billed ahead, so coverage simply runs to the end of the paid cycle. The cycle you are inside always runs its course — you keep full access for days already paid for.',
      },
      { h2: 'Worked example' },
      {
        p: 'Team at the 6-month commitment: the list price is EUR 29 per cycle; the commitment prices it at EUR 27.55 per cycle (10% off wait — see the pricing page calculator for live math). Cancel after two completed cycles and four unused cycles refund at the committed rate. The pricing page lets you preview any cancellation before it happens — the same arithmetic the billing engine runs.',
      },
      { h2: 'Checkout status' },
      {
        p: 'While the operator has not connected Stripe price IDs, checkout is marked "coming soon" and the catalog reports exactly what is configured — the same honesty the rest of the platform runs on.',
      },
    ],
  },
];
