/**
 * Browser-safe consent types (ported from the server module; digest
 * computation stays server-side in the original platform).
 */

export type ConsentTerms = { schema: 1; text: string; version: string; digest: string };
export type ConsentPreferences = { consentText: string | null; consentVersion: string };
export class ConsentTermsError extends Error {}
