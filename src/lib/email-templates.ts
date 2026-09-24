/**
 * Email wording and branding for envelope mail (Settings > Personalization).
 *
 * Pure: no server imports, so the settings page previews exactly what is sent.
 * A template is plain text with {{placeholders}}. The HTML alternative escapes
 * every character of it, so neither a workspace template nor a document title
 * can inject markup into a recipient's inbox; the only markup is ours (logo,
 * paragraphs, one button for the link).
 */

export type EmailKind =
  | "invite" | "reminder" | "completed" | "copy"          // editable
  | "cc" | "signed" | "viewed" | "declined" | "sent";     // fixed wording

export const EDITABLE_EMAILS = ["invite", "reminder", "completed", "copy"] as const;
export type EditableEmail = (typeof EDITABLE_EMAILS)[number];

export const EMAIL_LABELS: Record<EditableEmail, { title: string; desc: string }> = {
  invite: { title: "Signature request email", desc: "Sent to each signer with their personal signing link." },
  reminder: { title: "Reminder email", desc: "Sent by manual and automated reminders to the signer whose turn it is." },
  completed: { title: "Completed notification email", desc: "Sent to the sender once every signer has signed." },
  copy: { title: "Documents copy email", desc: "Sent to every signer and copy recipient with the signed PDF." },
};

export type EmailVars = Partial<Record<
  | "recipient.name" | "recipient.email" | "sender.name" | "sender.email" | "workspace.name"
  | "document.title" | "document.code" | "message" | "link" | "verify.link" | "signer.name" | "reason",
  string
>>;

export const EMAIL_VARIABLES: { key: keyof EmailVars; desc: string }[] = [
  { key: "recipient.name", desc: "Name of the person receiving this email" },
  { key: "recipient.email", desc: "Their email address" },
  { key: "sender.name", desc: "Who sent the document" },
  { key: "sender.email", desc: "The sender's email address" },
  { key: "workspace.name", desc: "Your workspace (company) name" },
  { key: "document.title", desc: "Document title" },
  { key: "document.code", desc: "Public verification code (DOC-…)" },
  { key: "message", desc: "The sender's message, when there is one" },
  { key: "link", desc: "Signing link, or download link for copies" },
  { key: "verify.link", desc: "Public verification page for this document" },
];

type Template = { subject: string; body: string; button?: string };

export const EMAIL_DEFAULTS: Record<EmailKind, Template> = {
  invite: {
    subject: "{{sender.name}} asks for your signature: {{document.title}}",
    body: "Hello {{recipient.name}},\n\n{{sender.name}} ({{workspace.name}}) sent you \"{{document.title}}\" to sign electronically.\n\n{{message}}\n\nOpen your personal signing link (unique to you, do not forward):\n{{link}}\n\nVerification code once completed: {{document.code}}",
    button: "Review and sign",
  },
  reminder: {
    subject: "Reminder: {{document.title}} is waiting for your signature",
    body: "Hello {{recipient.name}},\n\n{{sender.name}} reminds you to sign \"{{document.title}}\".\n\nYour personal signing link:\n{{link}}",
    button: "Review and sign",
  },
  completed: {
    subject: "Completed: {{document.title}}",
    body: "Hello {{recipient.name}},\n\nEveryone has signed \"{{document.title}}\". It is sealed and can be verified by anyone with code {{document.code}}.\n\nOpen the document:\n{{link}}\n\nPublic verification:\n{{verify.link}}",
    button: "Open the document",
  },
  copy: {
    subject: "Your signed copy: {{document.title}}",
    body: "Hello {{recipient.name}},\n\n\"{{document.title}}\" from {{workspace.name}} has been signed by everyone and sealed.\n\nDownload your signed PDF:\n{{link}}\n\nAnyone can verify it with code {{document.code}}:\n{{verify.link}}",
    button: "Download the signed PDF",
  },
  cc: {
    subject: "{{sender.name}} added you as a copy recipient: {{document.title}}",
    body: "Hello {{recipient.name}},\n\n{{sender.name}} added you as a copy recipient for \"{{document.title}}\". No signature is required from you; you will receive the signed document once everyone has signed.\n\nVerification code: {{document.code}}",
  },
  signed: {
    subject: "{{signer.name}} signed {{document.title}}",
    body: "Hello {{recipient.name}},\n\n{{signer.name}} has signed \"{{document.title}}\". Other signers are still pending.\n\nOpen the document:\n{{link}}",
    button: "Open the document",
  },
  viewed: {
    subject: "{{signer.name}} opened {{document.title}}",
    body: "Hello {{recipient.name}},\n\n{{signer.name}} opened \"{{document.title}}\" for the first time.\n\nOpen the document:\n{{link}}",
    button: "Open the document",
  },
  declined: {
    subject: "{{signer.name}} declined to sign {{document.title}}",
    body: "Hello {{recipient.name}},\n\n{{signer.name}} declined to sign \"{{document.title}}\".\n\nReason: {{reason}}\n\nOpen the document:\n{{link}}",
    button: "Open the document",
  },
  sent: {
    subject: "Sent: {{document.title}}",
    body: "Hello {{recipient.name}},\n\n\"{{document.title}}\" was sent for signature (verification code {{document.code}}). You will be notified as it progresses.\n\nOpen the document:\n{{link}}",
    button: "Open the document",
  },
};

export type EmailOverrides = Partial<Record<EditableEmail, { subject?: string; body?: string }>>;

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5_000;

/** Parse and clamp the stored JSON; anything unusable falls back to the defaults. */
export function parseEmailOverrides(json: string | null | undefined): EmailOverrides {
  try {
    const raw = json ? JSON.parse(json) : {};
    const out: EmailOverrides = {};
    for (const kind of EDITABLE_EMAILS) {
      const t = raw?.[kind];
      if (!t || typeof t !== "object") continue;
      const subject = typeof t.subject === "string" ? t.subject.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_SUBJECT) : "";
      const body = typeof t.body === "string" ? t.body.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY) : "";
      if (subject || body) out[kind] = { ...(subject ? { subject } : {}), ...(body ? { body } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

const fill = (text: string, vars: EmailVars) =>
  text.replace(/\{\{\s*([a-z.]+)\s*\}\}/gi, (_m, key: string) => vars[key as keyof EmailVars] ?? "");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Escaped text as HTML: line breaks kept, bare http(s) URLs made clickable (already escaped, so inert). */
const textHtml = (s: string) => escapeHtml(s)
  .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#0f2a66">${url}</a>`)
  .replace(/\n/g, "<br>");

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * Render one email. The signing or download link always reaches the
 * recipient: if a custom body leaves out {{link}}, it is appended.
 */
export function renderEmail(kind: EmailKind, vars: EmailVars, opts: { overrides?: EmailOverrides; logoUrl?: string | null; brandName?: string } = {}): RenderedEmail {
  const base = EMAIL_DEFAULTS[kind];
  const custom = (EDITABLE_EMAILS as readonly string[]).includes(kind) ? opts.overrides?.[kind as EditableEmail] : undefined;
  let body = custom?.body || base.body;
  if (vars.link && !/\{\{\s*link\s*\}\}/i.test(body)) body += "\n\n{{link}}";
  const subject = fill(custom?.subject || base.subject, vars).replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 250);
  const text = fill(body, vars).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  // HTML: the same text, escaped, as paragraphs; the link line becomes a button.
  const LINK_MARK = "\u0000LINK\u0000";
  const htmlSource = fill(body.replace(/\{\{\s*link\s*\}\}/gi, LINK_MARK), vars).replace(/\n{3,}/g, "\n\n").trim();
  const button = vars.link
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0"><tr><td style="border-radius:8px;background:#0f2a66">` +
      `<a href="${escapeHtml(vars.link)}" style="display:inline-block;padding:12px 22px;font:600 15px/1.2 Arial,sans-serif;color:#ffffff;text-decoration:none">${escapeHtml(base.button ?? "Open")}</a>` +
      `</td></tr></table><p style="margin:0 0 16px;font:12px/1.5 Arial,sans-serif;color:#667085;word-break:break-all">${escapeHtml(vars.link)}</p>`
    : "";
  const paragraphs = htmlSource.split(/\n{2,}/).map((para) => {
    if (para.includes(LINK_MARK)) {
      const [before, ...rest] = para.split(LINK_MARK).map((part) => part.trim());
      const after = rest.filter(Boolean).join(" ");
      return (before ? `<p style="margin:0 0 8px;font:15px/1.6 Arial,sans-serif;color:#101828">${textHtml(before)}</p>` : "") + button +
        (after ? `<p style="margin:0 0 16px;font:15px/1.6 Arial,sans-serif;color:#101828">${textHtml(after)}</p>` : "");
    }
    return `<p style="margin:0 0 16px;font:15px/1.6 Arial,sans-serif;color:#101828">${textHtml(para)}</p>`;
  }).join("");
  const brand = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.brandName ?? "")}" style="max-height:48px;max-width:200px;display:block">`
    : `<span style="font:700 18px Arial,sans-serif;color:#0f2a66">${escapeHtml(opts.brandName ?? "Docurama")}</span>`;
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f2f4f7">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px">` +
    `<tr><td style="padding:24px 28px 8px">${brand}</td></tr>` +
    `<tr><td style="padding:8px 28px 20px">${paragraphs}</td></tr>` +
    `<tr><td style="padding:14px 28px;border-top:1px solid #eaecf0;font:12px/1.5 Arial,sans-serif;color:#667085">Sent with Docurama electronic signatures${vars["document.code"] ? ` · ${escapeHtml(vars["document.code"])}` : ""}</td></tr>` +
    `</table></body></html>`;
  return { subject, text, html };
}
