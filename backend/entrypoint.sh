#!/bin/sh
# Apply database migrations, then hand off to the application server.
# Migrations run once here rather than inside the FastAPI lifespan, which would
# otherwise race across the two uvicorn workers.
set -e

python migrate.py

exec "$@"
