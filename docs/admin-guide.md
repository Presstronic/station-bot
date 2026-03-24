# Admin Guide

Full reference for all admin-level bot features.

---

## Command permissions overview

| Command | Who can use it |
|---|---|
| `/nominate-player` | Org member role or higher |
| `/nomination-review` | Org member role or higher (or roles granted via `/nomination-access`) |
| `/nomination-refresh` | Org member role or higher (or roles granted via `/nomination-access`) |
| `/nomination-job-status` | Org member role or higher (or roles granted via `/nomination-access`) |
| `/nomination-process` | Org member role or higher (or roles granted via `/nomination-access`) |
| `/nomination-access` | **Admins only** |
| `/nomination-audit` | **Admins only** |
| `/healthcheck` | **Admins only** |

---

## Managing review/process access

By default only admins and org members can review and process nominations. You can grant additional roles access without giving them full admin privileges.

```
/nomination-access action: add role: @HR-Team
```

```
/nomination-access action: remove role: @HR-Team
```

```
/nomination-access action: list
```

Reset all custom access back to admin-only:
```
/nomination-access action: reset
```

The bot will show you the roles that will lose access and ask you to confirm. Click **Confirm Reset** to proceed, or **Cancel** to abort. The prompt expires after 60 seconds. If no custom roles are configured, the bot replies immediately with no buttons.

> All access changes are recorded in the audit log.

---

## Audit log

View a log of all privileged nomination actions (processing, access changes, etc.):

```
/nomination-audit
```

Shows the 25 most recent events by default. Only you can see the result.

**Optional filters:**

| Option | What it does |
|---|---|
| `event-type` | Filter by a specific action type |
| `since` | Show events after a point in time — accepts ISO timestamps or shorthands like `1h`, `24h`, `7d` |
| `limit` | How many events to return — 1 to 100, defaults to 25 |

**Examples:**

Show all events in the last 24 hours:
```
/nomination-audit since: 24h
```

Show only bulk processing events:
```
/nomination-audit event-type: nomination_processed_bulk
```

**Audit event types:**

| Event type | What it records |
|---|---|
| `nomination_processed_single` | A single nomination was marked as processed |
| `nomination_processed_bulk` | All nominations were bulk-processed |
| `nomination_access_role_added` | A role was granted review/process access |
| `nomination_access_role_removed` | A role had review/process access removed |
| `nomination_access_roles_reset` | All custom access roles were cleared |

---

## Bot health check

```
/healthcheck
```

Returns a quick status snapshot: bot tag, current UTC time, read-only mode status, and list of active registered commands.

---

## Nomination review and processing

Admins have full access to all review and processing commands. See the [HR guide](hr-nomination-processing.md) for full details on those workflows.

To see the full technical breakdown (HTTP timeouts, rate limits, parse failures, etc.) alongside the standard summary, pass `detail: true`:

```
/nomination-review detail: true
```

---

## Read-only mode

When the bot is in read-only mode (set via the `BOT_READ_ONLY_MODE` environment variable), all slash commands are disabled and users see a maintenance message. This is controlled at the server level — contact your server operator to toggle it.

---

## Background worker

The nomination org-check worker runs automatically in the background when `NOMINATION_WORKER_ENABLED=true`. It processes the org-check job queue, retrying failed checks up to the configured maximum attempts.

You don't need to manage the worker directly — use `/nomination-refresh` to queue jobs and `/nomination-job-status` to monitor them. If a job appears stuck, contact your server operator to check the worker logs.
