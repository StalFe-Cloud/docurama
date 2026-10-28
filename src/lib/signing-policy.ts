/** Policy shared by token signing and document reads. A bearer invitation
 * proves possession of the private link — factor one. Workspaces that demand
 * stronger assurance (requireReauth / Part 11) raise the verification floor
 * instead of blocking signing outright: the signer must then complete a
 * second factor (OTP or an authenticated account match) before signing. */

export const SUPPORTED_SIGNATURE_LEVEL = "simple";

export const SIGNER_AUTH_METHODS = ["EMAIL", "EMAIL_OTP", "SMS_OTP", "EMAIL_AND_SMS_OTP"] as const;
export type SignerAuthMethod = (typeof SIGNER_AUTH_METHODS)[number];

export type SigningTenant = {
  status: string;
  esignPrefs?: { requireReauth: boolean; part11Mode: boolean; signatureLevel: string; defaultSignerAuth?: string } | null;
};

export function signatureAssuranceRestriction(level: unknown): string | null {
  return level === SUPPORTED_SIGNATURE_LEVEL ? null :
    "This signing flow supports email-link typed signing only. The required assurance level is unsupported; a workspace administrator must review and explicitly change the policy before signing.";
}

export function signerReadRestriction(tenant: SigningTenant): string | null {
  return tenant.status === "SUSPENDED" ? "This document is not available for signing." : null;
}

export function signerAuthenticationRestriction(tenant: SigningTenant): string | null {
  if (tenant.esignPrefs) {
    const assurance = signatureAssuranceRestriction(tenant.esignPrefs.signatureLevel);
    if (assurance) return assurance;
  }
  return null;
}

export function normalizeSignerAuthMethod(value: unknown): SignerAuthMethod {
  const raw = String(value ?? "").trim().toUpperCase();
  return (SIGNER_AUTH_METHODS as readonly string[]).includes(raw) ? raw as SignerAuthMethod : "EMAIL";
}

/** True when the method demands a second factor beyond the private link. */
export function methodRequiresVerification(method: unknown): boolean {
  return normalizeSignerAuthMethod(method) !== "EMAIL";
}

/** Channels a method may deliver its code over. */
export function methodChannels(method: unknown): Array<"EMAIL" | "SMS"> {
  switch (normalizeSignerAuthMethod(method)) {
    case "EMAIL_OTP": return ["EMAIL"];
    case "SMS_OTP": return ["SMS"];
    case "EMAIL_AND_SMS_OTP": return ["EMAIL", "SMS"];
    default: return [];
  }
}

/** Effective method for a recipient: their own setting raised to the
 * workspace floor — requireReauth / Part 11 demand a second factor. */
export function effectiveSignerAuthMethod(recipientMethod: unknown, tenant: SigningTenant): SignerAuthMethod {
  const method = normalizeSignerAuthMethod(recipientMethod);
  const enforced = Boolean(tenant.esignPrefs?.requireReauth || tenant.esignPrefs?.part11Mode);
  return enforced && method === "EMAIL" ? "EMAIL_OTP" : method;
}
