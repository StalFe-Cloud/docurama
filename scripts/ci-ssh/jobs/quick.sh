#!/usr/bin/env bash
# webhook-network.yml › tls-and-destination-policy, and the source-level steps
# of e2e.yml › production-image (lint, startup failure policy).
set -euo pipefail
cd /work
echo "::step tls-and-destination-policy"
node --test --test-concurrency=1 e2e/webhook-network.test.mjs
echo "::done tls-and-destination-policy"
echo "::step production-image lint"
bun run lint
echo "::step production-image entrypoint policy"
bash scripts/test-entrypoint.sh
echo "::done production-image-source-checks"
