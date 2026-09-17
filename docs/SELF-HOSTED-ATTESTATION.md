# Self-Hosted Attestation Protocol (v1)

**The problem.** A sealed envelope on a self-hosted / on-prem Docurama
instance is invisible to the public verification portal: the portal's database
has no row for it, so a counterparty holding the verification code gets
`NOT_FOUND` — indistinguishable from a fake code. Enterprise customers keep
their documents inside their own infrastructure (that is why they
self-host), but they still need third parties to be able to check the
signature evidence.

**The answer.** The instance pushes a *minimal signed fingerprint* — an
attestation — to the public portal at seal time. The portal serves it like a
verification result, clearly labeled as attested by a self-hosted instance.
No document bytes, no personal data, ever.

## Configuration

```bash
# .env of the self-hosted instance
EVIDENCE_PORTAL_URL=https://verify.docurama.eu
```

- Unset (default): no push, nothing leaves the instance. The cloud platform
  itself never sets it — cloud envelopes are verified locally.
- On seal, the instance signs and POSTs the attestation (8s timeout,
  non-fatal: a portal outage never blocks a signer). Success is recorded in
  the envelope ledger (`ATTESTED`); failure sets `attestStatus: FAILED` on the
  envelope row — the ledger never claims a push that did not happen.
- The push is one outbound HTTPS request — it works behind NAT/firewalls; the
  instance does not need to be internet-reachable.

## The payload

`POST {EVIDENCE_PORTAL_URL}/api/attestations` with `{ payload, signature }`:

```json
{
  "payload": {
    "format": "docurama-attestation",
    "version": 1,
    "instance": { "keyId": "ek_…", "label": "Company SAS", "verifiedDomain": "mail.company.com" },
    "envelope": {
      "code": "DOC-XXXXXXXX", "sha256": "…",
      "sealedAt": "…", "completedAt": "…",
      "conformance": "B-T", "pages": 5, "signerCount": 2
    },
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----…",
    "certificatePem": "-----BEGIN CERTIFICATE-----…",
    "keyThumbprint": "<sha256 of the certificate DER, lowercase hex>"
  },
  "signature": "base64(RSA-SHA-256 over canonicalJson(payload))"
}
```

GDPR posture: **zero personal data** — no signer names, no emails, no title,
no document bytes. `label` and `verifiedDomain` are organization-level facts
the instance operator opted into by configuring the push.

## Receiver rules (`/api/attestations`)

1. Shape validation (code format, 64-hex digest, bounded integers, PEM
   headers), 16 KB body cap.
2. `keyThumbprint` must equal SHA-256 of the presented `certificatePem` DER.
3. `signature` must verify with `publicKeyPem` over the canonical payload.
4. **TOFU registration**: the first key presenting a thumbprint is pinned as
   that instance. Later pushes with the same thumbprint but different key or
   certificate material are **rejected** (400).
5. **Code ownership**: the first instance to attest a code owns it; a
   different instance claiming the same code gets **409**.
6. Idempotent re-push: same instance, same code → the fingerprint is updated
   (a re-seal produces a new digest), `registered: false`, HTTP 200. First
   registration answers **201**.

Responses: `201 {ok, registered:true}` · `200 {ok, registered:false}` ·
`400 {error}` (validation / signature / pinning) · `409 {error}` (code
ownership).

## What the portal answers

`GET /api/v1/verify/{code}` checks **local envelopes first**; on a miss it
checks attestations:

```json
{
  "result": "VERIFIED_ATTESTED",
  "code": "DOC-XXXXXXXX",
  "attestation": {
    "sha256": "…", "sealedAt": "…", "completedAt": "…", "conformance": "B-T",
    "pages": 5, "signerCount": 2, "verifiedDomain": "mail.company.com",
    "instance": { "label": "Company SAS", "firstSeenAt": "…", "attestationCount": 17 }
  }
}
```

The UI renders it distinctly — "Verified — attested by a self-hosted Docurama
instance" — and says plainly what the portal holds (the pushed fingerprint)
and what it does not (the document).

## Trust model and honest limits

- **TOFU is the anchor.** The portal vouches that *the key first seen on
  date X* attests this fingerprint. It cannot vouch for who originally
  operated that instance — that binding comes from the enterprise
  relationship (license, contract) and from the DNS-verified domain shown in
  the result.
- **A malicious instance can attest its own codes.** So can anyone print a
  PDF claiming anything — the attestation is evidence *about a key*, not a
  court judgment. The evidence pack (offline-verifiable, `docs/EVIDENCE-PACK.md`)
  is the strong artifact; the attestation is the cheap public lookup.
- **Key rotation** requires re-registering a new thumbprint (a new instance
  identity) and re-attesting live codes. Acceptable today; see upgrade paths.

### Upgrade paths (documented, not claimed)

1. **License-signed keys**: the Enterprise license flow issues
   Docurama-signed attestation keys — the portal verifies a real chain
   instead of TOFU. Natural next step once licensing exists.
2. **Transparency registry**: append-only public log of registered keys and
   attestations (certificate-transparency style) — makes TOFU auditable.
3. **Offline fallback** (already shipped): the evidence pack + `verify.html`
   needs no portal at all — the firewall-proof path.

## Test coverage

- `e2e/evidence.test.ts` runs the full loopback against the live receiver:
  TOFU registration, idempotent re-push, tampered signature (400), stolen
  thumbprint (400), pinned-key swap (400), cross-instance code claim (409),
  and the verify engine serving `VERIFIED_ATTESTED`.
- `e2e/seed.ts` fixtures a realistic remote instance ("Acme Corp
  (self-hosted fixture)", DNS-verified `acme-corp.example`) for the
  `public/verify-attested.yaml` Maestro flow.
- End-to-end push (seal → sign → POST → registry) is exercised by the
  signer-journey suite when `EVIDENCE_PORTAL_URL` points at the app itself.
