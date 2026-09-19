# SSO Operator Guide — Docurama

Implementation: `src/lib/sso.ts` + routes under `src/app/api/auth/sso/`. Admin surface: **Settings → SSO** (workspace OWNER/ADMIN or platform admin; ops `create | update | delete | toggle | test` via `src/app/api/workspace/sso/route.ts`).

## 1. Architecture

Connections live in the `SsoConnection` model:

| Field | Meaning |
|---|---|
| `tenantId` (nullable) | The workspace the connection belongs to. **`null` = platform-wide** — the self-host shape, applies to every user of the instance |
| `protocol` | `OIDC` or `SAML` |
| `emailDomain` | Domain binding — the connection only serves emails ending in `@domain` |
| `status` | `ACTIVE` / `DISABLED` — **one ACTIVE connection per domain** (enforced on create and toggle) |
| `label` | Shown on the "Continue with {label}" button |

Lookup (`findSsoConnection`) matches the typed email's domain against ACTIVE connections, tenant-specific first, platform-wide (`tenantId` null) last.

## 2. OIDC setup (per provider)

Redirect URI to register at the IdP: **`{origin}/api/auth/sso/callback/oidc`** (e.g. `https://app.docurama.eu/api/auth/sso/callback/oidc`). Scope requested: `openid email profile`.

| Provider | Where |
|---|---|
| **Microsoft Entra ID** | App registration → Redirect URI (web) as above → note the Application (client) ID + a client secret; issuer `https://login.microsoftonline.com/{tenant}/v2.0` |
| **Google Workspace** | Cloud console → OAuth client (web application) → authorized redirect URI as above; issuer `https://accounts.google.com` |
| **Okta** | Application → OIDC sign-in → sign-in redirect URI as above; issuer `https://{okta-domain}/oauth2/default` (or your auth-server issuer) |
| **Keycloak** | Client (confidential, standard flow) → valid redirect URI as above; issuer `https://{kc}/realms/{realm}` |

In Docurama: **Settings → SSO → Add connection** — protocol OIDC, label (e.g. "Microsoft Entra ID"), email domain, issuer URL, client ID, client secret. Use the **test-discovery button** (op `test`) first: it performs live OIDC discovery and reports the authorize/token/JWKS endpoints before you save anything.

Flow: discovery-driven (cached 10 min) → authorize URL with **PKCE S256** challenge + **nonce** + `login_hint` → token exchange → `id_token` verified with `jose` against the IdP JWKS (issuer, audience, clock tolerance 60 s) → nonce re-checked → email claim extracted.

## 3. SAML

- **SP metadata** (this instance): `GET /api/auth/sso/metadata/saml` — hand the XML (or its URL) to the IdP. EntityID = that URL; **ACS endpoint**: `{origin}/api/auth/sso/callback/saml`; NameID format emailAddress; `WantAssertionsSigned`.
- In Docurama: Settings → SSO → Add connection — protocol SAML, label, email domain, and **paste the IdP's metadata XML** (validated on save; the client secret / issuer fields are OIDC-only).
- The login URL is built via samlify (`createLoginRequest`, redirect binding) with **RelayState = the transaction state cookie**. Responses are signature-verified (`parseLoginResponse`); email is taken from the email attribute, `mail`, or an email-format NameID. XSD validation is disabled (optional peer dep) — signature verification is always enforced.

## 4. Flow details & JIT

- **Transaction cookie** (`docurama_sso_txn`, 10-minute Max-Age, HttpOnly, SameSite=Lax): carries `state`, `connectionId`, PKCE `codeVerifier`, `nonce`, and the post-login target. It is **HMAC-SHA256 signed with `SSO_TXN_SECRET`** — set a strong value in production (the fallback is a derived per-instance value, not a secret; see SECURITY.md §3). Tampered cookies are rejected.
- **Domain-mismatch check**: the IdP-asserted email must end in `@` the connection's bound domain — an assertion for the wrong domain never logs in.
- **JIT provisioning**: unknown emails from the bound domain are auto-provisioned — user created `ACTIVE`, `emailVerifiedAt` set (the IdP asserted mailbox control), role `MEMBER`, **unusable password hash** (`sso!` + random hex), enrolled as `MEMBER` of the connection's tenant (tenant-bound connections). Login is audited as `user.login.sso_oidc` / `user.login.sso_saml`. Suspended accounts are refused.
- **Fallback:** password login stays untouched — users without a matching domain, or when the connection is disabled/deleted, simply sign in with a password (SSO-created accounts set one via reset-password).

## 5. Login UX

Sign-in page: user types their email → `/api/auth/sso/lookup` resolves the domain → the button **"Continue with {label}"** appears next to password sign-in. Clicking it starts the OIDC/SAML flow for that connection. Deleting a connection prints an honest fallback message: those users return to password sign-in.

## 6. Testing

`e2e/sso.test.ts` (hermetic, scratch DB copy, owns `SSO_TXN_SECRET`):

- transaction-cookie sign/verify (tamper → rejected);
- OIDC end-to-end against an **in-process stub provider** (discovery + authorize + token + JWKS, jose-signed `id_token`), including nonce-mismatch rejection and domain-bound JIT login (user + member + session + audit);
- SAML round-trip: SP metadata XML, an IdP keypair **generated with openssl**, samlify-signed AuthnResponse, attribute extraction, JIT login;
- routes: lookup answers for matching/unknown domains; SP metadata endpoint serves valid XML.

```bash
bun test e2e/sso.test.ts          # standalone
E2E_SKIP_SSO=1 bash e2e/run.sh    # skip within the full battery
```

Operator smoke test on a live instance: add the connection → test-discovery → open a private window → type a domain-matching email → "Continue with {label}" → land signed in → verify the audit entry (Audit Log → `user.login.sso_*`).
