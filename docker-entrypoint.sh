#!/bin/sh
# Docurama container entrypoint.
#
# Applies only schema changes Prisma can execute without accepting data
# loss, then starts the application. Any schema/connectivity failure stops
# startup. Destructive migrations require a separate reviewed procedure.
#
# Env knobs:
#   DOCURAMA_SKIP_DB_PUSH=1   skip the schema push (external migration step,
#                             e.g. a dedicated init container or Helm hook)
set -e

# The image is built against one provider (Dockerfile ARG DB_PROVIDER); push
# the matching schema, not the SQLite source schema.
SCHEMA="prisma/schema.${DOCURAMA_DB_PROVIDER:-sqlite}.prisma"
[ -f "$SCHEMA" ] || SCHEMA="prisma/schema.prisma"

if [ "${DOCURAMA_SKIP_DB_PUSH:-0}" != "1" ]; then
  echo "[entrypoint] applying additive schema changes (prisma db push, $SCHEMA)…"
  if bunx prisma db push --schema "$SCHEMA" --skip-generate 2>&1; then
    echo "[entrypoint] schema is up to date"
  else
    echo "[entrypoint] ERROR: schema update failed; refusing to start" >&2
    exit 1
  fi
fi

exec "$@"
