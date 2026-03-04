# Discord Verification Bot

A Discord bot for verifying users against their RSI (Roberts Space Industries) profiles.

## Features

- Generates a unique verification code for users.
- Instructs users to add the code to their RSI profile's short bio.
- Provides a "Verify" button for users to initiate the verification process.
- Notifies moderators for manual verification.
- Assigns a "Verified Citizen" role upon successful verification.

## Setup and Installation

### Prerequisites

- Node.js v16.9.0 or higher.
- Discord account with permissions to add bots to a server.

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/discord-verification-bot.git
   cd discord-verification-bot
   ```

## Runtime Safety Mode

The bot now defaults to read-only mode for operational safety.

- Default: `BOT_READ_ONLY_MODE=true`
- Effect: command and button interactions return a maintenance message and perform no mutations.
- Effect: startup side effects (command registration, default role creation, and scheduling of cleanup jobs) are skipped.

To re-enable normal behavior explicitly:

```bash
BOT_READ_ONLY_MODE=false
```

### Re-Enable Checklist (Production)

1. Set `BOT_READ_ONLY_MODE=false` in your deployment environment.
2. Redeploy or restart the bot process/container.
3. Verify slash commands are registered and responding.
4. Verify expected role automation is active (default role creation and verification role updates).
5. Confirm scheduled cleanup jobs are registered and running.
6. Monitor logs for interaction errors, role assignment failures, and scheduler startup messages.

## Nomination Runtime Configuration

Nomination commands now require PostgreSQL persistence.

Access policy:

- `/nominate-player`: requires Organization Member role (or higher) or admin
- `/review-nominations` and `/process-nomination`: admin by default, plus any roles explicitly granted via `/nomination-access`

PostgreSQL connection controls:

- `DATABASE_URL` (required)
- `PG_POOL_MAX` (default: `10`)
- `PG_IDLE_TIMEOUT_MS` (default: `30000`)
- `PG_CONNECT_TIMEOUT_MS` (default: `10000`)
- `PG_STATEMENT_TIMEOUT_MS` (default: `15000`)

PostgreSQL TLS controls:

- `PG_SSL_ENABLED` (default: `false`)
- `PG_SSL_REJECT_UNAUTHORIZED` (default: `true`)
- `PG_SSL_CA_PATH` (optional filesystem path to CA cert)

Request correlation:

- every interaction is assigned a correlation ID (`interaction.id`) and automatically attached to logs as `cid:<id>` for traceability.

RSI request protection controls:

- `RSI_HTTP_TIMEOUT_MS` (default: `12000`)
- `RSI_HTTP_MAX_RETRIES` (default: `2`)
- `RSI_HTTP_RETRY_BASE_MS` (default: `500`)
- `RSI_HTTP_MAX_CONCURRENCY` (default: `2`)
- `RSI_HTTP_MIN_INTERVAL_MS` (default: `400`)
- `RSI_CITIZEN_URL_PATTERN` (default: `https://robertsspaceindustries.com/en/citizens/{handle}`)
- `RSI_ORGANIZATIONS_URL_PATTERN` (default: `https://robertsspaceindustries.com/en/citizens/{handle}/organizations`)

## PostgreSQL Container (Compose)

`docker-compose.yml` and `docker-compose.prod.yml` now include a `postgres` service with persistent storage.
Configure these in your environment:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

## Database Migrations

The project uses `node-pg-migrate` for schema changes.

- create migration: `npm run migrate:create -- migration_name`
- apply migrations: `npm run migrate:up`
- rollback one migration: `npm run migrate:down`

Run migrations before starting the bot in environments where the DB may be empty.
