/**
 * Sample data for the homepage playground. Everything here is fictional and
 * runs in the visitor's browser only; nothing is sent to the server.
 */

export type TabKey = "documents" | "builder" | "signing" | "verify" | "templates" | "audit" | "team" | "api";

export type EnvelopeStatus = "SENT" | "PARTIALLY_SIGNED" | "COMPLETED" | "DECLINED";
export type SignerStatus = "PENDING" | "VIEWED" | "SIGNED";
export type Channel = "email" | "sms" | "whatsapp" | "link";

export interface Signer {
  name: string;
  email: string;
  company: string;
  status: SignerStatus;
  signedAt?: string;
}

export interface ThreadItem {
  id: string;
  /** event: system line · out: reminder sent by you · in: signer reply · note: internal, team only */
  kind: "event" | "out" | "in" | "note";
  actor: string;
  text: string;
  at: string;
  channel?: Channel;
}

export interface Envelope {
  id: string;
  code: string;
  title: string;
  pages: number;
  status: EnvelopeStatus;
  signers: Signer[];
  thread: ThreadItem[];
  unread: boolean;
  /** How the next reminder is answered (scripted). */
  script: "reply" | "sign" | "view";
}

export interface Member {
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Member";
  status: "Active" | "Invited";
}

export interface Template {
  id: string;
  name: string;
  category: "Sales" | "HR" | "Procurement" | "Legal";
  pages: number;
  fields: number;
  uses: number;
}

export const YOU = "Alexandra Fischer";

export const SEED_ENVELOPES: Envelope[] = [
  {
    id: "e1", code: "DOC-7KQ2M9", title: "Supply agreement 2027", pages: 6, status: "SENT", unread: true, script: "sign",
    signers: [{ name: "Lena Müller", email: "lena.mueller@hartmann-logistik.de", company: "Hartmann Logistik GmbH", status: "VIEWED" }],
    thread: [
      { id: "e1a", kind: "event", actor: YOU, text: "Sent to Lena Müller by email", at: "09:12" },
      { id: "e1b", kind: "event", actor: "Lena Müller", text: "Lena Müller opened the document", at: "09:40" },
      { id: "e1c", kind: "in", actor: "Lena Müller", text: "Thanks. Is clause 7 on delivery penalties negotiable before I sign?", at: "09:44" },
    ],
  },
  {
    id: "e2", code: "DOC-4RW8T1", title: "Mutual NDA, Atelier Lumen", pages: 3, status: "PARTIALLY_SIGNED", unread: true, script: "reply",
    signers: [
      { name: "Claire Martin", email: "claire.martin@atelier-lumen.fr", company: "Atelier Lumen SAS", status: "SIGNED", signedAt: "Yesterday" },
      { name: "Tomás Ribeiro", email: "tomas@porto-ceramics.pt", company: "Porto Ceramics Lda", status: "PENDING" },
    ],
    thread: [
      { id: "e2a", kind: "event", actor: YOU, text: "Sent to 2 signers in routing order", at: "Yesterday" },
      { id: "e2b", kind: "event", actor: "Claire Martin", text: "Claire Martin signed", at: "Yesterday" },
      { id: "e2c", kind: "note", actor: YOU, text: "Tomás is travelling until Thursday, a WhatsApp reminder works best.", at: "08:05" },
    ],
  },
  {
    id: "e3", code: "DOC-9PL3X6", title: "Employment contract, Camille Dubois", pages: 8, status: "SENT", unread: false, script: "view",
    signers: [{ name: "Camille Dubois", email: "camille.dubois@example.fr", company: "Joining StålFe AB", status: "PENDING" }],
    thread: [{ id: "e3a", kind: "event", actor: YOU, text: "Sent to Camille Dubois by email", at: "Mon" }],
  },
  {
    id: "e4", code: "DOC-2HV5N8", title: "Purchase order PO-2026-0418", pages: 2, status: "COMPLETED", unread: false, script: "reply",
    signers: [{ name: "Marco Bianchi", email: "m.bianchi@bianchi-meccanica.it", company: "Bianchi Meccanica Srl", status: "SIGNED", signedAt: "Mon" }],
    thread: [
      { id: "e4a", kind: "event", actor: YOU, text: "Sent to Marco Bianchi by email", at: "Mon" },
      { id: "e4b", kind: "event", actor: "Marco Bianchi", text: "Marco Bianchi signed", at: "Mon" },
      { id: "e4c", kind: "event", actor: "Docurama", text: "Sealed with an RFC 3161 timestamp. Evidence pack ready", at: "Mon" },
    ],
  },
  {
    id: "e5", code: "DOC-6MJ1C4", title: "Studio lease renewal", pages: 11, status: "DECLINED", unread: false, script: "reply",
    signers: [{ name: "Sofia Lindqvist", email: "sofia@kvarnstudio.se", company: "Kvarn Studio AB", status: "VIEWED" }],
    thread: [
      { id: "e5a", kind: "event", actor: YOU, text: "Sent to Sofia Lindqvist by email", at: "Last week" },
      { id: "e5b", kind: "event", actor: "Sofia Lindqvist", text: "Declined: the rent indexation date is wrong, it should be 1 March", at: "Last week" },
    ],
  },
];

export const TEMPLATES: Template[] = [
  { id: "t1", name: "Mutual NDA", category: "Legal", pages: 3, fields: 6, uses: 214 },
  { id: "t2", name: "Freelance services agreement", category: "Sales", pages: 5, fields: 9, uses: 96 },
  { id: "t3", name: "Employment contract (CDI)", category: "HR", pages: 8, fields: 14, uses: 61 },
  { id: "t4", name: "Purchase order approval", category: "Procurement", pages: 2, fields: 4, uses: 388 },
  { id: "t5", name: "Offer letter", category: "HR", pages: 2, fields: 5, uses: 143 },
  { id: "t6", name: "Supplier code of conduct", category: "Procurement", pages: 4, fields: 3, uses: 57 },
  { id: "t7", name: "Quotation acceptance", category: "Sales", pages: 1, fields: 3, uses: 512 },
  { id: "t8", name: "Data processing agreement", category: "Legal", pages: 9, fields: 8, uses: 38 },
];

export const SEED_TEAM: Member[] = [
  { name: YOU, email: "alex@stalfe.example", role: "Owner", status: "Active" },
  { name: "Hugo Moreau", email: "hugo.moreau@stalfe.example", role: "Admin", status: "Active" },
];

export const SEAT_LIMIT = 3; // the Starter plan

export const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  SENT: "Sent", PARTIALLY_SIGNED: "Partially signed", COMPLETED: "Completed", DECLINED: "Declined",
};

/** Semantic state colours (real status, not decoration). */
export const STATUS_TONE: Record<EnvelopeStatus, string> = {
  SENT: "bg-sky-500",
  PARTIALLY_SIGNED: "bg-amber-500",
  COMPLETED: "bg-primary",
  DECLINED: "bg-rose-500",
};

export const SIGNER_TONES = [
  { ring: "ring-sky-500", bg: "bg-sky-500/15", text: "text-sky-700 dark:text-sky-300", solid: "bg-sky-500" },
  { ring: "ring-amber-500", bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", solid: "bg-amber-500" },
];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).slice(0, 2).join("");
}

export function nowLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function newCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "DOC-";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Real SHA-256 (Web Crypto). Falls back to a clearly different short hash where unavailable. */
export async function sha256Hex(input: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
  }
}
