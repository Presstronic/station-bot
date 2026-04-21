# Deployment Guide

## New server setup

### 1. Prerequisites

- Docker and Docker Compose installed
- A `deploy` user (or equivalent) with Docker access
- The repo cloned to `/opt/station-bot`

### 2. Create `.env.production`

```bash
sudo nano /opt/station-bot/.env.production
```

Minimum required variables:

```env
# Discord
DISCORD_BOT_TOKEN=
CLIENT_ID=

# Postgres container credentials (must match DATABASE_URL)
POSTGRES_DB=station_bot
POSTGRES_USER=station_bot
POSTGRES_PASSWORD=yourpassword

# Database — use the postgres service container name
DATABASE_URL=postgresql://station_bot:yourpassword@postgres:5432/station_bot

# Nominations worker
NOMINATION_WORKER_ENABLED=true

# Role IDs
ORGANIZATION_MEMBER_ROLE_ID=
ORGANIZATION_MEMBER_ROLE_NAME=

# Optional tuning (defaults shown)
# LOG_LEVEL=info
# LOG_FILE_ENABLED=true
# NOMINATION_TARGET_MAX_PER_DAY=0
# NOMINATION_USER_COOLDOWN_SECONDS=60
# NOMINATION_USER_MAX_PER_DAY=0
# NOMINATION_WORKER_CONCURRENCY=5
# NOMINATION_WORKER_BATCH_SIZE=20
# NOMINATION_WORKER_POLL_MS=8000
# NOMINATION_WORKER_STALE_LOCK_MS=300000
# NOMINATION_WORKER_MAX_ATTEMPTS=3
```

### 3. Fix `.env.production` permissions

```bash
sudo chmod 640 /opt/station-bot/.env.production
sudo chown deploy:deploy /opt/station-bot/.env.production
```

### 4. Create logs directory

```bash
mkdir -p /opt/station-bot/logs
```

### 5. Run migrations

```bash
docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml up -d postgres
docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml run --rm discord-bot npm run migrate:up
```

> Run this only after the `postgres` service is healthy. This is needed on first deploy and whenever a release includes new migrations.
> Production compose now expects `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` to be present in `.env.production`; missing values should be treated as a configuration error.

### 6. Deploy

```bash
docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml up -d discord-bot
```

### 7. Verify

```bash
# Both containers
docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml logs -f --tail=50

# Bot only
docker logs -f --tail=50 station-bot

# Postgres only
docker logs -f --tail=50 station-bot-postgres
```

---

## Upgrading an existing deployment

1. Pull the new image:
   ```bash
   docker pull ghcr.io/presstronic/station-bot:latest
   ```

2. Check the release notes for any new `.env.production` variables and add them. In particular, ensure `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `DATABASE_URL` are all present and consistent.

3. Start or refresh Postgres first:
   ```bash
   docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml up -d postgres
   ```

4. If the release includes migrations, run them before starting the bot:
   ```bash
   docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml run --rm discord-bot npm run migrate:up
   ```

5. Start the bot:
   ```bash
   docker compose --env-file /opt/station-bot/.env.production -f /opt/station-bot/docker-compose.prod.yml up -d discord-bot
   ```

6. Verify with the direct `docker logs` commands above. If you use `docker compose ... logs` instead, include `--env-file /opt/station-bot/.env.production`.
