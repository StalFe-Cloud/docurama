#!/usr/bin/env bash
# The checks of .github/workflows, run on this Docker host one job at a time.
# scripts/ci-over-ssh.sh ships the commit here (ctx/src.tar, app/) and calls it.
#
# The host keeps serving its own workload: everything created here is named
# dci-*, pinned to CI_CPUS and capped at CI_MEM (builds included, through a
# dedicated buildx builder), publishes no ports, and is removed at the end.
set -uo pipefail
SHA="${1:?usage: run-on-host.sh <sha>}"
HERE="$(cd "$(dirname "$0")" && pwd)"        # <work>/app/scripts/ci-ssh
WORK="$(cd "$HERE/../../.." && pwd)"         # holds app/, ctx/ and the job logs
CPUS="${CI_CPUS:-2-3}"
MEM="${CI_MEM:-2800m}"
PG_MEM="${CI_PG_MEM:-384m}"
LIMIT=(--cpuset-cpus "$CPUS" --memory "$MEM" --memory-swap "$MEM")
SRC="dci-src:$SHA"
APP="dci-app:$SHA"
FAILED=0
SUMMARY=()

note() { SUMMARY+=("$(printf '%-28s %s' "$1" "$2")"); [ "$2" = pass ] || FAILED=1; echo "   -> $1: $2"; }
cleanup() {
  docker rm -f $(docker ps -aq --filter "name=^dci-") >/dev/null 2>&1 || true
  docker volume rm dci-runtime >/dev/null 2>&1 || true
  docker image rm "$SRC" "$APP" >/dev/null 2>&1 || true
  docker buildx stop dci-builder >/dev/null 2>&1 || true
}
trap cleanup EXIT

# One job in the source image: logs to <work>/<name>.log, tail shown on failure.
run_job() {
  local name="$1"; shift
  if docker run --rm --name "dci-$name" "${LIMIT[@]}" --shm-size=1g -v "$HERE/jobs:/jobs:ro" "$@" > "$WORK/$name.log" 2>&1; then
    note "$name" pass
  else
    note "$name" FAIL; tail -n 40 "$WORK/$name.log"
  fi
}
pg_start() {
  docker run -d --name "dci-$1" --cpuset-cpus "$CPUS" --memory "$PG_MEM" \
    -e POSTGRES_USER=docurama -e "POSTGRES_PASSWORD=$2" -e "POSTGRES_DB=$3" postgres:16-alpine >/dev/null || return 1
  for _ in $(seq 1 30); do docker exec "dci-$1" pg_isready -U docurama >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}

echo "== images (builder pinned to CPUs $CPUS, 3 GB)"
docker buildx inspect dci-builder >/dev/null 2>&1 || docker buildx create --name dci-builder --driver docker-container \
  --driver-opt "cpuset-cpus=$CPUS" --driver-opt "memory=3g" >/dev/null
docker buildx build --builder dci-builder --load --target source -t "$SRC" -f "$HERE/Dockerfile" "$WORK/ctx" > "$WORK/build-source.log" 2>&1 \
  || { tail -n 40 "$WORK/build-source.log"; echo "source image failed"; exit 1; }
docker buildx build --builder dci-builder --load -t "$APP" "$WORK/app" > "$WORK/build-app.log" 2>&1 \
  || { tail -n 40 "$WORK/build-app.log"; echo "production image failed"; exit 1; }

echo "== tls-and-destination-policy, lint, startup policy"
run_job quick "$SRC" bash /jobs/quick.sh

echo "== invariants-sqlite"
run_job invariants-sqlite "$SRC" bash /jobs/invariants.sh sqlite

echo "== invariants-postgresql"
# Shares the database container's network: the upgrade script insists on 127.0.0.1.
if pg_start pg-verify fixture-only docurama_verification; then
  run_job invariants-postgresql --network container:dci-pg-verify -e PG_HOST=127.0.0.1 "$SRC" bash /jobs/invariants.sh postgresql
else note invariants-postgresql FAIL; fi
docker rm -f dci-pg-verify >/dev/null 2>&1

echo "== postgres (HTTP, MCP and browser suites on PostgreSQL 16)"
if pg_start pg-e2e docurama docurama_test; then
  run_job postgres --network container:dci-pg-e2e -e PG_HOST=127.0.0.1 "$SRC" bash /jobs/postgres-e2e.sh
else note postgres FAIL; fi
docker rm -f dci-pg-e2e >/dev/null 2>&1

echo "== production-image"
{
  docker run --rm --entrypoint sh "$APP" -c 'test ! -e /app/.env && test ! -e /app/.env.production && test -f /app/content/blog/docurama-is-live.md' \
  && docker run -d --name dci-app-smoke "${LIMIT[@]}" -e DATABASE_URL=file:/app/db/smoke.db -e REKOR_WITNESS=off -e DOCURAMA_WORKER=off "$APP" >/dev/null \
  && docker run --rm --network container:dci-app-smoke "$SRC" bash -c '
       for _ in $(seq 1 40); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 3; done
       curl -fsS http://127.0.0.1:3000/api/health >/dev/null && curl -fsS http://127.0.0.1:3000/blog | grep -q "Docurama is live"' \
  && docker exec -e DOCURAMA_BOOTSTRAP_EMAIL=admin@container.test -e DOCURAMA_BOOTSTRAP_PASSWORD=DisposableContainerTest123 \
       dci-app-smoke bun /app/bootstrap-admin.js --empty-installation
} > "$WORK/production-image.log" 2>&1 && note production-image pass || { note production-image FAIL; docker logs dci-app-smoke 2>&1 | tail -n 40; }
docker rm -f dci-app-smoke >/dev/null 2>&1

echo "== production-worker"
# The test shares the runtime's network (CI: --network host) and its database
# volume, mounted where the test expects its disposable path.
docker volume create dci-runtime >/dev/null
docker run --rm -v dci-runtime:/v --entrypoint sh "$SRC" -c 'touch /v/runtime.db && chmod 777 /v && chmod 666 /v/runtime.db'
docker run -d --name dci-verification-runtime "${LIMIT[@]}" -v dci-runtime:/app/db \
  -e DATABASE_URL=file:/app/db/runtime.db -e PORT=3031 -e HOSTNAME=127.0.0.1 \
  -e NEXT_PUBLIC_DEMO_MODE=false -e DOCURAMA_WORKER=on -e REKOR_WITNESS=off \
  -e "SMTP_URL=smtp://127.0.0.1:3502?tls=off" -e DOCURAMA_WEBHOOK_INTERNAL_ORIGINS=http://127.0.0.1:3501 "$APP" >/dev/null
run_job production-worker --network container:dci-verification-runtime -v dci-runtime:/tmp/quality-verification-runtime \
  -e CI=true -e DOCURAMA_VERIFICATION_DATABASE=1 -e DOCURAMA_RUNTIME_CONTAINER=dci-verification-runtime \
  -e NEXT_PUBLIC_DEMO_MODE=false -e REKOR_WITNESS=off -e E2E_BASE_URL=http://127.0.0.1:3031 \
  -e DATABASE_URL=file:/tmp/quality-verification-runtime/runtime.db "$SRC" bash -c '
    for _ in $(seq 1 60); do curl -fsS "$E2E_BASE_URL/api/health" >/dev/null 2>&1 && break; sleep 2; done
    bun test --timeout 180000 e2e/production-worker.test.ts'
docker rm -f dci-verification-runtime >/dev/null 2>&1; docker volume rm dci-runtime >/dev/null 2>&1

echo "== e2e (the whole battery, SQLite, with SeaweedFS for S3)"
run_job e2e "$SRC" bash /jobs/e2e.sh

echo
echo "== summary for $SHA on $(hostname)"
printf '%s\n' "${SUMMARY[@]}"
exit $FAILED
