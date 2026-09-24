# Images for scripts/ci-over-ssh.sh, the project's CI: its checks on any
# Docker host reached over SSH (GitHub Actions is not used).
#
#   runner  stands in for GitHub's ubuntu-latest: Bun (the version the app
#           image uses), Node 22, Chromium for the browser suites, and the
#           SQLite and PostgreSQL 16 clients (pg_dump must match the server).
#   source  the commit under test (ctx/src.tar from `git archive`) with its
#           dependencies installed from the lockfile.
ARG BUN_VERSION=1.4.2

FROM node:22-bookworm AS runner
ARG BUN_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg lsb-release \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends chromium sqlite3 postgresql-client-16 openssl git procps unzip \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g "bun@${BUN_VERSION}" && bun --version
ENV CHROME_BIN=/usr/bin/chromium
WORKDIR /work

FROM runner AS source
COPY src.tar /tmp/src.tar
RUN tar -xf /tmp/src.tar -C /work && rm /tmp/src.tar \
 && bun install --frozen-lockfile && bunx prisma generate
