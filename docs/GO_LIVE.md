# Docurama Go-Live Runbook

Production deployment of the self-hosted instance at `https://docurama.stalfe.com`.

Work top to bottom. Steps 1 to 4 must all be done before the first deploy, because the
application now refuses to start with a placeholder configuration rather than running
with one silently.

---

## 0. Before you start

**Revoke the GitHub token.** `.git/config` carries a personal access token in plaintext.
Revoke it at https://github.com/settings/tokens, then repoint the remote:

```bash
git remote set-url origin git@github.com:StalFe-Cloud/docurama.git     # SSH
# or, to keep https and let the credential helper supply it:
git remote set-url origin https://github.com/StalFe-Cloud/docurama.git
```

---

## 1. Signing certificate

Without one, envelopes still complete but record `seal_status='unsealed'`, and the
verification portal says so. That is honest, but it is not a signing product.

### Using the existing StalFe material

```bash
cp stalfe_document_signing_cert.p12 docurama/backend/certs/docurama_document_signing_cert.p12
cp stalfe_root_ca.crt              docurama/backend/certs/docurama_root_ca.crt
chmod 600 docurama/backend/certs/*.p12
```

Confirm it is a document-signing certificate, not a TLS one. `KeyUsage` must include
**Non Repudiation** and `ExtendedKeyUsage` must be **1.3.6.1.5.5.7.3.36**:

```bash
openssl pkcs12 -in backend/certs/docurama_document_signing_cert.p12 -nokeys -clcerts \
  | openssl x509 -noout -subject -issuer -ext keyUsage,extendedKeyUsage
```

> `stalfe_cert.pem` / `stalfe_key.pem` are **not** usable here. They are Cloudflare Origin
> TLS certificates with `ExtendedKeyUsage: TLS Web Server Authentication`. A validator is
> entitled to reject a TLS key used to sign a document.

### Issuing fresh material

```bash
python scripts/issue_signing_cert.py \
  --org "StalFe Technologies" --country FR \
  --ca-cn "StalFe Root Certification Authority" \
  --signer-cn "StalFe Document Signing Certificate" \
  --out backend/certs
```

Keep `root_ca.key` offline. It is the only thing that can issue a replacement signer, and
it can also issue certificates that impersonate yours.

### Trust model, and what you may claim

The StalFe root is self-signed. Signatures are cryptographically genuine, but Adobe Reader
shows **"signature validity unknown"** until the verifier installs that root, because it is
not in the Adobe Approved Trust List. Consequences:

- The Docurama verification portal is the trust anchor for counterparties. The QR code and
  verification code on the Certificate of Completion are the intended path.
- Publish `docurama_root_ca.crt` for download so a counterparty can trust it once.
- Do **not** market signatures as universally recognised, or as qualified under eIDAS. They
  are advanced electronic signatures with a private trust anchor.

For out-of-the-box Adobe validity, buy a document-signing certificate from an AATL or EUTL
member (GlobalSign, DigiCert, Entrust). It drops in with no code change: repoint
`DOCURAMA_P12_PATH`, `DOCURAMA_P12_PASSWORD`, `DOCURAMA_ROOT_CA_PATH`. Allow days to weeks
for identity vetting.

---

## 2. Production `.env`

On the VPS at `/opt/docurama/.env`, from `.env.example`. Never committed.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"   # DOCURAMA_SECRET_KEY
```

Required, and enforced at startup:

| Variable | Value |
|---|---|
| `DOCURAMA_ENV` | `production` |
| `DOCURAMA_APP_URL` | `https://docurama.stalfe.com` |
| `DOCURAMA_SECRET_KEY` | generated, 32+ chars, not the shipped default |
| `DOCURAMA_P12_PASSWORD` | the real passphrase, not the shipped default |
| `DOCURAMA_COOKIE_SECURE` | `true` |
| `POSTGRES_PASSWORD` + `DOCURAMA_DATABASE_URL` | must agree with each other |

`DOCURAMA_APP_URL` is not cosmetic. It derives the CNAME target customers are told to
delegate to, the contact embedded in every signature, and the portal URL printed on every
Certificate of Completion.

SMTP is **not** configured here. See step 6: it is set in the product after deploy, so a
company can send from its own domain without editing the deployment.

Until it is set, envelopes still complete but the audit trail records `send_failed` and
recipients get nothing.

> Mail passwords are encrypted with a key derived from `DOCURAMA_SECRET_KEY`. Rotating that
> key makes stored passwords undecryptable and they must be entered again. The profile is
> reported as unusable rather than attempted with a wrong credential.

---

## 3. Deploy

```bash
python deploy/deploy_to_vps.py
```

It preflights for `.env`, preserves a remote-only one, builds, and runs migrations from the
container entrypoint.

**Read the migration log; do not assume it.** The VPS database predates Alembic and its
drift is unknown. The local one was missing two baseline tables.

```bash
ssh "${DOCURAMA_VPS_USER:?set DOCURAMA_VPS_USER}"@"${DOCURAMA_VPS_HOST:?set DOCURAMA_VPS_HOST}" "docker logs docurama-api 2>&1 | grep '\[migrate\]'"
```

Expect either `fresh database` or:

```
[migrate] existing schema detected without version tracking
[migrate] schema predates Alembic and is missing baseline tables: ...
[migrate] created N missing baseline table(s)
[migrate] stamping 0001_baseline
[migrate] database is at head
```

Then confirm:

```bash
docker exec docurama-postgres psql -U docurama -d docurama -tAc "SELECT version_num FROM alembic_version;"
docker exec docurama-postgres psql -U docurama -d docurama -tAc "SELECT count(*) FROM users;"
```

**Back up the database before the first migrated deploy:**

```bash
docker exec docurama-postgres pg_dump -U docurama docurama | gzip > docurama-pre-alembic.sql.gz
```

---

## 4. Smoke tests

```bash
curl -s https://docurama.stalfe.com/api/health
```

`signing` must read `ready`. If it reads `unavailable: no signing certificate installed`,
step 1 did not take.

**Negative test first**  - an unsigned PDF must be refused. This is the defect the whole
release exists to fix:

```bash
curl -s -F "file=@any-unsigned.pdf" https://docurama.stalfe.com/api/verify/upload
```

Must return `is_valid: false`, `has_digital_signature: false`, `pades_ltv_verified: false`.
If it returns "authentic and certified", you are running the old build.

**Positive path:** create an envelope with two signers in routing order. Confirm the second
signer is refused until the first signs; that invitations arrive; that on completion
`seal_status='sealed'` with a real `pades_level`; and that `/verify` reports
`pades_ltv_verified: true` with a real timestamp.

**Prove the seal against the real library:**

```bash
docker run --rm -v "$PWD/scripts/verify_signing.py:/tmp/v.py:ro" \
  --entrypoint python docurama-docurama-api:latest /tmp/v.py
```

Expect `PASSED: sealed at PAdES-B-LTA, verified, and tampering detected.`

---

## 5. Configure the mail server

Sign in, then Settings, Notifications, Email Delivery. As the platform administrator set
the deployment default, which every company falls back to; individual companies can later
override it to send from their own domain. Use Send test email before relying on it: a
wrong password caught here is an operator fixing it in the moment, rather than a signer
never receiving an invitation.

The promoted platform administrator is the owner of the earliest account, set by migration
`0005`. Confirm with:

```bash
docker exec docurama-postgres psql -U docurama -d docurama -tAc   "SELECT email FROM users WHERE is_platform_admin = TRUE;"
```

---

## 6. Activate DNS domain verification

Shipped but never used: no challenge record has ever been published, so no domain has ever
actually been verified.

1. `POST /api/domains` with `stalfe.com`. Note the returned token.
2. Publish the TXT record:
   ```
   _docurama-challenge.stalfe.com.  TXT  "docurama-verification=<token>"
   ```
3. `POST /api/domains/{id}/verify`. Check the DoH inspector shows the Cloudflare and Google
   answers.
4. Confirm a signer at `@stalfe.com` now produces a `domain_auth_asserted` audit event.

Verify propagation first: `dig TXT _docurama-challenge.stalfe.com +short`

---

## Post-launch

Not blockers, but track them:

- **Documents completed before this release** carry `seal_status='pending'`. They were sealed
  by code that could not seal, so most are unsealed in fact. They are deliberately not
  backfilled. To establish the truth, run each stored PDF through `verify_document_integrity`.
- **AATL certificate**, if universal Adobe validity is needed.
- **Backups**: `docurama_storage` holds the only copy of every signed document.
- **Certificate expiry**: the signer expires before the root. Diarise renewal; an expired
  signer stops all sealing.

## Rollback

Two failure classes, two procedures:

**Code regression** — redeploy the previous tag. `deploy/upgrade.sh` records the
tag it replaced in `.previous-tag` before every deploy, so:

```bash
./deploy/rollback.sh              # redeploys the recorded previous tag
./deploy/rollback.sh <git-tag>    # or name it explicitly
```

`upgrade.sh` itself gates on `/readyz` and refuses to declare success when the
readiness probe fails, printing the exact rollback command.

**Data damage** — restore a backup. Do NOT hand-pipe a dump into psql: on a
populated database it fails immediately on the first CREATE of an existing
object, and without `ON_ERROR_STOP` it reports success on a partial load. The
supported procedure is:

```bash
/opt/docurama/deploy/restore.sh <stamp>     # e.g. 20260912T031500Z
```

`restore.sh` stops the API, drops and recreates the schema, replays the dump
with `ON_ERROR_STOP=1`, restores the storage volume (and certificates, if the
backup set carried them), restarts, and gates on `/readyz`.

### Restore drill (run once after setup, repeat quarterly)

1. `DOCURAMA_BACKUP_DIR=/tmp/drill /opt/docurama/deploy/backup.sh` — confirm it
   reports three artifacts (db, storage, certs) and their sizes.
2. On a scratch host or a stopped stack: `deploy/restore.sh <stamp>` against a
   COPY of the production backup directory.
3. Sign in, open an envelope, download a sealed PDF, verify it on the portal —
   a backup that restores but cannot re-verify a signature is not a backup.
4. Record the date and the stamp in the operations log.

Migrations `0002` to `0004` are additive and have `downgrade()`, so `alembic downgrade` is
available without a restore. The baseline reconciliation is not reversible: tables it
created stay, which is harmless.
