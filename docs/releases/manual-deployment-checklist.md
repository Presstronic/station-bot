# Manual Deployment Checklist

Use this runbook for manual production deployments and for rollback if a deployment fails.

This document assumes the production host already has:
- the Station Bot repo checked out at `/opt/station-bot`
- `.env.production` present
- Docker / Docker Compose working
- `rclone` configured for Backblaze B2

It is written to match the existing scripts:
- `infra/scripts/backup-db.sh`
- `infra/scripts/deploy.sh`

## Core Rule

Do not deploy a new production version without taking a fresh pre-deploy database backup first.

Reason:
- application rollback alone is not enough if the deployment also ran forward-only migrations
- the backup is what makes a true restore of the previous live state possible

## Required Inputs

Before starting, identify and write down:

- `TARGET_TAG`
  - the version you intend to deploy
  - example: `v0.3.3-beta`
- `LAST_GOOD_TAG`
  - the current known-good production version
  - example: `v0.3.2-beta.3`
- `BACKUP_LABEL`
  - a unique label for the backup you are about to create
  - recommended format:
    - `pre-manual-deploy-v0.3.3-beta`

Record these values somewhere visible during the deployment.

## Pre-Deploy Manual Checklist

1. Confirm the release is ready.
- release PR merged
- release tag exists
- required CI passed
- you are comfortable with the migration risk

2. SSH to the production host.

3. Move to the production checkout.

```bash
cd /opt/station-bot
```

4. Confirm the target tag exists remotely.

```bash
git fetch --tags origin
git tag --list | grep '^v0.3.3-beta$'
```

5. Record the currently deployed application version if possible.
- check running image tag or repo state
- confirm `LAST_GOOD_TAG`

6. Create the pre-deploy database backup.

```bash
cd /opt/station-bot
BACKUP_LABEL="pre-manual-deploy-v0.3.3-beta" bash infra/scripts/backup-db.sh
```

7. Record the resulting backup details.
- record the exact `BACKUP_LABEL`
- record the approximate timestamp when the backup finished
- record the remote B2 path printed by the script if shown

8. Verify the backup succeeded before deploying.
- backup script completed successfully
- upload to B2 completed successfully
- if available, verify the backup object exists in B2

Suggested verification command:

```bash
B2_BUCKET="$(grep '^B2_BUCKET=' /opt/station-bot/.env.production | cut -d= -f2-)"
rclone lsf "b2:${B2_BUCKET}/postgres/$(date +%Y%m)/" | grep 'pre-manual-deploy-v0.3.3-beta'
```

If the backup cannot be verified, stop. Do not deploy.

## Manual Deployment Steps

1. Update the repo to the target tag.

```bash
cd /opt/station-bot
git fetch --tags origin
git checkout v0.3.3-beta
```

2. Deploy the target version using the existing deploy script.

```bash
cd /opt/station-bot
BOT_IMAGE_TAG="v0.3.3-beta" bash infra/scripts/deploy.sh
```

What this currently does:
- pulls the tagged application image
- stops and removes the current bot container
- runs database migrations
- starts the new bot container
- prints service status and recent logs

3. Verify the container is running.

```bash
docker inspect --format='{{.State.Status}}' station-bot
```

Expected result:
- `running`

4. Check recent logs.

```bash
docker logs station-bot --tail 100
```

5. Perform smoke testing.
- verify the bot starts cleanly
- run `/healthcheck`
- verify at least one representative DB-backed command
- verify there are no obvious migration or startup errors

6. Observe the deployment briefly.
- monitor logs for 15 to 30 minutes when practical

If all of the above look good, the deployment is complete.

## Rollback Trigger

Start rollback if any of the following happen after deployment:
- migrations fail
- bot container will not start
- bot starts but is clearly broken in a release-blocking way
- smoke tests fail in a way you do not want to keep live
- startup logs show a serious schema/config/runtime fault

## Rollback Strategy

Rollback is two-part:

1. restore the database to the pre-deploy backup taken immediately before the failed deployment
2. restore the application to `LAST_GOOD_TAG`

Both are required if the failed deployment ran migrations that changed live data/schema in a way the previous app version does not safely tolerate.

## Rollback Procedure

### 1. Stop the bot

```bash
cd /opt/station-bot
docker compose --env-file .env.production -f docker-compose.prod.yml rm -sf discord-bot
```

### 2. Identify the backup object to restore

You need the exact pre-deploy backup created for this deployment.

Example lookup:

```bash
cd /opt/station-bot
B2_BUCKET="$(grep '^B2_BUCKET=' .env.production | cut -d= -f2-)"
rclone lsf "b2:${B2_BUCKET}/postgres/$(date +%Y%m)/" | grep 'pre-manual-deploy-v0.3.3-beta'
```

If the deployment crossed a month boundary, also check the previous month prefix.

### 3. Download the backup locally on the server

Example:

```bash
cd /opt/station-bot
B2_BUCKET="$(grep '^B2_BUCKET=' .env.production | cut -d= -f2-)"
RESTORE_FILE="/tmp/station_bot_restore_pre_manual_deploy_v0.3.3-beta.sql.gz"
rclone copyto "b2:${B2_BUCKET}/postgres/YYYYMM/YYYYMMDD_HHMMSS_pre-manual-deploy-v0.3.3-beta.sql.gz" "${RESTORE_FILE}"
```

Replace the remote path with the exact backup object you identified.

### 4. Restore the database from the backup

Important:
- this is destructive
- this should only be done when you intend to restore the full prior live state

The backup script creates a gzipped plain SQL dump, so restore should reset the target schema and replay the SQL.

Example restore flow:

```bash
cd /opt/station-bot
POSTGRES_USER="$(grep '^POSTGRES_USER=' .env.production | cut -d= -f2-)"
POSTGRES_DB="$(grep '^POSTGRES_DB=' .env.production | cut -d= -f2-)"
RESTORE_FILE="/tmp/station_bot_restore_pre_manual_deploy_v0.3.3-beta.sql.gz"

docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

gunzip -c "${RESTORE_FILE}" | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1
```

### 5. Restore the previous application version

```bash
cd /opt/station-bot
git fetch --tags origin
git checkout "${LAST_GOOD_TAG}"
BOT_IMAGE_TAG="${LAST_GOOD_TAG}" bash infra/scripts/deploy.sh
```

Example:

```bash
cd /opt/station-bot
git fetch --tags origin
git checkout v0.3.2-beta.3
BOT_IMAGE_TAG="v0.3.2-beta.3" bash infra/scripts/deploy.sh
```

### 6. Verify rollback success

Check:

```bash
docker inspect --format='{{.State.Status}}' station-bot
docker logs station-bot --tail 100
```

Then repeat smoke testing:
- `/healthcheck`
- one representative DB-backed command
- one representative admin or verification workflow

### 7. Clean up the downloaded restore file

```bash
rm -f /tmp/station_bot_restore_pre_manual_deploy_v0.3.3-beta.sql.gz
```

## Important Warnings

- Application rollback is not the same as database rollback.
- If migrations ran, you should assume DB restore is required unless you have explicitly verified backward compatibility.
- Never overwrite the only pre-deploy backup for a deployment window.
- Record the backup label and remote object path before moving forward.

## Minimum Manual Deployment Record

For each manual deployment, capture:
- target tag
- last known good tag
- backup label
- backup object path
- deploy start time
- deploy end time
- result:
  - success
  - rolled back
- any notes about migration behavior or operational anomalies
