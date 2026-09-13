# Access Control Policy

**Owner:** Platform operator · **Review frequency:** quarterly · **Frameworks mapped:** ISO 27001 (A.5.15–5.18, A.8.2–8.5), SOC 2 (CC6.1–6.3)

## Implemented controls

- **ACC-01 / ISO-01 — Authentication.** Argon2-grade password hashing, session
  cookies (`HttpOnly`, `Secure` per environment, `SameSite=Lax`), session
  rotation on credential events (`app/api/auth.py`).
- **ACC-02 / ISO-01 — Session revocation.** Per-user `token_version` bump on
  password change, TOTP disable and logout; every session minted before the
  bump stops resolving (`tests/test_token_revocation.py`).
- **ACC-03 / ISO-02 — MFA.** TOTP enrolment with confirm-on-first-use, MFA
  challenge tokens that carry no account detail, recovery codes burned on use
  (`app/api/auth.py` TOTP endpoints).
- **ACC-04 / ISO-03 — Least privilege.** API keys carry explicit scopes,
  hashed at rest, with expiry (`app/services/api_keys.py`,
  `tests/test_api_key_scoping.py`).
- **ACC-05 — Platform-admin gate.** Every administrative surface — tenant
  inventory, compliance endpoints, DSAR, incidents, legal queue — is gated by
  `is_platform_admin`, enforced server-side
  (`app/api/legal.py::_require_platform_admin`, pinned across
  `tests/test_sprint3_cloud_launch.py` and
  `tests/test_compliance_foundation.py`).
- **ACC-06 / SOC2-04 — Tenant isolation.** Workspace scoping enforced in
  queries; cross-tenant reads fail against real endpoints
  (`tests/test_tenant_isolation.py`, `tests/test_tenancy_rules.py`,
  `tests/test_preview_scoping.py`).
- **ACC-07 — Administrative audit.** Administrative and credential events
  (sign-in, sign-out, password change/reset, TOTP changes, API key
  create/revoke, DSAR, incidents, holds, control reviews, access reviews)
  write hash-chained ledger rows (`app/services/audit_chain.py`).
- **ACC-08 / ISO-08 — Access review.** Periodic reviews recorded with
  reviewer, scope, accounts reviewed, findings and required changes
  (`POST /api/admin/compliance/access-reviews`).
- **ACC-09 — No impersonation.** The admin console answers questions with
  data; entering a tenant's workspace without its own audit story is absent
  by design (`app/api/admin.py` module docstring).

## Honest limits

- **Role model granularity:** workspace roles are owner/admin/member today;
  fine-grained per-resource ACLs are not implemented and no control claims
  them.
- **SSO/SAML:** not implemented; the catalog records no control that would
  suggest otherwise.
- **Break-glass procedure:** documented here — platform-admin actions are
  all ledgered, so emergency access is observable after the fact; there is
  no separate sealed break-glass credential system (gap recorded on ISO-09).
