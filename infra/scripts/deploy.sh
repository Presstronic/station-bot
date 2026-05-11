#!/bin/bash
set -euo pipefail

STATION_BOT_ROOT="/opt/station-bot"
ENV_FILE="${STATION_BOT_ROOT}/.env.production"
COMPOSE_FILE="${STATION_BOT_ROOT}/docker-compose.prod.yml"
LOG_PREFIX="[deploy]"

# Use rootless socket when available; fall back to whatever Docker uses by default.
ROOTLESS_SOCK="/run/user/$(id -u)/docker.sock"
if [ -S "${ROOTLESS_SOCK}" ]; then
  export DOCKER_HOST="unix://${ROOTLESS_SOCK}"
fi

cd "${STATION_BOT_ROOT}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "${LOG_PREFIX} Missing ${ENV_FILE}" >&2
  exit 1
fi

# BOT_IMAGE_TAG must be set by the caller (CI passes the release tag, e.g. v0.3.3).
# Compose uses it via ${BOT_IMAGE_TAG:-latest} so the exact versioned image is pulled
# and run, not whatever :latest resolves to at deploy time.
: "${BOT_IMAGE_TAG:?BOT_IMAGE_TAG is required (e.g. v0.3.3)}"
export BOT_IMAGE_TAG

echo "${LOG_PREFIX} Pulling image ghcr.io/presstronic/station-bot:${BOT_IMAGE_TAG}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull discord-bot

echo "${LOG_PREFIX} Stopping bot before migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop discord-bot

echo "${LOG_PREFIX} Running migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm discord-bot \
  npm run migrate:up

echo "${LOG_PREFIX} Starting bot with new image"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-deps discord-bot

echo "${LOG_PREFIX} Service status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "${LOG_PREFIX} Recent logs"
docker logs station-bot --tail 20
