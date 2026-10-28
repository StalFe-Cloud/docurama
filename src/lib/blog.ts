/**
 * Browser-safe blog library (ported from the fs-backed Next.js module).
 * The original 100k-post generated corpus is not portable; a curated set of
 * representative articles is bundled here behind the same API surface.
 */

export interface BlogSummary {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  draft: boolean;
  readingMinutes: number;
  wordCount: number;
}
export interface BlogPost extends BlogSummary { content: string }

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BLOG_PAGE_SIZE = 24;

export function validBlogSlug(slug: string): boolean {
  return slug.length <= 200 && SLUG.test(slug);
}
export function validContentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function post(slug: string, title: string, description: string, date: string, tags: string[], content: string): BlogPost {
  const wordCount = content.split(/\s+/).length;
  return {
    slug, title, description, date, author: "Docurama Team", tags, draft: false,
    content, wordCount, readingMinutes: Math.max(1, Math.ceil(wordCount / 210)),
  };
}

const POSTS: BlogPost[] = [
  post(
    "what-makes-an-electronic-signature-legally-valid",
    "What makes an electronic signature legally valid?",
    "Consent, intent, attribution and evidence: the four pillars behind an enforceable electronic signature under eIDAS and ESIGN.",
    "2026-09-18",
    ["eidas", "esign", "legal-basics"],
    `An electronic signature is legally valid when four elements come together: the signer's consent to sign electronically, clear intent to sign, reliable attribution of the signature to a person, and a tamper-evident record of what was signed.

Under eIDAS in the European Union, a simple electronic signature cannot be denied legal effect solely because it is electronic. The US ESIGN Act and UETA follow the same principle.

## Consent and intent

The signer must affirmatively agree to conduct the transaction electronically, and the act of signing must be deliberate. Docurama records both as separate, timestamped events.

## Attribution and evidence

Every completed envelope produces an evidence pack: SHA-256 digests of the final document, the consent text version, and an ordered event log. Anyone can verify the digests independently on the verify page.`,
  ),
  post(
    "evidence-packs-explained",
    "Evidence packs explained: digests, events and attestations",
    "What goes into a Docurama evidence pack, how the digest chain works, and how to verify a completed document without an account.",
    "2026-09-02",
    ["evidence", "verification", "transparency"],
    `When an envelope completes, Docurama assembles an evidence pack: the final PDF, a canonical JSON manifest of every signing event, and SHA-256 digests that tie them together.

## The digest chain

Each event (invitation sent, document viewed, consent given, signature affixed) is hashed in order. The final digest covers the document bytes and the event manifest, so any later change to either is detectable.

## Independent verification

The public verify page recomputes the digest of an uploaded PDF and compares it with the recorded attestation. No account is needed, and the check works even if you export the evidence pack and verify it years later.`,
  ),
  post(
    "eidas-levels-ses-ades-qes",
    "SES, AES, QES: choosing the right eIDAS signature level",
    "A practical guide to the three eIDAS signature levels and when each one is sufficient for your contracts.",
    "2026-08-21",
    ["eidas", "compliance", "legal-basics"],
    `eIDAS defines three signature levels: simple (SES), advanced (AES) and qualified (QES). Most commercial contracts need only SES; regulated or notarized workflows may require AES or QES.

## Simple electronic signature

A typed name or drawn mark, captured with consent and intent. Sufficient for most B2B and B2C agreements.

## Advanced and qualified

AES adds unique linkage to the signer and tamper detection. QES is created by a qualified device and carries a presumption of validity across the EU. Docurama's evidence records support SES workflows today and expose the digests needed to upgrade to AES with an external provider.`,
  ),
  post(
    "gdpr-and-document-signing",
    "GDPR and document signing: data minimization in practice",
    "How to collect only the personal data a signature workflow actually needs, and where that data lives.",
    "2026-08-05",
    ["gdpr", "privacy", "compliance"],
    `A signature workflow touches personal data at every step: names, email addresses, IP addresses and the document contents themselves. GDPR's data minimization principle means collecting only what the transaction needs.

## What Docurama stores

Signer name and email, the events required for the evidence record, and the document itself. Retention is configurable per workspace, and signers can request a copy or deletion of their data.

## Data residency

Hosting region and subprocessors determine residency. European workspaces keep documents and evidence records in EU regions.`,
  ),
  post(
    "templates-that-scale",
    "Contract templates that scale: variables, roles and reuse",
    "Turn a one-off agreement into a reusable template with signer roles, variable fields and pre-filled content.",
    "2026-07-22",
    ["templates", "product", "workflow"],
    `A good template turns a forty-minute document preparation into a two-minute send. The building blocks are roles, variables and fixed content.

## Roles before people

Define signer roles (client, counterparty, witness) instead of named people. When you send, you only fill in who plays each role.

## Variables and fields

Variable fields merge sender-supplied values into the document at send time; signer fields collect input during signing. Fixed content stays identical across every envelope, which keeps the evidence record comparable.`,
  ),
  post(
    "21-cfr-part-11-signatures",
    "21 CFR Part 11: electronic signatures in regulated industries",
    "What FDA-regulated teams need from an e-signature workflow: reauthentication, manifestation and audit trails.",
    "2026-07-08",
    ["part-11", "compliance", "life-sciences"],
    `Teams in life sciences face stricter rules than general commerce. 21 CFR Part 11 requires that electronic signatures be uniquely attributable, that signing manifests the signer's intent, and that a complete audit trail exists.

## Reauthentication at signing time

Part 11 workflows can require the signer to re-enter credentials at the moment of signing. Docurama workspaces can raise the verification floor per envelope.

## Audit trail

Every event is recorded with timestamps and actor identity, and the evidence pack exports the full trail for inspection.`,
  ),
];

export function isPublished(post: BlogSummary, today = new Date().toISOString().slice(0, 10)): boolean {
  return !post.draft && validContentDate(post.date) && post.date <= today &&
    (!post.updated || (validContentDate(post.updated) && post.updated >= post.date && post.updated <= today));
}

/** Metadata only, sorted newest first. */
export function listBlogPosts(): BlogSummary[] {
  return POSTS.filter((p) => isPublished(p))
    .map(({ content: _content, ...summary }) => summary)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export function getBlogPost(slug: string): BlogPost | null {
  if (!validBlogSlug(slug)) return null;
  const found = POSTS.find((p) => p.slug === slug);
  return found && isPublished(found) ? found : null;
}

function taxonomy() {
  const posts = listBlogPosts();
  const tags = new Map<string, BlogSummary[]>();
  for (const p of posts) for (const tag of p.tags) {
    const items = tags.get(tag);
    if (items) items.push(p); else tags.set(tag, [p]);
  }
  const cloud = [...tags].map(([tag, items]) => ({ tag, count: items.length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { posts, tags, cloud };
}

export function postsForBlogTag(tag: string): BlogSummary[] { return taxonomy().tags.get(tag) ?? []; }
export function blogTagCloud(): { tag: string; count: number }[] { return taxonomy().cloud; }

export function relatedBlogPosts(post: BlogSummary, limit = 4): BlogSummary[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const tags = taxonomy().tags;
  const scores = new Map<BlogSummary, number>();
  for (const tag of post.tags) for (const candidate of tags.get(tag) ?? []) {
    if (candidate.slug !== post.slug) scores.set(candidate, (scores.get(candidate) ?? 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].date.localeCompare(a[0].date) || a[0].slug.localeCompare(b[0].slug))
    .slice(0, limit)
    .map(([p]) => p);
}

export function formatDate(iso: string): string {
  if (!validContentDate(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export interface BlogTopic { title: string; description: string; kind: string }

const TOPICS: Record<string, BlogTopic> = {
  eidas: { title: "eIDAS", description: "European electronic signature regulation: levels, requirements and practical guidance.", kind: "regulation" },
  esign: { title: "ESIGN Act", description: "US electronic signature law and what it means for your contracts.", kind: "regulation" },
  evidence: { title: "Evidence records", description: "Digests, event logs and attestations that make a signed document verifiable.", kind: "product" },
  compliance: { title: "Compliance", description: "GDPR, 21 CFR Part 11 and operational compliance for signing workflows.", kind: "topic" },
  templates: { title: "Templates", description: "Reusable contract templates, roles and variable fields.", kind: "product" },
};

export function getBlogTopic(tag: string): BlogTopic {
  if (TOPICS[tag]) return TOPICS[tag];
  return { title: tag.replace(/-/g, " "), description: `Practical ${tag.replace(/-/g, " ")} guidance and related product documentation.`, kind: "topic" };
}
