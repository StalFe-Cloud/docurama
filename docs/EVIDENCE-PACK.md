# Evidence Pack — Format Specification (v1)

An evidence pack is the portable, self-verifying proof of one completed
envelope: everything a counterparty, auditor or court needs to check the
signatures **without any Docurama infrastructure**, packed into a single ZIP
and signed.

- Export: envelope detail sheet → **Evidence pack (.zip)** (workspace session),
  or `GET /api/v1/envelopes/{idOrCode}/evidence-pack` with an `X-API-Key`.
- Only `COMPLETED` + sealed envelopes can be exported; anything else is an
  honest 400.
- Every export is recorded in the envelope's event ledger (`EVIDENCE_EXPORTED`)
  — the audit trail states who pulled evidence and when.

## Contents

| Path | What it is |
|---|---|
| `manifest.json` | Signed manifest: envelope facts, signer roster, every artifact's SHA-256, and the RSA-SHA-256 signature over the canonical JSON payload |
| `verify.html` | Offline verifier — open in any modern browser, select all files, get a verdict. Zero network calls |
| `CERTIFICATE-OF-COMPLETION.html` | Bilingual (FR/EN) human proof certificate; open → print to PDF |
| `document/<file>` | The sealed artefact, byte-exact (PDF when uploaded; `contract-text.md` for template envelopes). If storage no longer holds the file, an honest `FILE-MISSING.txt` is packed instead |
| `evidence/event-ledger.csv` | The complete timestamped event ledger (RFC 4180) |
| `evidence/envelope.json` | Machine-readable envelope record: recipients, statuses, digests |
| `evidence/seal-manifest.json` | Seal v2 only. The canonical manifest the seal digest is computed over: its SHA-256 **is** `envelope.sha256` (see "The seal" below) |
| `evidence/seal-timestamp.tsr` | Seal v2 with a timestamp. The RFC 3161 TimeStampToken (DER) over `seal-manifest.json` |
| `document/<code>-signed.pdf` | Uploaded documents. The sealed PDF: every signature and value stamped in place, a signature-certificate page, and a PAdES digital signature (see "The sealed PDF") |
| `certificate/evidence-key.pem` | The X.509 certificate of the workspace evidence key. When the workspace has a DNS-TXT-verified sending domain, it is embedded as a `subjectAltName DNS:` entry |
| `certificate/evidence-key.pub.pem` | The SPKI public key — the only thing needed to verify the manifest signature |
| `README.txt` | Bilingual instructions |

The ZIP uses the STORE method (no compression): every artifact is byte-exact,
the writer is ~100 auditable lines, and re-hashing a file from the archive
yields exactly the signed digest.

## Manifest structure

```json
{
  "format": "docurama-evidence-pack",
  "version": 1,
  "payload": {
    "format": "docurama-evidence-pack",
    "version": 1,
    "generatedAt": "2026-09-17T09:00:00.000Z",
    "envelope": {
      "code": "DOC-XXXXXXXX", "title": "…", "status": "COMPLETED",
      "pages": 5, "sha256": "…", "conformance": "B-T",
      "createdAt": "…", "sealedAt": "…", "completedAt": "…",
      "verifiedSenderDomain": "mail.company.com",
      "tenantName": "Company SAS"
    },
    "signers": [ { "name": "…", "email": "…", "order": 1, "status": "SIGNED", "signedAt": "…" } ],
    "artifacts": [ { "path": "document/contract.pdf", "sha256": "…", "bytes": 12345 } ],
    "signing": {
      "algorithm": "RSASSA-PKCS1-v1_5-SHA-256",
      "keyId": "ek_…", "keyThumbprint": "…",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----…",
      "certificatePem": "-----BEGIN CERTIFICATE-----…",
      "sanDomain": "mail.company.com", "keyCreatedAt": "…"
    },
    "transparency": {
      "format": "docurama-transparency-v1",
      "entry": { "seq": 12, "payloadHash": "…", "prevHead": "…", "head": "…", "at": "…" },
      "head": { "seq": 17, "head": "…" },
      "segment": [ { "seq": 12, "payloadHash": "…", "prevHead": "…", "head": "…", "at": "…" }, … ],
      "truncated": false,
      "checkpoint": {
        "format": "docurama-transparency-checkpoint",
        "keyId": "ek_…", "size": 17, "head": "…", "at": "…",
        "signature": "base64(RSA-SHA-256 over canonical {format, keyId, size, head, at})"
      }
    }
  },
  "signature": "base64(RSA-SHA-256 over canonicalJson(payload))"
}
```

**Canonical JSON** (`src/lib/canonical-json.ts`, mirrored inside
`verify.html`): object keys sorted recursively, no whitespace, standard JSON
escapes. Any verifier that reproduces those rules reproduces the signed bytes.

## The seal (`docurama-seal/2`)

`envelope.sha256` is the **seal digest**: the SHA-256 of
`evidence/seal-manifest.json`, a canonical JSON document (same rules as the
manifest) that binds:

| Section | Bound values |
|---|---|
| `envelope` | code, title, pages, created and sealed times, DNS-verified sender domain |
| `document` | SHA-256 of the signed file (`null` for a template envelope) |
| `recipients` | every recipient, CCs included: order, name, email, role, authentication method, status, signing time |
| `events` | every audit event up to sealing, with its detail and IP hash (the `SEALED` event carries the digest, so it is not inside it) |
| `fields` | every placed field: type, page, position, assigned signer, label and the value entered or stamped at signing |

Changing any of these after sealing changes the digest. Verification
(`/api/v1/verify/{code}`, the Verify pages, the MCP `document_verify` tool)
rebuilds the manifest from the live records and compares; a difference is
reported as `INTEGRITY_FAILED` with the affected sections, never as verified,
and an evidence pack is refused (409) over modified records. The digest is
also the payload of the envelope's transparency-log commitment, so rewriting
records, manifest and digest together is still detected.

Offline, `verify.html` checks that the shipped `seal-manifest.json` hashes to
the sealed digest and names the shipped document's fingerprint.

Seals made before seal v2 have no `sealFormat`: an upload was sealed with its
file hash alone, a template envelope with the v1 record digest (roster and
event actions only). They are still verified under those rules, and the
Verify pages say what such a seal does not cover.

### RFC 3161 timestamp

Right after sealing, and before the transparency commitment, the manifest is
timestamped by an RFC 3161 authority: the workspace's own TSA when enabled
(Settings, eSign), otherwise the platform TSA (Admin, Settings, or
`SEAL_TSA_URL`). The level recorded is `B-T` with a timestamp and `B-B`
without one. A TSA outage never blocks signing: the failure is logged
(`TIMESTAMP_FAILED`) and the timestamp is retried at the next evidence-pack
export. Check a token with OpenSSL and the TSA's root certificate:

```sh
openssl ts -verify -data evidence/seal-manifest.json -in evidence/seal-timestamp.tsr -token_in -CAfile tsa-root.pem
```

The `B-B` / `B-T` level on the envelope describes the evidence seal; the
sealed PDF's own PAdES level is reported separately (`signedPdfLevel`).

## The sealed PDF (PAdES)

For every envelope, sealing also produces one self-verifying PDF
(`src/lib/signed-pdf.ts`), downloadable by the workspace, by every signer
with their signing link, and through `GET /api/v1/envelopes/{code}/signed-pdf`:

- each adopted signature (typed, drawn, uploaded or saved on the signer's
  account) and each filled value is stamped where the sender placed it;
- a signature-certificate page lists the signers, the seal digest, the
  original document's SHA-256, the seal timestamp and a QR code to the public
  verification page;
- the whole file is signed with PAdES (ETSI EN 319 142-1): a detached CAdES
  signature (`ETSI.CAdES.detached`) with ESS signing-certificate-v2, and an
  RFC 3161 signature timestamp when the TSA answers (`PAdES-B-T`);
- then, as incremental updates that leave the signed bytes untouched
  (`src/lib/ltv.ts`): a Document Security Store with every certificate of the
  seal identity's and the TSA's chains and proof that none was revoked (OCSP
  responses, CRLs when a CA has no OCSP), which is `PAdES-B-LT`; and a
  document timestamp (`ETSI.RFC3161`) over the whole file, which is
  `PAdES-B-LTA` and can be renewed before its TSA certificate expires.
  Missing CA certificates are fetched from the certificates' AIA URLs. When any
  status cannot be obtained, nothing is added and the recorded level stays
  `PAdES-B-T`, with the reason in the `PDF_SEALED` event.

The background worker keeps signed PDFs long-term (`maintainSealedPdfs` in
`src/lib/signed-pdf.ts`, scheduled by `Envelope.signedPdfCheckAt`):

- a file left at `PAdES-B-T` or `PAdES-B-LT` is retried with backoff (15
  minutes up to daily) for 30 days, then a `PDF_LTV_FAILED` event records why;
  success records `PDF_LTV_EXTENDED`;
- a `PAdES-B-LTA` file is renewed a year before the certificate of its latest
  archive timestamp expires: that timestamp's validation data is added to the
  DSS, then a new archive timestamp covers everything (`PDF_ARCHIVE_RENEWED`).
  A renewal is kept only if the TSA's current certificate outlives the old one;
  otherwise it is retried weekly;
- every update is an incremental revision, so an earlier copy is exactly the
  first bytes of the current file. Its SHA-256 and length are kept
  (`Envelope.signedPdfRevisions`), the verify pages accept it as an earlier
  copy, and the pack lists it under `seal.signedPdf.earlierCopies`;
- a stored file whose SHA-256 no longer matches the record is never modified.

For an envelope sent from a template, the contract text is kept exactly as
sent (`Envelope.contractText`), bound into the seal by its SHA-256
(`document.textSha256`), typeset as the PDF's pages with a signatures section,
and exported as `document/contract-text.md`. Editing the template later
changes nothing already sent.

Any PDF reader validates it (Acrobat's Signature panel, `pdfsig`), and any
change to the file after sealing breaks the signature. The signer is the
workspace **seal identity**, assigned automatically (`src/lib/seal-identity.ts`):
the active sealing certificate when the workspace has one (issued in
Settings > eSign, or a CA-issued `.p12` imported there, stored encrypted under
`DOCURAMA_KEY_ENCRYPTION_KEY`), otherwise the workspace evidence key. A
certificate chaining to the Adobe Approved Trust List (or a qualified seal
certificate) is what makes readers show the signer as trusted; the
self-signed evidence key proves integrity and time, and shows as not yet
trusted.

The original upload stays the fingerprint the seal binds; the sealed PDF's
own SHA-256 is recorded on the envelope (`PDF_SEALED` event) and reported by
verification, so "check your copy" recognises either file.

### The transparency block

Every pack carries an **inclusion proof** in the workspace's append-only hash
chain (see `docs/TRANSPARENCY-LOG.md`): the envelope's chain entry, the
segment of entries from it to the current head, and a checkpoint signed by the
same evidence key. `verify.html` re-hashes the entire chain offline:

- `entry.payloadHash` = SHA-256 of the canonical seal commitment
  `{code, sha256, sealedAt, conformance, pages, signerCount}` — recomputed
  from the manifest's own fields, so the entry provably commits to THIS pack;
- every segment entry — including the first — re-hashes from
  `{seq, payloadHash, prevHead, at}`, and each `prevHead` links to the
  previous head: rewriting any entry breaks the chain at that point;
- the checkpoint covers exactly the segment's last head, under the pack key.

Envelopes sealed before the registry existed are committed lazily at first
export — the same way CT logs treat previously-issued certificates; the
commitment itself still carries the true `sealedAt`.

## Verifying offline

1. Unzip the pack.
2. Open `verify.html` in a modern browser (works from `file://`, emits no
   network requests).
3. Select **all** files of the pack, including `manifest.json`.
4. The page:
   - imports the SPKI public key and verifies the manifest signature
     (WebCrypto, RSASSA-PKCS1-v1_5 + SHA-256);
   - re-hashes every artifact listed in the manifest and compares against the
     signed digests;
   - re-hashes the transparency chain from the entry to the signed checkpoint
     (see above) and shows the registry position;
   - shows the envelope facts, the key id/thumbprint and the SAN domain.

Anything altered after export shows as `ALTÉRÉ / ALTERED` and/or an invalid
manifest signature. A deep-check harness for this exact flow lives at
`scripts/verify-offline-check.ts` (drives real Chromium against a freshly
exported pack).

## Trust model, stated honestly

- The evidence key is a **self-signed** RSA-2048 certificate held by the
  workspace's instance. What vouches for it:
  1. **DNS** — a SAN domain in the certificate was proven controlled by the
     tenant via the `_docurama.<domain> TXT` record **before issuance**;
  2. **TOFU pinning** — on the public verification portal, the first key an
     instance registers is pinned and every later attestation must match it.
- The manifest signature proves *integrity and origin* (which key produced the
  pack) — binding that key to a legal identity is what the DNS SAN and the
  portal registry provide.
- Docurama is **not** an eIDAS QTSP; the certificate and the conformance level
  state exactly what was applied, nothing more.

## Relation to the public portal

The same evidence key signs the **portal attestation** pushed at seal time
(see `docs/SELF-HOSTED-ATTESTATION.md`): the portal result, the evidence pack
and the offline verifier all anchor on the same key and the same SHA-256
digest. A third party can cross-check the pack against
`verify.docurama.eu/{code}` — or, if the instance is unreachable, rely on the
pack alone.
