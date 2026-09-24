#!/usr/bin/env bash
# e2e.yml › e2e: the whole battery (e2e/run.sh) on Linux, SQLite
set -euo pipefail
cd /work
export E2E_BASE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_DEMO_MODE=true DOCURAMA_ALLOW_PRIVATE_WEBHOOKS=1
echo "::step prepare"
cp .env.example .env
sed -i "s|file:./db/custom.db|file:$PWD/db/custom.db|" .env
mkdir -p db && touch db/custom.db
bunx prisma db push --accept-data-loss
# SeaweedFS for the S3 storage suite, as the workflow installs it.
WEED_VER="4.47"
curl -sL "https://github.com/seaweedfs/seaweedfs/releases/download/${WEED_VER}/linux_amd64.tar.gz" -o /tmp/weed.tar.gz
tar xzf /tmp/weed.tar.gz -C /tmp && chmod +x /tmp/weed && export WEED_BIN=/tmp/weed
"$WEED_BIN" version | head -1
echo "::step run"
bash e2e/run.sh
echo "::done e2e"
