/** Signer verification: one-time codes over email/SMS and the short-lived
 * signing session they (or an authenticated account match) establish.
 *
 * Recipients never hold an account: the private link is factor one, the
 * challenge the second. Codes are stored hashed — the raw value only exists
 * in the delivered message. The signing session is a verified challenge row
 * referenced by an HttpOnly cookie; it grants the signing mutation only,
 * never replaces the link, and expires after 15 minutes.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { resolveConfiguredMailSender } from "@/lib/mail-sender";
import { SIGNER_AUTH_METHODS, type SignerAuthMethod } from "@/lib/signing-policy";
import type { SignatureAuthMethod } from "@/lib/signature-data";

export const SIGN_SESSION_COOKIE = "docurama_sign_session";

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
export const MAX_CODE_SENDS = 5;
export const MAX_VERIFY_ATTEMPTS = 5;

export class SignerAuthError extends Error {
  constructor(message: string, readonly status: number = 400) { super(message); }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Small in-memory throttle for code requests (per process; shared ingress
 * limits remain the edge's responsibility, as with login throttling). */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function otpRequestAllowed(key: string, limit = 10, windowMs = 5 * 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}•••${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  return `••• ${phone.replace(/\D/g, "").slice(-4)}`;
}

/** HttpOnly cookie attributes; the signing session is far shorter-lived than
 * an account session, so only the Max-Age differs from the session pattern. */
export function signSessionCookieAttributes(request: Request): string {
  const proto =
    (process.env.DOCURAMA_TRUST_PROXY_HEADERS === "1" ? request.headers.get("x-forwarded-proto") : null) ??
    (request.url.startsWith("https:") ? "https" : "http");
  const isHttps = proto.split(",")[0].trim() === "https";
  return isHttps
    ? "Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=900"
    : "Path=/; HttpOnly; SameSite=Lax; Max-Age=900";
}

export function signSessionCookieValue(challengeId: string, secret: string): string {
  return `${challengeId}.${secret}`;
}

export function parseSignSession(raw: string | undefined | null): { challengeId: string; secret: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 1 || dot === raw.length - 1) return null;
  const challengeId = raw.slice(0, dot), secret = raw.slice(dot + 1);
  return /^c[a-z0-9]{20,}$/i.test(challengeId) && secret.length >= 32 ? { challengeId, secret } : null;
}

type LiveRecipient = { id: string; email: string; name: string; envelopeId: string; envelopeTitle: string; tenantId: string };

/** Request a one-time code over the given channel. One live challenge per
 * (recipient, channel); re-requests refresh it under a cooldown and a send
 * budget. EMAIL codes ride the durable outbox (no signing link inside); SMS
 * codes dispatch through the tenant gateway immediately. */
export async function issueSignerChallenge(
  recipient: LiveRecipient,
  channel: "EMAIL" | "SMS",
  phone: string | null,
  locale: string | null,
): Promise<{ maskedDestination: string }> {
  const now = new Date();
  const normalizedPhone = channel === "SMS"
    ? (() => {
        const raw = (phone ?? "").replace(/[\s()-]/g, "");
        if (!/^\+?[1-9]\d{6,14}$/.test(raw)) throw new SignerAuthError("Enter a valid phone number in international format (e.g. +33612345678).");
        return raw.startsWith("+") ? raw : `+${raw}`;
      })()
    : null;
  if (!otpRequestAllowed(`${recipient.id}:${channel}`)) {
    throw new SignerAuthError("Too many code requests. Please try again in a few minutes.", 429);
  }
  const existing = await db.signerChallenge.findUnique({
    where: { recipientId_channel: { recipientId: recipient.id, channel } },
  });
  if (existing && existing.lastSentAt && now.getTime() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new SignerAuthError("Please wait a minute before requesting another code.", 429);
  }
  if (existing && existing.sendCount >= MAX_CODE_SENDS) {
    throw new SignerAuthError("Too many codes have been sent for this signer. Contact the sender.", 429);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const secret = randomBytes(32).toString("base64url");
  await db.signerChallenge.upsert({
    where: { recipientId_channel: { recipientId: recipient.id, channel } },
    create: {
      recipientId: recipient.id, channel, phone: normalizedPhone,
      secretHash: sha256(secret), codeHash: sha256(`${recipient.id}:${code}`),
      sendCount: 1, attempts: 0, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
    update: {
      phone: normalizedPhone, secretHash: sha256(secret), codeHash: sha256(`${recipient.id}:${code}`),
      sendCount: { increment: 1 }, attempts: 0, lastSentAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      verifiedAt: null, verifiedUntil: null, consumedAt: null,
    },
  });
  const maskedDestination = channel === "EMAIL" ? maskEmail(recipient.email) : maskPhone(normalizedPhone!);
  if (channel === "EMAIL") {
    const fr = /^fr(?:-|$)/i.test(locale ?? "");
    // SPF/DKIM alignment: the security identity is used only when the
    // security category actually rides its own transport.
    const { categorySmtpMode } = await import("@/lib/mail-identities");
    const securityTransport = categorySmtpMode("security")?.configured ? "security" : undefined;
    const fromEmail = await resolveConfiguredMailSender(db, { tenantId: recipient.tenantId, required: false, category: securityTransport });
    await db.mailOutbox.create({ data: {
      envelopeId: recipient.envelopeId, recipientId: recipient.id, toEmail: recipient.email,
      template: "SIGNER_CODE", status: "QUEUED",
      subject: fr ? "Votre code de vérification Docurama" : "Your Docurama verification code",
      // Deliberately link-free: the invitation email already carries the
      // private link; the code must be a separate factor, not a second copy.
      bodyText: (fr
        ? `Bonjour ${recipient.name},\n\nVotre code de vérification pour « ${recipient.envelopeTitle} » est : ${code}\n\nIl expire dans 10 minutes. Ne partagez jamais ce code. Si vous n'avez pas demandé ce code, ignorez ce message.`
        : `Hello ${recipient.name},\n\nYour verification code for "${recipient.envelopeTitle}" is: ${code}\n\nIt expires in 10 minutes. Never share this code. If you did not request it, ignore this message.`) + "\n\nDocurama",
      ...(fromEmail ? { fromEmail } : {}),
    } });
    const { processOutbox } = await import("@/lib/mail");
    void processOutbox(5).catch(() => undefined);
  } else {
    const { sendSmsThroughGateway } = await import("@/lib/sms");
    await sendSmsThroughGateway(recipient.tenantId, normalizedPhone!, code, recipient.name, recipient.envelopeTitle);
  }
  return { maskedDestination };
}

/** Verify a code across the method's channels (all of them for
 * EMAIL_AND_SMS_OTP). On final verification the primary channel row becomes
 * the signing session and its secret is returned for the cookie. */
export async function verifySignerChallenge(
  recipientId: string,
  method: SignerAuthMethod,
  code: string,
): Promise<{ cookieValue: string; channelsVerified: string[] } | { pending: string[] }> {
  const now = new Date();
  const submitted = String(code ?? "").replace(/\D/g, "");
  if (submitted.length !== 6) throw new SignerAuthError("Enter the 6-digit code.");
  const channels = method === "EMAIL_OTP" ? ["EMAIL"] : method === "SMS_OTP" ? ["SMS"] : ["EMAIL", "SMS"];
  const rows = await db.signerChallenge.findMany({ where: { recipientId, channel: { in: channels } } });
  const live = rows.filter(r => !r.consumedAt && r.expiresAt > now);
  if (!live.length) throw new SignerAuthError("No active code. Request a new one.", 400);
  const target = live.find(r => digestsEqual(sha256(`${recipientId}:${submitted}`), r.codeHash));
  if (!target) {
    const claimed = await db.signerChallenge.updateMany({
      where: { id: { in: live.map(r => r.id) }, attempts: { lt: MAX_VERIFY_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) throw new SignerAuthError("Too many incorrect attempts. Request a new code.", 429);
    throw new SignerAuthError("That code is not correct. Check the latest message and try again.", 400);
  }
  const sessionUntil = new Date(now.getTime() + SESSION_TTL_MS);
  await db.signerChallenge.update({
    where: { id: target.id },
    data: { verifiedAt: now, verifiedUntil: sessionUntil },
  });
  // EMAIL_AND_SMS_OTP mints the session only once every channel verified;
  // single-channel methods complete here.
  const verifiedByChannel = new Map(live.map(r => [r.channel, r]));
  verifiedByChannel.set(target.channel, { ...target, verifiedUntil: sessionUntil });
  const stillPending = channels.filter(c => {
    const row = verifiedByChannel.get(c);
    return !row || !row.verifiedUntil || row.verifiedUntil <= now;
  });
  if (stillPending.length) return { pending: stillPending };
  const primary = rows.find(r => r.channel === channels[0]) ?? target;
  const secret = randomBytes(32).toString("base64url");
  await db.signerChallenge.update({
    where: { id: primary.id },
    data: { verifiedAt: now, verifiedUntil: sessionUntil, secretHash: sha256(secret), attempts: 0 },
  });
  return { cookieValue: signSessionCookieValue(primary.id, secret), channelsVerified: channels };
}

/** Authenticated-account path: a signed-in user whose account email matches
 * the recipient mints the same signing session without an OTP round-trip. */
export async function establishAccountSignerSession(recipientId: string): Promise<string> {
  const now = new Date();
  const secret = randomBytes(32).toString("base64url");
  const row = await db.signerChallenge.upsert({
    where: { recipientId_channel: { recipientId, channel: "ACCOUNT" } },
    create: {
      recipientId, channel: "ACCOUNT", secretHash: sha256(secret),
      codeHash: sha256(`account:${recipientId}:${randomBytes(16).toString("hex")}`),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      verifiedAt: now, verifiedUntil: new Date(now.getTime() + SESSION_TTL_MS),
    },
    update: {
      secretHash: sha256(secret), attempts: 0, consumedAt: null,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      verifiedAt: now, verifiedUntil: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });
  return signSessionCookieValue(row.id, secret);
}

/** Validate the signing session for a recipient. Returns the realized
 * verification channel(s), or null when absent/expired/foreign. */
export async function readSignerSession(
  recipientId: string,
  raw: string | undefined | null,
): Promise<{ channels: Array<"EMAIL" | "SMS" | "ACCOUNT"> } | null> {
  const parsed = parseSignSession(raw);
  if (!parsed) return null;
  const challenge = await db.signerChallenge.findUnique({ where: { id: parsed.challengeId } });
  const now = new Date();
  if (!challenge || challenge.recipientId !== recipientId || challenge.consumedAt
    || !challenge.verifiedUntil || challenge.verifiedUntil <= now
    || !digestsEqual(sha256(parsed.secret), challenge.secretHash)) return null;
  const channels: Array<"EMAIL" | "SMS" | "ACCOUNT"> = [challenge.channel as "EMAIL" | "SMS" | "ACCOUNT"];
  if (challenge.channel === "EMAIL" || challenge.channel === "SMS") {
    const sibling = await db.signerChallenge.findUnique({
      where: { recipientId_channel: { recipientId, channel: challenge.channel === "EMAIL" ? "SMS" : "EMAIL" } },
    });
    if (sibling && !sibling.consumedAt && sibling.verifiedUntil && sibling.verifiedUntil > now) channels.push(sibling.channel as "SMS" | "EMAIL");
  }
  return { channels };
}

/** Spend the session after a sign or decline so a replayed cookie cannot act twice. */
export async function consumeSignerSession(raw: string | undefined | null): Promise<void> {
  const parsed = parseSignSession(raw);
  if (!parsed) return;
  await db.signerChallenge.updateMany({ where: { id: parsed.challengeId, consumedAt: null }, data: { consumedAt: new Date() } });
}

/** Evidence label for the realized verification path. */
export function evidenceAuthMethod(method: SignerAuthMethod, channels: Array<"EMAIL" | "SMS" | "ACCOUNT">): SignatureAuthMethod {
  if (channels.includes("ACCOUNT")) return "ACCOUNT_SESSION";
  const hasEmail = channels.includes("EMAIL"), hasSms = channels.includes("SMS");
  if (hasEmail && hasSms) return "EMAIL_AND_SMS_OTP";
  if (hasSms) return "SMS_OTP";
  if (hasEmail) return "EMAIL_OTP";
  return method === "EMAIL" ? "EMAIL_LINK" : method;
}

/** Guard: the public method catalogue must stay the single source of truth. */
void SIGNER_AUTH_METHODS;
