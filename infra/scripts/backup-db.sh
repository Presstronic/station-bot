#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATION_BOT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${STATION_BOT_ROOT}/.env.production"
COMPOSE_FILE="${STATION_BOT_ROOT}/docker-compose.prod.yml"
RCLONE_CONFIG_FILE="${HOME}/.config/rclone/rclone.conf"
LOG_PREFIX="[backup]"

# Use rootless socket when available; fall back to whatever Docker uses by default.
ROOTLESS_SOCK="/run/user/$(id -u)/docker.sock"
if [ -S "${ROOTLESS_SOCK}" ]; then
  export DOCKER_HOST="unix://${ROOTLESS_SOCK}"
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "${LOG_PREFIX} Missing ${ENV_FILE}" >&2
  exit 1
fi

if [ ! -f "${RCLONE_CONFIG_FILE}" ]; then
  echo "${LOG_PREFIX} Missing ${RCLONE_CONFIG_FILE}" >&2
  exit 1
fi

POSTGRES_USER="$(grep '^POSTGRES_USER=' "${ENV_FILE}" | cut -d= -f2- || true)"
POSTGRES_DB="$(grep '^POSTGRES_DB=' "${ENV_FILE}" | cut -d= -f2- || true)"
B2_BUCKET="$(grep '^B2_BUCKET=' "${ENV_FILE}" | cut -d= -f2- || true)"
BACKUP_HEALTHCHECK_URL="$(grep '^BACKUP_HEALTHCHECK_URL=' "${ENV_FILE}" | cut -d= -f2- || true)"

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${B2_BUCKET:?B2_BUCKET is required}"

LABEL="${BACKUP_LABEL:-${1:-nightly}}"
LABEL="$(printf '%s' "${LABEL}" | tr -cd 'A-Za-z0-9._-')"
: "${LABEL:?LABEL is empty after sanitization — only [A-Za-z0-9._-] characters are allowed}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="/tmp/station_bot_backup_${TIMESTAMP}_${LABEL}.sql.gz"
REMOTE_PATH="postgres/${TIMESTAMP:0:6}/${TIMESTAMP}_${LABEL}.sql.gz"

trap 'rm -f "${BACKUP_FILE}"' EXIT

echo "${LOG_PREFIX} Starting backup at ${TIMESTAMP} (${LABEL})"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  | gzip > "${BACKUP_FILE}"

echo "${LOG_PREFIX} Created ${BACKUP_FILE} ($(du -sh "${BACKUP_FILE}" | cut -f1))"

rclone copyto "${BACKUP_FILE}" "b2:${B2_BUCKET}/${REMOTE_PATH}" \
  --b2-chunk-size 96M

echo "${LOG_PREFIX} Uploaded to b2:${B2_BUCKET}/${REMOTE_PATH}"

if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  if curl -fsS --retry 3 "${BACKUP_HEALTHCHECK_URL}" >/dev/null; then
    echo "${LOG_PREFIX} Healthcheck ping sent"
  else
    echo "${LOG_PREFIX} WARNING: healthcheck ping failed after upload" >&2
  fi
fi

echo "${LOG_PREFIX} Complete"
