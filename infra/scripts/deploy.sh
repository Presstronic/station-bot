#!/bin/bash
set -euo pipefail

STATION_BOT_ROOT="/opt/station-bot"
ENV_FILE="${STATION_BOT_ROOT}/.env.production"
COMPOSE_FILE="${STATION_BOT_ROOT}/docker-compose.prod.yml"
LOG_PREFIX="[deploy]"
DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
export DOCKER_HOST

if [ ! -f "${ENV_FILE}" ]; then
  echo "${LOG_PREFIX} Missing ${ENV_FILE}" >&2
  exit 1
fi

echo "${LOG_PREFIX} Pulling latest image"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull discord-bot

echo "${LOG_PREFIX} Running migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm discord-bot \
  npm run migrate:up

echo "${LOG_PREFIX} Restarting discord-bot"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-deps discord-bot

echo "${LOG_PREFIX} Service status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "${LOG_PREFIX} Recent logs"
docker logs station-bot --tail 20
