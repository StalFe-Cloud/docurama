#!/usr/bin/env bash
# Local reproduction of the CI security-gates job.
#
# CI enforces these on every push (fail on critical); this script lets the
# same checks be run by hand before pushing, so "green locally" means
# "green in CI". Bandit is run at -lll (high severity) because "critical" in
# the CVSS sense maps to bandit's HIGH confidence+severity band; pip-audit and
# npm audit carry true critical severities and block directly.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FAILED=0

# Prefer a project-adjacent venv's tooling when present, so the local run uses
# the same dependency set CI installs. CI itself has fresh tools on PATH.
for cand in "$ROOT/.venv/bin" "$(dirname "$ROOT")/.venv/bin" "$ROOT/backend/.venv/bin"; do
  if [ -x "$cand/pip-audit" ]; then
    export PATH="$cand:$PATH"
    break
  fi
done

banner() { echo; echo "=== $1 ==="; }

banner "pip-audit (backend requirements)"
if pip-audit -r backend/requirements.txt --desc off; then
  echo "OK: no known vulnerabilities above threshold"
else
  echo "FAIL: pip-audit reported vulnerable dependencies"
  FAILED=1
fi

banner "bandit (backend/app, high severity only)"
if bandit -r backend/app -lll -q; then
  echo "OK: no high-severity findings"
else
  echo "FAIL: bandit reported high-severity findings"
  FAILED=1
fi

banner "gitleaks (working tree)"
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --no-git --redact; then
    echo "OK: no secrets detected"
  else
    echo "FAIL: potential secrets detected"
    FAILED=1
  fi
else
  echo "SKIP: gitleaks not installed (brew install gitleaks / see ci.yml)"
fi

banner "npm audit (production deps, critical level)"
if (cd frontend && npm audit --omit=dev --audit-level=critical); then
  echo "OK: no critical npm advisories"
else
  echo "FAIL: critical npm advisories"
  FAILED=1
fi

banner "secret hygiene (tracked-file scan for live-style PATs)"
if rg -n "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}" \
    --glob '!node_modules' --glob '!dist' "$ROOT" > /tmp/secret_scan_hits.txt 2>/dev/null; then
  echo "FAIL: credential-shaped strings found:"
  head -10 /tmp/secret_scan_hits.txt
  FAILED=1
else
  echo "OK: no credential-shaped strings in tree"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL GATES GREEN"
else
  echo "ONE OR MORE GATES FAILED"
fi
exit "$FAILED"
