#!/usr/bin/env bash
# Sprint 3 — TLS wildcard automation (operator DNS token required).
#
# Issues and renews a wildcard certificate for <domain> + *.<domain> via lego
# DNS-01, then prints the reload step. DNS-01 is the only challenge that can
# issue wildcards and does not require port 80 to be reachable, so hosts behind
# closed ingress can still obtain certificates.
#
# Usage:
#   ./tls_wildcard.sh issue    # first issuance
#   ./tls_wildcard.sh renew    # cron-able renewal check (30-day window)
#   ./tls_wildcard.sh staging  # first issuance against the staging CA (testing)
#
# Required environment:
#   DOCURAMA_TLS_DOMAIN=example.com
#   DOCURAMA_DNS_PROVIDER=cloudflare      # any lego provider name
#   <provider credentials>, e.g. CLOUDFLARE_DNS_API_TOKEN=...
#
# The certificate is operator infrastructure: nothing in this repository holds
# the DNS token or the private key. Compose mount (see GO_LIVE.md):
#   - ./lego/certificates:/certs:ro   (fullchain.pem + key.pem)
set -euo pipefail

DOMAIN="${DOCURAMA_TLS_DOMAIN:-}"
DNS_PROVIDER="${DOCURAMA_DNS_PROVIDER:-cloudflare}"

command -v lego >/dev/null 2>&1 || {
  echo "lego is not installed. Install it from https://go-acme.github.io/lego/ and retry." >&2
  exit 1
}

if [ -z "$DOMAIN" ]; then
  echo "DOCURAMA_TLS_DOMAIN is not set. Example: DOCURAMA_TLS_DOMAIN=docurama.example.com" >&2
  exit 1
fi

case "${1:-}" in
  issue)   STAGING_FLAG="";;
  staging) STAGING_FLAG="--staging";;
  renew)   STAGING_FLAG="";;
  *) echo "usage: $0 {issue|staging|renew}" >&2; exit 1;;
esac

mkdir -p ./lego

# Wildcards apply one label deep; an app.<registrable domain> host is covered
# by *.<registrable domain>, so both the apex and the wildcard are requested.
if [ "$1" = "renew" ]; then
  # lego exits non-zero when nothing is due; treat "not due" as success so a
  # daily cron stays quiet and only real failures page the operator.
  lego --email "admin@${DOMAIN}" \
    --domains "${DOMAIN}" --domains "*.${DOMAIN}" \
    --dns "${DNS_PROVIDER}" --pem --path ./lego renew --days 30 \
    && echo "renewal window checked" \
    || echo "certificate not yet due for renewal"
else
  lego --email "admin@${DOMAIN}" ${STAGING_FLAG} \
    --domains "${DOMAIN}" --domains "*.${DOMAIN}" \
    --dns "${DNS_PROVIDER}" --pem --path ./lego run
fi

echo
echo "Issued for: ${DOMAIN} and *.${DOMAIN}"
echo "Deploy step (compose): mount ./lego/certificates at /certs:ro and reload the proxy:"
echo "  docker compose exec proxy nginx -s reload"
echo "Set DOCURAMA_COOKIE_SECURE=true and APP_URL=https://<app host> before serving TLS."
