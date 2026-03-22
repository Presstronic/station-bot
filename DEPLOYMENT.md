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

# Database — use the postgres service container name
DATABASE_URL=postgresql://station_bot:yourpassword@postgres:5432/station_bot

# Postgres container credentials (must match DATABASE_URL above)
POSTGRES_DB=station_bot
POSTGRES_USER=station_bot
POSTGRES_PASSWORD=yourpassword

# Nominations worker
NOMINATION_WORKER_ENABLED=true

# Role IDs
ORGANIZATION_MEMBER_ROLE_ID=
ORGANIZATION_MEMBER_ROLE_NAME=

# Optional tuning (defaults shown)
# LOG_LEVEL=info
# LOG_FILE_ENABLED=true
# NOMINATION_TARGET_MAX_PER_DAY=0
# NOMINATION_USER_COOLDOWN_SECONDS=0
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
DATABASE_URL=postgresql://station_bot:yourpassword@localhost:5432/station_bot \
  npm run migrate:up
```

> Run this after the postgres container is healthy. Only needed on first deploy or when a release includes new migrations.

### 6. Deploy

```bash
docker compose -f /opt/station-bot/docker-compose.prod.yml up -d
```

### 7. Verify

```bash
# Both containers
docker compose -f /opt/station-bot/docker-compose.prod.yml logs -f --tail=50

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

2. Check the release notes for any new `.env.production` variables and add them.

3. If the release includes migrations, run them before restarting:
   ```bash
   DATABASE_URL=... npm run migrate:up
   ```

4. Restart:
   ```bash
   docker compose -f /opt/station-bot/docker-compose.prod.yml down
   docker compose -f /opt/station-bot/docker-compose.prod.yml up -d
   ```

5. Verify with the log commands above.
