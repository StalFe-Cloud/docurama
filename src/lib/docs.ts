/**
 * Browser-safe docs library (ported from the fs-backed Next.js module).
 * A curated set of representative guides is bundled behind the same API.
 */

export interface DocMetadata {
  title: string;
  description: string;
  group: string;
  order: number;
  tags: string[];
  slug: string;
}

export interface TocItem {
  id: string;
  title: string;
  level: number;
}

export interface DocArticle {
  meta: DocMetadata;
  content: string;
  toc: TocItem[];
}

export interface NavGroup {
  name: string;
  items: {
    title: string;
    slug: string;
    description: string;
  }[];
}

type DocEntry = DocMetadata & { content: string };

const DOCS: DocEntry[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Create your workspace, send your first envelope and track it to completion.",
    group: "Getting Started",
    order: 1,
    tags: ["onboarding", "envelope"],
    content: `Create a workspace, upload a PDF, add signers and send. Each signer receives a unique email link; no account is needed to sign.

## Your first envelope

From Documents, choose New document, upload a PDF and place signature fields. Add recipients in signing order and send.

## Tracking

The envelope page shows every event: invitation sent, document viewed, consent given, signature affixed. When everyone has signed, the envelope seals and the evidence pack becomes available.`,
  },
  {
    slug: "documents-and-signing",
    title: "Documents and signing",
    description: "Upload formats, field placement, signing order and reminders.",
    group: "Documents",
    order: 1,
    tags: ["pdf", "fields", "reminders"],
    content: `Docurama signs PDF documents. Place signature, date, text and checkbox fields per recipient.

## Signing order

Recipients sign in the order you set. A signer is notified only when it is their turn.

## Reminders

Automatic reminders go out before the signing deadline; you can also send a manual reminder from the envelope detail.`,
  },
  {
    slug: "verification",
    title: "Verification",
    description: "Verify a signed document's digest and attestation without an account.",
    group: "Verification",
    order: 1,
    tags: ["digest", "sha-256", "attestation"],
    content: `Every completed envelope records a SHA-256 digest of the final document and an ordered event manifest.

## Verify a document

Open the verify page and upload the signed PDF, or enter its public code. The digest is recomputed in your browser and compared with the recorded attestation.`,
  },
  {
    slug: "templates",
    title: "Templates",
    description: "Reusable documents with roles, variables and pre-placed fields.",
    group: "Templates",
    order: 1,
    tags: ["templates", "roles"],
    content: `Templates capture a document, its fields and its signer roles for reuse.

## Roles

Define roles (client, counterparty, witness) instead of named people. At send time you only assign people to roles.`,
  },
  {
    slug: "api-reference",
    title: "API reference",
    description: "REST API for envelopes, templates and verification.",
    group: "API",
    order: 1,
    tags: ["api", "rest"],
    content: `The REST API mirrors the portal: create envelopes, list templates, retrieve evidence packs.

## Authentication

API keys are created per workspace in Settings. Send the key as a bearer token.`,
  },
];

function toc(content: string): TocItem[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const title = line.slice(3).trim();
      return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, level: 2 };
    });
}

export function getDocArticle(slugParts: string[] = []): DocArticle | null {
  const slug = slugParts.join("/") || "getting-started";
  const entry = DOCS.find((d) => d.slug === slug);
  if (!entry) return null;
  const { content, ...meta } = entry;
  return { meta, content, toc: toc(content) };
}

export function getDocsNav(): NavGroup[] {
  const groups = new Map<string, NavGroup>();
  for (const { content: _c, ...meta } of DOCS) {
    const group = groups.get(meta.group) ?? { name: meta.group, items: [] };
    group.items.push({ title: meta.title, slug: meta.slug, description: meta.description });
    groups.set(meta.group, group);
  }
  for (const group of groups.values()) group.items.sort((a, b) => a.title.localeCompare(b.title));
  return [...groups.values()];
}
