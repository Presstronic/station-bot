# 🚀 Station-Bot

> A Discord operations bot for **verification + nomination-driven recruiting workflow** in Star Citizen communities.

[![CI - Quality Gate](https://github.com/Presstronic/station-bot/actions/workflows/build-and-test.yaml/badge.svg)](https://github.com/Presstronic/station-bot/actions/workflows/build-and-test.yaml)
[![Build & Publish Docker Image](https://github.com/Presstronic/station-bot/actions/workflows/docker-build-publish.yml/badge.svg)](https://github.com/Presstronic/station-bot/actions/workflows/docker-build-publish.yml)
[![CodeQL](https://github.com/Presstronic/station-bot/actions/workflows/241327931/badge.svg)](https://github.com/Presstronic/station-bot/actions/workflows/241327931)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

---

## ✨ What This Bot Does

Station-Bot currently provides two major capabilities:

1. **✅ Member verification workflow**
- `/verify` generates a verification code and verifies RSI profile ownership via the verify button flow.

2. **🧭 Nomination and review workflow**
- Community members can nominate potential recruits.
- Admins (and delegated roles) can review/process nominations.
- RSI org checks are performed with retry, timeout, and rate-limit protections.

---

## 🧩 Current Slash Commands

| Command | Who Can Run It | Purpose |
|---|---|---|
| `/verify` | Server members | Starts RSI verification flow and provides verification button. |
| `/healthcheck` | Server administrators | Returns bot tag, UTC time, read-only state, and active commands. |
| `/nominate-player` | `Organization Member` role (or higher) and admins | Submits a candidate RSI handle with optional reason. |
| `/review-nominations` | Admins + delegated access roles | Reviews unprocessed nominations and checks org membership status. |
| `/process-nomination` | Admins + delegated access roles | Marks one nomination (by handle) or all unprocessed nominations as processed. |
| `/nomination-access` | Admins | Manages delegated roles for review/process commands (`add/remove/list/reset`). |

---

## 🛡️ Read-Only Safety Mode

The bot defaults to **read-only mode** for safer deployment rollouts.

- `BOT_READ_ONLY_MODE=true` (default)
- In read-only mode:
  - most commands/buttons return maintenance response with no mutations
  - startup side effects are skipped (role creation + cleanup scheduler)
  - slash commands remain registered
  - `/healthcheck` remains available for ops checks

### Re-enable checklist (production)

1. Set `BOT_READ_ONLY_MODE=false`
2. Redeploy/restart bot
3. Run `/healthcheck`
4. Verify `/verify` and nomination commands behave as expected
5. Confirm logs show startup tasks and no schema errors

---

## ⚙️ Configuration

### Required core env vars

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token. |
| `CLIENT_ID` | Yes (for command registration) | Discord application client ID. |
| `DATABASE_URL` | Yes for nomination features | PostgreSQL connection string. |

### General runtime

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_LOCALE` | `en` | Fallback locale for responses. |
| `BOT_READ_ONLY_MODE` | `true` | Runtime safety mode. |
| `LOG_LEVEL` | `info` | Logging verbosity. |

### PostgreSQL pool + TLS

| Variable | Default | Description |
|---|---|---|
| `PG_POOL_MAX` | `10` | Max DB pool connections. |
| `PG_IDLE_TIMEOUT_MS` | `30000` | Idle connection timeout. |
| `PG_CONNECT_TIMEOUT_MS` | `10000` | Connection timeout. |
| `PG_STATEMENT_TIMEOUT_MS` | `15000` | Statement timeout. |
| `PG_SSL_ENABLED` | `false` | Enable PostgreSQL TLS. |
| `PG_SSL_REJECT_UNAUTHORIZED` | `true` | TLS cert verification behavior. |
| `PG_SSL_CA_PATH` | _(unset)_ | Path to CA cert file for PG TLS. |

### Nomination role/access controls

| Variable | Default | Description |
|---|---|---|
| `ORGANIZATION_MEMBER_ROLE_NAME` | `Organization Member` | Minimum role name for `/nominate-player`. |
| `ORGANIZATION_MEMBER_ROLE_ID` | _(unset)_ | Optional explicit role ID override. |

### RSI request protection controls

| Variable | Default | Description |
|---|---|---|
| `RSI_HTTP_TIMEOUT_MS` | `12000` | Per-request timeout. |
| `RSI_HTTP_MAX_RETRIES` | `2` | Retry attempts for transient failures. |
| `RSI_HTTP_RETRY_BASE_MS` | `500` | Exponential backoff base delay. |
| `RSI_HTTP_MAX_CONCURRENCY` | `2` | Max concurrent outbound RSI calls. |
| `RSI_HTTP_MIN_INTERVAL_MS` | `400` | Minimum spacing between outbound requests. |
| `RSI_CITIZEN_URL_PATTERN` | `https://robertsspaceindustries.com/en/citizens/{handle}` | Citizen profile URL template. |
| `RSI_ORGANIZATIONS_URL_PATTERN` | `https://robertsspaceindustries.com/en/citizens/{handle}/organizations` | Organizations URL template. |

---

## 🧪 Local Development Quickstart

### 1) Prerequisites

- Node.js `>=20.11.0`
- npm
- Docker (recommended for local Postgres)

### 2) Install dependencies

```bash
npm ci
```

### 3) Create env file

Create `.env` with at least:

```bash
DISCORD_BOT_TOKEN=...
CLIENT_ID=...
DATABASE_URL=postgresql://station_bot:change_me@localhost:5432/station_bot
BOT_READ_ONLY_MODE=true
DEFAULT_LOCALE=en
```

### 4) Start local Postgres (optional but recommended)

```bash
docker compose up -d postgres
```

### 5) Run migrations

```bash
npm run migrate:up
```

### 6) Start bot

```bash
npm run dev
```

---

## 🐳 Docker Usage

### Local compose

```bash
docker compose up -d
```

This starts:
- `postgres` (persistent volume)
- `discord-bot` container

### Production compose

```bash
docker compose -f docker-compose.prod.yml up -d
```

Production compose uses:
- image: `ghcr.io/presstronic/station-bot:latest`
- `.env.production`
- bundled Postgres service by default

---

## 🗃️ Migrations

This project uses `node-pg-migrate`.

```bash
npm run migrate:create -- migration_name
npm run migrate:up
npm run migrate:down
```

If `DATABASE_URL` is configured and required schema objects are missing, startup will fail fast.

---

## ✅ Quality Commands

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
npm run quality
```

CI (`CI - Quality Gate`) runs lint + typecheck + tests on PRs to `main` and pushes to `main`.

---

## 📦 Release + Container Publish

Container publish workflow runs on pushed `v*` tags and validates `VERSION` file alignment.

High-level release flow:

1. Update `VERSION`
2. Commit + push to `main`
3. Tag: `v<VERSION>`
4. Push tag
5. Verify `Build & Publish Docker Image` workflow success

---

## 🩺 Troubleshooting

### “Missing nominations schema objects …” on startup

- Run: `npm run migrate:up`
- Confirm `DATABASE_URL` points to expected DB

### Slash command appears missing

- Wait for global command propagation
- Check startup logs for command registration warnings/errors
- Verify `CLIENT_ID` is set

### Nomination commands return configuration errors

- Ensure Postgres reachable
- Confirm migrations applied
- Validate `DATABASE_URL` and TLS env vars

### Bot replies with maintenance message

- `BOT_READ_ONLY_MODE` is likely `true`
- Set to `false` and redeploy when ready

---

## 🤝 Contributing

1. Create issue
2. Branch by convention (`feature/ISSUE-xx`, `bug/ISSUE-xx`)
3. Open PR with tests
4. Resolve review comments
5. Merge to `main` and release/tag as needed

---

## 📜 License

GPL-3.0 — see [LICENSE](LICENSE).
