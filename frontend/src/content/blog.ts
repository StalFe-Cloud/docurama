import type { BlogPost } from './types';

/**
 * Blog corpus (Sprint 8). English source; localized through the pipeline.
 * Vocabulary guardrail: no certification claims, ever.
 */
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'why-35-day-cycles',
    tag: 'Pricing',
    title: 'Why every Docurama cycle is 35 days',
    description: 'Ten days a month are weekends. A 30-day billing cycle charges you for them anyway. Here is the math behind giving them back.',
    date: '2026-09-08',
    minutes: 6,
    featured: true,
    blocks: [
      {
        p: 'Almost every SaaS subscription inherits the same quiet trick: a "month" of service is billed as 30 days, but a real month averages 30.4 calendar days - of which eight to ten are weekends. If your work happens on weekdays, a meaningful slice of what you pay for is time you cannot use. Nobody reads the fine print because every vendor does it. That is exactly why it survives.',
      },
      { h2: 'The 35-day answer' },
      {
        p: 'Docurama bills every cycle at <strong>35 days</strong>. Not as a promo, not on the annual plan only - everywhere, on every tier. The effect compounds honestly: twelve billed cycles cover <strong>420 days of service</strong>. Against a 365-day calendar year, that is <strong>55 extra days</strong> - nearly two months of working time you did not pay extra for.',
      },
      { h2: 'What it costs you' },
      {
        p: 'Nothing. The cycle length is not a rounding trick in our favour - the list prices are set per 35-day cycle, visibly, on the pricing page. What changes is the ratio of usable time to paid time. Weekends on us, stated as a product constant instead of a marketing banner.',
      },
      { h2: 'Why not just "one month free"?' },
      {
        p: 'Free-month promotions are one-off sugar hits - they reset every year for new customers and reward churn. The 35-day cycle is structural: it benefits every cycle you stay, and it cannot be quietly withdrawn because it is how billing works, not how a campaign works. Innovation in pricing should live in the mechanics, not the confetti.',
      },
      {
        callout: 'The pricing page includes a live calculator: every tier, monthly or annual, and the coverage in days - the same numbers the billing engine runs. No hidden arithmetic.',
      },
    ],
  },
  {
    slug: 'fair-exit-guarantee',
    tag: 'Pricing',
    title: 'The Fair Exit Guarantee: prepaid without the trap',
    description: 'Annual billing locks customers in with cancellation mazes. We priced the exit instead - here is how pro-rata refunds work.',
    date: '2026-09-08',
    minutes: 5,
    blocks: [
      {
        p: 'The industry uses prepayment one-way: customers get a discount for promising 12 months, and vendors get a cancellation process designed like an obstacle course - phone calls, retention scripts, "credits" instead of money. The discount was never free; you paid for it with your exit.',
      },
      { h2: 'Priced exits, both directions' },
      {
        p: 'The Fair Exit Guarantee reverses the polarity. Choose annual billing and the discount is real - about 20% off, every cycle. Leave early and every <strong>unused full cycle</strong> refunds to your payment method, pro-rata at your committed rate, self-serve, one click. No call, no script, no "account credit" sleight of hand.',
      },
      { h2: 'Why it is safe to offer' },
      {
        p: 'Because the arithmetic is server-side and public. The refund preview on the pricing page runs the same function the billing engine runs - you can simulate any cancellation before you commit, before you even sign up. A guarantee you can verify before purchase is a guarantee with teeth.',
      },
      { h2: 'The small print, in large print' },
      {
        p: 'The cycle you are inside always runs its course: you keep full access for days already paid for. Monthly plans have nothing to refund because nothing was billed ahead - the discount is the reward for the annual commitment, and the cash refund is the way out of it.'
      },
    ],
  },
  {
    slug: 'pades-vs-click-to-sign',
    tag: 'Trust',
    title: 'PAdES vs click-to-sign: what actually protects you',
    description: 'A checkbox on a webpage is not a signature standard. The difference matters most on the day something goes wrong.',
    date: '2026-08-25',
    minutes: 7,
    blocks: [
      {
        p: 'Click-to-sign products record intent: someone typed a name and clicked. That can be legally valid, but the evidence lives in the vendor\u2019s database, formatted by the vendor, exportable at the vendor\u2019s discretion. PAdES inverts the model: the cryptographic proof lives <strong>inside the PDF itself</strong>, verifiable by anyone, offline, forever.',
      },
      { h2: 'Three technical differences' },
      {
        list: [
          '<strong>Portability of proof</strong> - PAdES verification needs only the file and any standards-compliant reader. No account, no vendor API, no trust in the sender.',
          '<strong>Timestamp authority</strong> - an RFC 3161 timestamp countersigns the moment of sealing. Signatures stay verifiable even after the signing certificate itself expires.',
          '<strong>Long-term validation</strong> - the standard embeds everything needed to re-check the chain years later, when CRL endpoints and algorithms have moved on.',
        ],
      },
      { h2: 'Where Docurama sits' },
      {
        p: 'Every completed Docurama envelope is sealed as PAdES under eIDAS and ESIGN, with X.509 identities and RFC 3161 timestamps. The audit certificate travels alongside the signed PDF. Counterparties verify on the public verify page without an account - which is the point: trust that does not require trusting us.',
      },
      { h2: 'When click-to-sign is fine' },
      {
        p: 'Low-stakes internal acknowledgements, poll-style consents, anything you would happily rebuild from logs - click-to-sign is faster and fine. For contracts, HR files, procurement, and anything a lawyer or auditor might later hold up to the light, the seal earns its keep.',
      },
    ],
  },
  {
    slug: 'eu-data-residency-by-default',
    tag: 'Trust',
    title: 'EU data residency by default - what that means in practice',
    description: 'Where your documents live, how they are encrypted, and the difference between a residency checkbox and a default.',
    date: '2026-08-11',
    minutes: 5,
    blocks: [
      {
        p: '"Your data stays in the EU" is easy to write on a landing page. Making it true is a chain of smaller, verifiable statements: where storage lives, where backups live, where processing happens, who holds decryption keys, and what happens when a government asks. Defaults matter more than options - a checkbox nobody found protects nobody.',
      },
      { h2: 'The Docurama defaults' },
      {
        list: [
          'Documents, attachments, and audit evidence are stored in EU infrastructure with <strong>AES-GCM encryption at rest</strong> using envelope encryption.',
          'The signing and verification pipeline processes documents in-region; cross-border transfers are not part of the default data flow.',
          'GDPR tooling - data export, rectification, erasure (DSAR) - is built into the admin surface, not delegated to an inbox.',
          'Retention policies are enforced server-side per workspace, so "delete after X" is a mechanism, not a promise.',
        ],
      },
      { h2: 'What the operator adds' },
      {
        p: 'In self-hosted and enterprise deployments, the operator controls the storage endpoints and the key material. That is deliberate: the strongest residency guarantee is the one where the platform physically cannot move your data somewhere you did not choose.',
      },
      { h2: 'How to check us' },
      {
        p: 'The Trust Center lists the data-protection controls in the platform\u2019s own four-state vocabulary with evidence pointers. We would rather you verify than believe - the verify page exists for documents, and the trust page exists for the platform.',
      },
    ],
  },
  {
    slug: 'domain-verified-workspaces',
    tag: 'Product',
    title: 'Domain-verified workspaces: onboarding that trusts DNS, not invites',
    description: 'How claiming your corporate domain turns signup chaos into a governed, auditable membership flow.',
    date: '2026-07-28',
    minutes: 5,
    blocks: [
      {
        p: 'Teams usually onboard into SaaS tools by invitation link - links that get forwarded, pasted into group chats, and reused. Domain verification replaces link magic with cryptographic identity: if you can prove you own an email at <code>yourcompany.com</code>, and the workspace has verified that domain by DNS, the workspace already knows which team you belong to.',
      },
      { h2: 'How it works' },
      {
        p: 'The workspace admin claims the domain and publishes a DNS TXT record; Docurama verifies it. From then on, signups with matching email domains either auto-join (activation via single-use email link) or queue as pending requests for admin approval - the admin chooses the join mode. Activation tokens are purpose-bound and single-use; login refuses inactive accounts, so an unactivated signup has zero privileges.',
      },
      { h2: 'Why admins like it' },
      {
        p: 'The pending-joins queue shows full requester context, every approval or decline is recorded, and join-mode changes land on the security ledger. Membership stops being a pile of forwarded links and becomes a governed flow with an audit trail - which is what an IT reviewer wants to see during security review.',
      },
      { h2: 'What is next' },
      {
        p: 'SSO (OIDC/SAML) is on the roadmap as an operator-activated feature - the same domain-verified trust anchor extended to identity federation. The honest status, as always, lives in the Trust Center rather than in a feature box-tick.',
      },
    ],
  },
  {
    slug: 'building-docurama-in-the-open',
    tag: 'Product',
    title: 'Building Docurama in the open: source, evidence, and honest status',
    description: 'Why the platform publishes its controls catalog with evidence instead of badge walls, and what "readiness vocabulary" means.',
    date: '2026-07-14',
    minutes: 6,
    blocks: [
      {
        p: 'Compliance marketing has a vocabulary problem: "bank-grade security", "military-grade encryption", badges for certifications the product may or may not hold under the specific deployment you use. The words are chosen to end questions. We would rather start them.',
      },
      { h2: 'The four-state vocabulary' },
      {
        p: 'Every control in the Docurama Trust Center is stated as exactly one of: <strong>Implemented</strong>, <strong>Partial</strong>, <strong>Missing</strong>, or <strong>Needs Review</strong>. Implemented means it runs in the deployed platform today, with evidence you can inspect. Partial means the code side is done but a deployment decision belongs to the operator - like the choice of qualified timestamp authority. The vocabulary is deliberately boring; boring words are hard to inflate.',
      },
      { h2: 'Evidence over adjectives' },
      {
        list: [
          'The controls catalog lives in source control, versioned with the code that implements it.',
          'Security events append to a hash-chained ledger; the Trust Center re-verifies the chain live.',
          'Restore drills run against real backups and publish their results - including the uncomfortable ones.',
          'The test suite (558 checks at this writing) pins behaviour, including the honest refusals.',
        ],
      },
      { h2: 'What we will never write' },
      {
        p: 'We will not claim certifications the deployment has not earned, and we will not use "certified" as an adjective for ourselves. If a control says Implemented, you can trace it. If it says Partial, the missing piece is named. That is the whole trick: say less, prove it.',
      },
    ],
  },
];
