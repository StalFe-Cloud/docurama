# Domain architecture (Sprint 8)

## Recommended split: two real hosts, one app

| Host | Serves | Notes |
|------|--------|-------|
| `docurama.eu` | Marketing + content: landing, `/pricing`, `/docs`, `/blog`, `/help`, `/templates-gallery`, `/trust`, `/verify` | The public site. Same SPA, same origin — one deploy. |
| `app.docurama.eu` | The product: `/templates`, `/submissions`, `/builder`, `/settings`, `/admin`, `/sign_up`, `/sign_in` | Session cookie scoped here; workspace traffic isolated from marketing. |
| `signup.docurama.eu` | **Vanity 301** → `https://app.docurama.eu/sign_up` | Deliberately NOT a third origin: signup shares the app origin so session cookies, CSRF, and future SSO flows stay single-origin. The vanity record keeps the address marketable. |

Why not a real third host for signup: a third origin means a third cookie
scope and third-party-cookie headaches at exactly the step (signup) where
drop-off is most expensive. A redirect keeps the marketing URL while the
actual account creation happens on the app origin.

The application is a single SPA and API: both real hosts serve the same
build. Host-level split is a routing/branding/cookie concern, not a
code-split — which is why it costs zero extra deploys.

## Cookie scoping

The session cookie is set by the app origin (`app.docurama.eu`) and is NOT
a wildcard cookie (`Domain` attribute unset → host-only). Marketing pages
never touch sessions; the app never runs on the marketing host. If a future
feature needs shared-host SSO, prefer an OIDC redirect flow over widening
cookies.

## Caddy example (deploy/tls_wildcard.sh issues the wildcard cert)

```caddyfile
# --- marketing host ---
docurama.eu {
    encode zstd gzip
    # Marketing content comes from the same SPA; nothing to rewrite.
    reverse_proxy 127.0.0.1:3000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# --- app host ---
app.docurama.eu {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# --- signup vanity: keep the address, keep one origin ---
signup.docurama.eu {
    redir https://app.docurama.eu/sign_up{uri} permanent
}
```

`deploy/tls_wildcard.sh` already provisions `*.docurama.eu` — run it once
after DNS delegation and all three hosts are covered by one certificate.

## DNS records

```
docurama.eu            A/AAAA  -> edge
www.docurama.eu        CNAME   -> docurama.eu  (optional, redirect to apex)
app.docurama.eu        A/AAAA  -> edge
signup.docurama.eu     A/AAAA  -> edge
_docurama-challenge    TXT     -> per-provider verification (see tls_wildcard.sh)
```

## App-side host awareness

`settings.APP_URL` must point at the host the user is actually on for
emails and redirects (activation links, checkout success). Recommended:
`APP_URL=https://app.docurama.eu` for the product deployment. If marketing
emails need docurama.eu links, use absolute marketing URLs in email copy
rather than changing APP_URL — activation and auth links must always land
on the app host.

## Sprint 9: full public subdomain map

The public architecture stays two real origins. Every requested public host
maps onto one of them (or onto an edge-level concern), so no extra
application origin, cookie scope, or deploy exists:

| Host | Serves | Implementation |
|------|--------|----------------|
| `docurama.eu` | Marketing + content + public surfaces | Real origin. Landing, `/pricing`, `/docs`, `/blog`, `/help`, `/templates-gallery`, `/trust`, `/verify`, `/legal`. |
| `app.docurama.eu` | The product (single canonical session origin) | Real origin. `/sign_up`, `/sign_in`, `/templates`, `/submissions`, `/builder`, `/settings`, `/admin`, `/sign`, `/verify` (authenticated use). |
| `signup.docurama.eu` | Vanity address for signup | Edge 301 → `https://app.docurama.eu/sign_up` (Caddy `redir` above). Never a third origin. |
| `sign.docurama.eu` | Recipient signing convenience address | Edge 301 → `https://app.docurama.eu/sign`. Signing sessions are cookie-scoped to the app origin; a separate origin would break that. |
| `verify.docurama.eu` | Third-party verification convenience address | Edge 301 → `https://docurama.eu/verify`. Verification is public and touches no tenant data, so it belongs to the marketing origin. |
| `api.docurama.eu` | API convenience address | Edge 301 → `https://app.docurama.eu/api/…` (path-preserving), or a Caddy `handle` that proxies to the same upstream. The API is same-origin with the app; CORS stays single-origin. |
| `docs.docurama.eu` | Documentation convenience address | Edge 301 → `https://docurama.eu/docs`. |
| `help.docurama.eu` | Help center convenience address | Edge 301 → `https://docurama.eu/help`. |
| `status.docurama.eu` | Uptime/status page | Operator-managed edge service (e.g. a hosted status page or a static page on the edge). It must stay OUTSIDE the application origins so an incident page stays up when the app is down. |
| `sandbox.docurama.eu` | Test/evaluation environment | A separate DEPLOYMENT (own database, own storage, test Stripe keys, test TSA), reached via its own host. If operated, point it at a second backend instance - never at the production one. Optional at launch. |

Why 301s rather than real origins: each additional real origin multiplies
cookie scopes, HSTS coverage, CORS entries, certificate surface and
deployment cost, for zero product benefit when the underlying app is one
SPA + one API. Convenience hosts keep the addresses marketable while the
canonical URL - and therefore the session, the CSP and the audit trail -
stays single-origin.

### Edge config additions (Caddy)

```caddyfile
sign.docurama.eu {
    redir https://app.docurama.eu/sign{uri} permanent
}
verify.docurama.eu {
    redir https://docurama.eu/verify{uri} permanent
}
api.docurama.eu {
    redir https://app.docurama.eu/api{uri} permanent
}
docs.docurama.eu {
    redir https://docurama.eu/docs{uri} permanent
}
help.docurama.eu {
    redir https://docurama.eu/help{uri} permanent
}
```

All convenience hosts are covered by the same `*.docurama.eu` wildcard
certificate that `deploy/tls_wildcard.sh` provisions.

### Email link policy (restated)

Activation, password reset, invitation, signing and completion links are
built from `settings.APP_URL` only - which must be the app origin in the
product deployment. Marketing-site links in email copy use absolute
`https://docurama.eu/...` URLs. There is no code path that emits a
relative, localhost or staging URL in mail, and the production config
guard refuses a placeholder APP_URL at boot.
