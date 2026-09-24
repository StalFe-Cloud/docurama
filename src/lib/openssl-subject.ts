/**
 * Certificate subjects for `openssl req`, written to a UTF-8 config file.
 *
 * Passing a subject with `-subj` depends on how the OpenSSL binary receives
 * its arguments: UTF-8 on Linux (it then needs `-utf8`), the legacy code page
 * on Windows (where `-utf8` then rejects it). Either way a workspace named
 * "StålFe" came out as "StÃ¥lFe" on one of them. A config file is read as
 * bytes on every platform, so the name is the same everywhere.
 *
 * The extensions are those the stock openssl.cnf gives a self-signed
 * certificate (v3_ca), so the certificates do not change otherwise.
 */
import { writeFile } from "fs/promises";
import { join } from "path";

/** A config value: one line, none of the characters OpenSSL config syntax treats specially. */
export function configValue(s: string, max = 64): string {
  return s.replace(/[\\/\n\r\0$#"'=,]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export type SubjectField = ["CN" | "O" | "C" | "emailAddress", string];

/** Write `req.cnf` in `dir` for this subject and return its path (use with `-config <path>`). */
export async function writeSubjectConfig(dir: string, subject: SubjectField[]): Promise<string> {
  const lines = [
    "[req]",
    "prompt = no",
    "utf8 = yes",
    "string_mask = utf8only",
    "distinguished_name = dn",
    "x509_extensions = v3",
    "[dn]",
    ...subject.filter(([, value]) => value).map(([key, value]) => `${key} = ${value}`),
    "[v3]",
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid:always,issuer",
    "basicConstraints = critical,CA:true",
    "",
  ];
  const path = join(dir, "req.cnf");
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}
