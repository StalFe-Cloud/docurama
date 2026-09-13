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
