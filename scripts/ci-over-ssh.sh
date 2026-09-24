#!/usr/bin/env bash
# The project's CI (GitHub Actions is not used): the commit is shipped to a
# Docker host over SSH with `git archive`, the jobs run there one at a time
# within CPU and memory limits (scripts/ci-ssh/run-on-host.sh), and nothing is
# left behind.
#
#   bash scripts/ci-over-ssh.sh <ssh-host> [git-ref]      e.g. nexa-vps HEAD
#
# Needs key-based SSH access to a host with Docker and buildx. Limits:
# CI_CPUS (default 2-3), CI_MEM (2800m), CI_PG_MEM (384m).
set -euo pipefail
HOST="${1:?usage: bash scripts/ci-over-ssh.sh <ssh-host> [git-ref]}"
REF="${2:-HEAD}"
SHA="$(git rev-parse --short=7 "$REF")"
REMOTE="docurama-ci/$SHA"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

echo "== shipping $SHA to $HOST"
"${SSH[@]}" "rm -rf ~/$REMOTE && mkdir -p ~/$REMOTE/ctx ~/$REMOTE/app"
git archive --format=tar "$REF" | "${SSH[@]}" "cat > ~/$REMOTE/ctx/src.tar && tar -xf ~/$REMOTE/ctx/src.tar -C ~/$REMOTE/app"

status=0
"${SSH[@]}" "CI_CPUS='${CI_CPUS:-2-3}' CI_MEM='${CI_MEM:-2800m}' CI_PG_MEM='${CI_PG_MEM:-384m}' bash ~/$REMOTE/app/scripts/ci-ssh/run-on-host.sh $SHA" || status=$?
"${SSH[@]}" "rm -rf ~/$REMOTE" || true
exit $status
