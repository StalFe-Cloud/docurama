import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { configValue, writeSubjectConfig } from "@/lib/openssl-subject";

/**
 * One-click signing-certificate provisioning.
 *
 * Issues a real X.509 certificate (RSA-2048, SHA-256, self-signed for
 * workspace signing) via the system OpenSSL, packages it as an encrypted
 * PKCS#12 (.p12) file, and returns everything the caller needs. The
 * passphrase is never persisted and only the passphrase-encrypted PKCS#12
 * blob is stored, so downloading it later is safe.
 *
 * A personal signing certificate's private key is never kept. A sealing
 * certificate's key is returned (`keepPrivateKey`) so the server can seal
 * with it; the caller stores it encrypted (src/lib/key-vault.ts).
 */

const run = promisify(execFile);

export type IssuedCertificate = {
  pkcs12Base64: string;
  certificatePem: string;
  serialNumber: string;
  thumbprint: string; // SHA-256 colon-separated
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  /** Only with `keepPrivateKey`: PKCS#8 PEM, for server-side sealing. */
  privateKeyPem?: string;
};

/** Strip characters that would break an OpenSSL -subj string. */
const subjSafe = (s: string, max = 64) =>
  s.replace(/[\/\\\n\r\0]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function issueSigningCertificate(opts: {
  commonName: string;
  organization?: string;
  email?: string;
  days: number;
  purpose: string; // "signing" | "sealing"
  passphrase: string;
  keepPrivateKey?: boolean;
}): Promise<IssuedCertificate> {
  const cn = subjSafe(opts.commonName);
  if (!cn) throw new Error("Common name is required");
  if (opts.passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters");

  const dir = await mkdtemp(join(tmpdir(), "docurama-cert-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    const p12Path = join(dir, "cert.p12");
    const serial = `0x${randomBytes(16).toString("hex").toUpperCase()}`;

    // The subject goes in a UTF-8 config file, not -subj: see src/lib/openssl-subject.ts.
    const config = await writeSubjectConfig(dir, [
      ["CN", configValue(cn)],
      ["O", opts.organization ? configValue(opts.organization) : ""],
      ["C", "FR"],
      ["emailAddress", opts.email && /.+@.+\..+/.test(opts.email) ? configValue(opts.email, 254) : ""],
    ]);

    // 1. Key pair + self-signed X.509 certificate
    await run("openssl", [
      "req", "-x509", "-utf8", "-config", config, "-newkey", "rsa:2048", "-sha256",
      "-days", String(Math.min(1095, Math.max(30, opts.days))),
      "-nodes", "-keyout", keyPath, "-out", certPath,
      "-set_serial", serial,
    ]);

    // 2. Inspect the issued certificate (serial, fingerprint, dates, issuer)
    const info = await run("openssl", [
      "x509", "-in", certPath, "-noout",
      "-serial", "-fingerprint", "-sha256", "-dates", "-issuer", "-nameopt", "RFC2253",
    ]);
    const txt = info.stdout;
    const serialNumber = (txt.match(/serial=([0-9A-Fa-f]+)/)?.[1] ?? serial).toUpperCase();
    const thumbprint = (txt.match(/sha256 Fingerprint=([0-9A-F:]+)/)?.[1] ?? "").toUpperCase();
    const notBefore = new Date(txt.match(/notBefore=(.+)/)?.[1] ?? Date.now());
    const notAfter = new Date(txt.match(/notAfter=(.+)/)?.[1] ?? Date.now());
    const issuer = txt.match(/issuer=\s*(.+)/)?.[1]?.trim() ?? `CN=${cn}`;

    // 3. Encrypted PKCS#12 bundle (AES-256-CBC + PBKDF2, modern default)
    await run("openssl", [
      "pkcs12", "-export",
      "-inkey", keyPath, "-in", certPath,
      "-name", `Docurama ${opts.purpose === "sealing" ? "Sealing" : "Signing"} Certificate - ${cn}`,
      "-passout", `pass:${opts.passphrase}`,
      "-out", p12Path,
    ]);

    const [p12, pem, key] = await Promise.all([
      readFile(p12Path), readFile(certPath, "utf8"), opts.keepPrivateKey ? readFile(keyPath, "utf8") : Promise.resolve(undefined),
    ]);
    if (!thumbprint) throw new Error("Failed to read certificate fingerprint");

    return {
      pkcs12Base64: p12.toString("base64"),
      certificatePem: pem,
      serialNumber, thumbprint, issuer, notBefore, notAfter,
      ...(key ? { privateKeyPem: key } : {}),
    };
  } finally {
    // The key file lives only in the temp dir - destroy it.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A short, displayable fingerprint: first 8 groups of the SHA-256 hex. */
export function shortThumbprint(thumbprint: string): string {
  return thumbprint.split(":").slice(0, 8).join(":");
}
