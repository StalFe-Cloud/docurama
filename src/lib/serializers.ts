/**
 * Serializers that strip sensitive fields before responses leave the server.
 *
 * This is the fix for the original P0-2 vulnerability class: recipient
 * signing tokens (and verification code hashes) must never be serialized
 * into envelope payloads that other signers or workspace members can read.
 */

export type PublicRecipient = {
  id: string; name: string; email: string; role: string;
  status: string; order: number; authMethod: string; signedAt: string | null;
};

export function publicRecipient(r: {
  id: string; name: string; email: string; role: string;
  status: string; order: number; authMethod: string; signedAt: Date | null;
}): PublicRecipient {
  return {
    id: r.id, name: r.name, email: r.email, role: r.role,
    status: r.status, order: r.order, authMethod: r.authMethod,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
  };
}

export function iso<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out as T;
}

export function isos<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(iso);
}

/** An envelope row for JSON responses: dates as ISO strings, without the
 * seal manifest and timestamp token (kilobytes each; the evidence pack and
 * the verify endpoints are where those are served and checked) and without
 * the sealed PDF's internal storage key. */
export function envelopeRow<T extends { sealManifest?: string | null; sealTimestamp?: string | null; signedPdfKey?: string | null; contractText?: string | null; signedPdfRevisions?: string | null; signedPdfCheckAt?: Date | null } & Record<string, unknown>>(e: T) {
  const { sealManifest: _manifest, sealTimestamp: _token, signedPdfKey: _key, signedPdfRevisions: _revisions, signedPdfCheckAt: _check, contractText, ...rest } = e;
  void _manifest; void _token; void _key;
  return { ...iso(rest), hasContractText: Boolean(contractText) };
}

export const jsonError = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status, headers: { "content-type": "application/json" },
  });

export const jsonOk = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
