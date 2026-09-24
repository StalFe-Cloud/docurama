/**
 * Encryption at rest for private keys the server must be able to use:
 * workspace sealing certificates (issued here or imported from a CA).
 *
 * Keys are sealed with AES-256-GCM under DOCURAMA_KEY_ENCRYPTION_KEY, a
 * 32-byte operator secret (64 hex characters or base64) kept outside the
 * database, so a database copy alone does not yield usable keys. Format:
 *
 *   gcm1:<iv b64>:<tag b64>:<ciphertext b64>
 *
 * Without the variable, keys the platform generates itself are stored as
 * `plain:<b64>` (the same posture as the workspace evidence key) and the
 * go-live checklist flags it. Keys imported from a third-party CA are never
 * stored that way: importing requires the key encryption key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export class KeyVaultError extends Error {}

function kek(): Buffer | null {
  const raw = (process.env.DOCURAMA_KEY_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new KeyVaultError("DOCURAMA_KEY_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}

/** True when keys are encrypted at rest. */
export function keyVaultConfigured(): boolean {
  return kek() !== null;
}

export function sealSecret(plaintext: string, opts: { requireEncryption?: boolean } = {}): string {
  const key = kek();
  if (!key) {
    if (opts.requireEncryption) {
      throw new KeyVaultError("Set DOCURAMA_KEY_ENCRYPTION_KEY on the server before importing a private key: imported keys are only stored encrypted.");
    }
    return `plain:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `gcm1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

export function openSecret(stored: string): string {
  if (stored.startsWith("plain:")) return Buffer.from(stored.slice(6), "base64").toString("utf8");
  const [format, iv, tag, ciphertext] = stored.split(":");
  if (format !== "gcm1" || !iv || !tag || !ciphertext) throw new KeyVaultError("Unknown key storage format");
  const key = kek();
  if (!key) throw new KeyVaultError("This key is encrypted and DOCURAMA_KEY_ENCRYPTION_KEY is not set");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new KeyVaultError("The key could not be decrypted: DOCURAMA_KEY_ENCRYPTION_KEY does not match the one it was stored with");
  }
}
