import type { SmtpMode } from "@/lib/mail";

/** Purpose-specific sending identities. Each category can ride its own mailbox
 * (e.g. invites@/reminders@/receipts@/security@ on a dedicated relay) so every
 * flow keeps a consistent, reputation-isolated sender instead of one generic
 * mailbox. Categories are derived from the outbox row's template — no schema. */
export type MailCategory = "invites" | "notifications" | "receipts" | "reminders" | "security";

const TEMPLATE_CATEGORY: Record<string, MailCategory> = {
  SIGN_INVITE: "invites",
  TEAM_INVITE: "invites",
  COPY_NOTICE: "notifications",
  TEST: "notifications",
  REMINDER: "reminders",
  SIGN_RECEIPT: "receipts",
  SIGN_COMPLETED: "receipts",
  SIGNUP_VERIFICATION: "security",
  PASSWORD_RESET: "security",
  SIGNER_CODE: "security",
};

export function categoryForTemplate(template: string | null | undefined): MailCategory {
  return TEMPLATE_CATEGORY[(template ?? "").trim().toUpperCase()] ?? "notifications";
}

const CATEGORY_ENV_SUFFIX: Record<MailCategory, string> = {
  invites: "INVITES",
  notifications: "NOTIFICATIONS",
  receipts: "RECEIPTS",
  reminders: "REMINDERS",
  security: "SECURITY",
};

/** Per-category SMTP transport override. A category identity activates only
 * when its own SMTP_URL_<CATEGORY> exists; dispatch falls back to the generic
 * transport otherwise, so provisioning mailboxes never breaks delivery. */
export function categorySmtpMode(category: MailCategory): SmtpMode | null {
  const raw = process.env[`SMTP_URL_${CATEGORY_ENV_SUFFIX[category]}`]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["smtp:", "smtps:"].includes(url.protocol)) throw new Error("protocol");
    return { configured: true, url, tls: url.searchParams.get("tls") !== "off" };
  } catch {
    console.warn(`[mail] Invalid SMTP_URL_${CATEGORY_ENV_SUFFIX[category]}; using the generic transport`);
    return null;
  }
}

/** True when at least one per-category transport is configured — relevant when
 * the generic SMTP_URL is unset but dedicated mailboxes are provisioned. */
export function hasCategorySmtp(): boolean {
  return (Object.keys(CATEGORY_ENV_SUFFIX) as MailCategory[]).some(c => categorySmtpMode(c) !== null);
}
