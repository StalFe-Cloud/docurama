# Transparency Registry — Design and Trust Specification (v1)

Docurama runs a miniature **Certificate Transparency** system for signature
evidence: two append-only, hash-chained logs that make history rewriting
*provable*, with zero external services and zero licence fees.

```
┌─────────────────────────┐         attestation push          ┌──────────────────────────┐
│  INSTANCE (per tenant)  │ ────────────────────────────────► │  PUBLIC PORTAL (global)  │
│                         │   payload.transparency claim      │                          │
│  TransparencyEntry      │                                   │  PortalLogEntry          │
│  seq 1 → 2 → 3 → …      │   the portal WITNESSES the       │  seq 1 → 2 → 3 → …       │
│  hash-chained           │   claimed chain position          │  hash-chained            │
│  prevHead → head        │                                   │  prevHead → head         │
└───────────┬─────────────┘                                   └───────────┬──────────────┘
            │                                                             │
            │ entry + segment + SIGNED CHECKPOINT                        │ signed checkpoint
            ▼                                                             ▼
   evidence pack (verify.html, offline)                        GET /api/transparency/checkpoint
                                                              GET /api/transparency/proof/{code}
```

## Why it exists

Before this registry, every trust anchor was *stateful but mutable*:

- TOFU pinning on the portal catches **key substitution** after first contact,
  but nothing stops an instance (or an attacker with its database) from
  **rewriting its own history** — re-anchoring an old code at a new position,
  or quietly changing what a fingerprint claimed.
- The portal itself holds rows in a database it could, in principle, edit.

An append-only, hash-chained, externally-witnessed log removes both gaps:
changing any entry changes every subsequent head, which contradicts what the
other side already witnessed. This is exactly the argument that made
Certificate Transparency the standard answer to "nobody trusts CAs blindly
anymore" — scaled down to Docurama's size, with the same gossip model.

## The two chains

### 1. Instance chain (`TransparencyEntry`, per tenant)

Every sealed envelope appends one entry committing to its **seal commitment**:

```json
{ "code": "DOC-XXXXXXXX", "sha256": "…", "sealedAt": "…",
  "conformance": "B-T", "pages": 5, "signerCount": 2 }
```

- `payloadHash = SHA-256(canonicalJson(commitment))`
- `entryHash = SHA-256(canonicalJson({seq, payloadHash, prevHead, at}))`
- `prevHead` = the previous entry's `entryHash` (all-zero at genesis).

Appends happen at seal time (and lazily at export/push for envelopes sealed
before the registry existed — same posture as CT logging previously-issued
certificates). A re-seal (new digest) appends a **new** entry; history is
never rewritten, only extended. The append is idempotent per
`(tenant, envelope, commitment)` and non-fatal by design — the log can never
block a seal.

The claim travels **inside the signed attestation payload**, so it cannot be
stripped or altered without breaking the signature that covers it.

### 2. Portal log (`PortalLogEntry`, global)

Every attestation the public receiver accepts appends one entry witnessing the
instance's claimed chain position:

```json
{ "seq": 48, "code": "DOC-XXXXXXXX", "instanceThumbprint": "…",
  "sha256": "…", "instanceEntryHash": "…", "prevHead": "…", "at": "…" }
```

**Rewrite detection** (the payoff): if the same code is pushed again with the
same digest but a **different** chain entry hash, the receiver refuses with
`409 Chain rewrite detected` — the fingerprint was already witnessed at
another position. Idempotent re-pushes change nothing and do not grow the log.

## Public endpoints

| Endpoint | What it serves |
|---|---|
| `GET /api/transparency/checkpoint` | Signed checkpoint of the portal log: `{size, head, at, signature, publicKeyPem, keyFingerprint}` |
| `GET /api/transparency/proof/{code}` | Inclusion proof: the code's log entry, the chain segment to the current head, and the signed checkpoint |
| `GET /api/attestations` (GET) | Receiver discovery surface |

The checkpoint is signed by the portal's own RSA-2048 key (`PortalKey`,
generated once per deployment). The signature covers
`canonicalJson({format, keyId, size, head, at})`.

## Running a monitor (anyone can)

1. Poll `/api/transparency/checkpoint` on a schedule.
2. On first sight, pin `keyFingerprint` (TOFU — same posture as the instance
   keys themselves).
3. Keep every checkpoint. Invariants:
   - `size` never decreases;
   - every new head must chain from the previous one (request the proofs for
     the codes you care about and re-hash);
   - a smaller size, or a head that does not extend what you saw, is **proof
     of a rewrite** — publish it.

## Verifying an inclusion proof

For `/api/transparency/proof/{code}` (or a pack's transparency block):

1. Re-hash **every** segment entry — including the first — from its own
   `{seq, code/payload fields, prevHead, at}`; any mismatch = forged entry.
2. Check each `prevHead` equals the previous entry's head; any gap or
   mismatch = broken chain.
3. Verify the checkpoint signature with the embedded public key (WebCrypto in
   `verify.html`, node crypto in `e2e/transparency.test.ts`).
4. The checkpoint must cover exactly the segment's last head.

`verify.html` inside every evidence pack performs this entire flow offline in
the browser — see `docs/EVIDENCE-PACK.md` and `scripts/verify-offline-check.ts`
(the deep-check harness that drives real Chromium).

## Honest limits

- The instance chain is anchored by the **same key** that signs the pack. Its
  value is that the *portal* witnesses its heads per code (rewrite detection),
  and that previously-exported packs/checkpoints are irreversible anchors. It
  is tamper-**evidence**, not third-party identity assurance.
- The portal key is TOFU-pinned, not certificate-chained. A first-contact
  attacker before any monitor pins the key is indistinguishable from the real
  portal — the same cold-start limitation as SSH host keys.
- Chain segments are capped (4096 entries in packs, 1024 in proofs) — beyond
  that, proofs mark themselves `truncated` and verify up to the truncation
  point. Scaling past it wants a Merkle tree (sub-linear proofs) and
  third-party witnesses.

## Trust ladder — what money buys, and when it is worth it

This table is the agreed product position: **the free tier is the roadmap
trust model**, not a stopgap; the paid tiers are revenue-triggered upgrades.

| Rung | Cost | What it adds | Worth it when |
|---|---|---|---|
| Self-signed evidence key + TOFU + DNS SAN *(shipped, PR #3)* | €0 | Integrity, origin, domain-control proof, key pinning | Always — the baseline |
| **This transparency registry** *(this PR)* | €0 | Provable history integrity; rewrite detection; offline inclusion proofs | Always — shipped by default |
| Sigstore **Rekor** witnessing of instance keys | €0 (public instance, rate-limited) | Neutral third-party log; substituted/rogue keys become publicly provable | When self-hosted federation reaches Internet scale (~1–2 weeks of work) |
| Self-hosted CT-style log (Trillian + witnesses) | ~$5–20/mo | Same guarantee at scale, operator-owned | If Rekor rate limits ever bind |
| **AATL certificate** via member CA (DigiCert, Sectigo…) | ~$300–600/yr per cert | Green check in Adobe Reader for that one certificate | Point integrations; does not scale to SaaS |
| **AATL signing service** (e.g. DigiCert Document Trust Manager) | ~$10k+/yr enterprise | Cloud counter-signs every pack; Adobe-trusted | Customers complain about "validity unknown" in Acrobat |
| Own AATL membership | $50k–150k/yr + audit | Docurama becomes its own Adobe-trusted root | Enterprise trust demands + 6–12 months lead time |
| **eIDAS QTSP** (qualified seals) | €100k–300k year 1, €50–100k/yr after | EU legal equivalence to handwritten signatures | A specific EU enterprise deal requires it — a company-level commitment, not a feature |

Figures are ballpark list prices; the magnitudes are the point. The expensive
rungs buy **legal recognition and third-party identity assurance**, not better
cryptography — the RSA-2048 chain and hash chain are identical along the whole
ladder.

## Implementation map

| Piece | Where |
|---|---|
| Hashing, chains, checkpoints, verifiers | `src/lib/transparency.ts` |
| Claim embedded in signed attestation payloads | `src/lib/attestation.ts` |
| Seal-time append | `src/app/api/sign/[token]/route.ts` (after the seal transaction commits — inside it, the append would deadlock on SQLite's write lock) |
| Pack transparency block + offline chain check | `src/lib/evidence-pack.ts` (`verify.html` section 4) |
| Receiver validation + rewrite detection + witnessing | `src/app/api/attestations/route.ts` |
| Public endpoints | `src/app/api/transparency/checkpoint/`, `src/app/api/transparency/proof/[code]/` |
| Verify-UI registry lines | `public-verify.tsx`, `user-verify.tsx`, v1 + workspace verify responses |
| Tests (chain, proofs, rewrite 409, tamper) | `e2e/transparency.test.ts` (13 tests, wired into `e2e/run.sh`) |
