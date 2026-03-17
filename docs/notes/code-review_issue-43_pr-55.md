# Code Review: feature/ISSUE-43 / PR #55

**Reviewer**: Senior Software Engineer (automated exhaustive review)
**Date**: 2026-03-09
**Branch**: `feature/ISSUE-43`
**PR**: #55 — "feat: async nomination org-check jobs with queue worker"
**Reviewed at commit**: `f70b34c`

---

## Overview

PR #55 introduces a persistent job queue for nomination org-check operations. Previously, `/refresh-nomination-org-status` ran RSI HTTP scraping synchronously inside the Discord interaction handler. This PR replaces that with an enqueue-then-poll architecture: new `nomination_check_jobs` + `nomination_check_job_items` tables, a `job-queue.repository.ts` with transactional claim/complete/fail/requeue operations, a `setInterval`-based `job-worker.service.ts`, and a new `/nomination-check-status` command.

Overall code health is **good to solid**. SQL injection risk is absent (all queries use `$N` parameterized placeholders). The `FOR UPDATE SKIP LOCKED` pattern is idiomatic. Test coverage is broad and uses ESM-compatible `jest.unstable_mockModule`. The biggest concerns are the worker defaulting to enabled in production, a non-atomic multi-query progress refresh, a fragile string-concatenation interval arithmetic issue, and a race in the duplicate-job check path.

---

## Summary of Findings

| Priority | Category | File | Short Description |
|---|---|---|---|
| HIGH | Config / Reliability | `job-worker.service.ts:106` | Worker defaults to enabled — no explicit opt-in required on deploy |
| HIGH | Correctness / SQL | `job-queue.repository.ts:252` | Stale-lock interval uses `$3::text \|\| ' milliseconds'` string concatenation |
| HIGH | Atomicity | `job-queue.repository.ts:330–401` | `refreshNominationCheckJobProgress` issues 3 separate `withClient()` calls — non-atomic |
| HIGH | Correctness / Race | `job-queue.repository.ts:100–109` | Duplicate-job check commits then reloads outside the transaction |
| MEDIUM | Type Safety | `job-queue.repository.ts:17,37` | `mapJobRow`/`mapItemRow` accept `row: any` with no runtime validation |
| MEDIUM | Type Safety | `nominations.repository.ts:24` | `mapDbRowToNomination` accepts `row: any` |
| MEDIUM | Performance | `job-queue.repository.ts:51–71` | `getJobWithItemCounts` runs an aggregate JOIN after every batch iteration |
| MEDIUM | Performance | `nominations.repository.ts:155–175` | `getUnprocessedNominations` unbounded result set; no index on `is_processed` |
| MEDIUM | Correctness | `nomination-check-status.command.ts:57` | Dead-code null guard on `requestedJobId` |
| MEDIUM | Security / UX | `nomination-check-status.command.ts:24–34` | Job ID accepted as string with manual parse — `addIntegerOption` is available |
| MEDIUM | Reliability | `job-worker.service.ts:70–95` | `while(true)` batch loop has no maximum-iteration safeguard |
| MEDIUM | Reliability | `index.ts:78` / `job-worker.service.ts:105–132` | Worker interval handle discarded; no graceful shutdown hook |
| LOW | Code Quality | `db.ts:14–28` / `job-worker.service.ts:24–37` | `envFlag` and `parseEnvInt` duplicated across multiple files |
| LOW | Architecture | `org-check.service.ts:35–38` | Module-level mutable rate-limiter state is process-global |
| LOW | Code Quality | `purge-member.job.ts:70,74,112,116` | Debug log prefixes are leftover artifacts |
| LOW | Config | `docker-compose.prod.yml:44` | Nested variable expansion in `DATABASE_URL` may not expand in Compose V2 |
| LOW | Logging | `index.ts:79` | "Worker started" log fires even when worker is disabled |
| LOW | Type Safety | `job-types.ts` / `types.ts` | ISO date strings typed as bare `string` |
| LOW | Correctness | `rsi.services.ts:27` | URL built from `.split('/').pop()` but full URL is still `encodeURIComponent`'d |
| NITPICK | Naming | `job-worker.service.ts:39–43` | Magic-number defaults lack explanatory comments |
| NITPICK | Style | `web-scraping.services.ts:25` | Uses `console.error` instead of `logger.error` |
| NITPICK | Testability | `db.ts:8` | Module-level `schemaEnsured` flag complicates test isolation |
| NITPICK | Config | `jest.config.mjs` | `resolver` not set despite `ts-jest-resolver` being installed |
| NITPICK | Config | `tsconfig.json:22–23` | Inline JSON comments (non-standard JSON) |

---

## Findings (Ordered Highest to Lowest Priority)

### [HIGH] Worker defaults to enabled — no explicit opt-in required

- **File**: `src/services/nominations/job-worker.service.ts:106`
- **Category**: Reliability / Configuration
- **Description**: `envFlag('NOMINATION_WORKER_ENABLED', true)` means the worker starts automatically on any deployment that does not explicitly set `NOMINATION_WORKER_ENABLED=false`. On a fresh deploy that has not configured this variable, the worker immediately begins polling the DB and making HTTP requests to RSI. The `.env.production` file does not document this variable. This is the Copilot flagged comment at `job-worker.service.ts:108`.
- **Recommendation**: Change to `envFlag('NOMINATION_WORKER_ENABLED', false)`. Update `.env.production` and README documentation. Add `NOMINATION_WORKER_ENABLED=true` to `.env.example` to make the opt-in explicit.

---

### [HIGH] Stale-lock interval uses string concatenation instead of interval arithmetic

- **File**: `src/services/nominations/job-queue.repository.ts:252`
- **Category**: Correctness / SQL
- **Description**: The CTE in `claimNominationCheckJobItems` computes the stale-lock window as:
  ```sql
  OR locked_at < (NOW() - (($3::text || ' milliseconds')::interval))
  ```
  The `safeStaleLockMs` guard at line 240 (`Math.max(1000, Math.floor(staleLockMs))`) mitigates most edge cases, but `Math.floor(NaN)` is `NaN`, and `NaN || ' milliseconds'` casts to `'NaN milliseconds'`, which PostgreSQL rejects with a runtime interval parse error. Using native interval arithmetic eliminates the fragility entirely:
  ```sql
  OR locked_at < (NOW() - ($3::numeric * interval '1 millisecond'))
  ```
- **Recommendation**: Replace string concatenation with `($3::numeric * interval '1 millisecond')`.

---

### [HIGH] `refreshNominationCheckJobProgress` is non-atomic across three `withClient()` calls

- **File**: `src/services/nominations/job-queue.repository.ts:330–401`
- **Category**: Atomicity / Reliability
- **Description**: Three separate pool connections are acquired and released in sequence:
  1. `SELECT` aggregate item counts (lines 334–347)
  2. `SELECT` failed items for error summary (lines 361–373)
  3. `UPDATE` the parent job row (lines 382–399)

  Between calls 1 and 3, item statuses can change (worker concurrency), producing counts that are inconsistent with the error summary. A process restart between calls 2 and 3 leaves the job row stale. The Copilot comment on line 400 specifically flags this.
- **Recommendation**: Consolidate all three queries into a single `withClient()` call inside a `BEGIN`/`COMMIT` block. Ideally, use a single CTE:
  ```sql
  WITH counts AS (...), errors AS (...)
  UPDATE nomination_check_jobs SET ... FROM counts, errors WHERE id = $1
  ```

---

### [HIGH] Duplicate-job detection commits transaction then reloads outside it

- **File**: `src/services/nominations/job-queue.repository.ts:100–109`
- **Category**: Correctness / Race Condition
- **Description**:
  ```typescript
  if (existingResult.rows.length > 0) {
    await client.query('COMMIT');                          // transaction released, lock gone
    const job = await getJobWithItemCounts(Number(...));  // new connection, no lock
    if (!job) throw new Error('Failed to load existing nomination check job');
    return { job, reused: true };
  }
  ```
  Between `COMMIT` and the reload on a new connection, another process could complete and delete the job, causing `getJobWithItemCounts` to return `null` and triggering the throw. This window is narrow but real under concurrent load.
- **Recommendation**: Keep the transaction open for the reload, using `SELECT ... FOR SHARE` to hold a read lock, or read the full job data in the same query that detected the duplicate.

---

### [MEDIUM] `mapJobRow` and `mapItemRow` accept `row: any` with no runtime validation

- **File**: `src/services/nominations/job-queue.repository.ts:17, 37`
- **Category**: Type Safety
- **Description**: Both mapper functions blindly trust the DB row shape. If the schema changes (column rename, added NOT NULL), these produce `NaN`, `undefined`, or incorrect values at runtime with no TypeScript protection. The same issue exists in `nominations.repository.ts:24` for `mapDbRowToNomination`.
- **Recommendation**: Define typed row interfaces (e.g., `interface RawNominationCheckJobRow { id: string; status: string; ... }`) and use them as parameter types. Add runtime assertions for critical fields like `id`.

---

### [MEDIUM] `getJobWithItemCounts` runs an aggregate JOIN after every batch

- **File**: `src/services/nominations/job-queue.repository.ts:51–71`, called at lines 94 and 97
- **Category**: Performance
- **Description**: For a job with 1000 handles and `batchSize=20`, `refreshNominationCheckJobProgress` calls `getJobWithItemCounts` 51 times during the cycle. Each call issues a `LEFT JOIN ... GROUP BY` across the entire `nomination_check_job_items` table for that job. The index on `(job_id, status)` helps but the aggregation is still O(items) per call.
- **Recommendation**: Remove the in-loop call at line 94. Call `refreshNominationCheckJobProgress` only once at the end of the cycle (line 97). If live progress is needed, emit it every N batches rather than every batch.

---

### [MEDIUM] `getUnprocessedNominations` has no result cap and no index on `is_processed`

- **File**: `src/services/nominations/nominations.repository.ts:155–175`
- **Category**: Performance
- **Description**: `SELECT * FROM nominations WHERE is_processed = FALSE` with no `LIMIT` can return arbitrarily many rows. The init migration (`1730500000000`) does not create an index on `is_processed`. Full sequential scans will occur as the table grows.
- **Recommendation**: Add a partial index:
  ```sql
  CREATE INDEX idx_nominations_is_processed ON nominations (is_processed) WHERE is_processed = FALSE;
  ```
  Consider adding a `LIMIT` or pagination to the query.

---

### [MEDIUM] Dead-code null guard in job-ID validation

- **File**: `src/commands/nomination-check-status.command.ts:57`
- **Category**: Correctness
- **Description**: Line 57:
  ```typescript
  if (rawJobId && (!Number.isInteger(requestedJobId) || requestedJobId === null || requestedJobId <= 0)) {
  ```
  `requestedJobId` is assigned `Number(rawJobId.trim())`, which is always a `number`, never `null`. The `requestedJobId === null` check is dead code. The broader fix is to switch to `addIntegerOption` (see below).
- **Recommendation**: Switch to `addIntegerOption`. If keeping the string option for any reason, remove the dead `=== null` guard.

---

### [MEDIUM] Job ID accepted as string with manual parse instead of `addIntegerOption`

- **File**: `src/commands/nomination-check-status.command.ts:24–34`
- **Category**: Security / UX (Copilot comment #1)
- **Description**: The `job-id` option is declared as `addStringOption`. Discord has `addIntegerOption` with `setMinValue(1)` that would enforce a positive integer at the Discord client level, before the interaction is submitted. The current implementation requires manual string→number conversion and validation in the handler.
- **Recommendation**: Replace `addStringOption` with `addIntegerOption(...).setMinValue(1).setRequired(false)` and use `interaction.options.getInteger(...)` in the handler.

---

### [MEDIUM] `while(true)` batch loop has no maximum-iteration safeguard

- **File**: `src/services/nominations/job-worker.service.ts:70–95`
- **Category**: Reliability
- **Description**: If a DB inconsistency causes items to appear perpetually claimable (e.g., a bug in `locked_at` reaping), the loop never exits within a single cycle. The `running` guard at line 116 blocks all subsequent poll cycles from starting while the hung cycle runs.
- **Recommendation**: Add a `maxBatches = Math.ceil(job.totalCount / batchSize) + 2` guard and break with a warning if exceeded.

---

### [MEDIUM] Worker interval handle discarded; no graceful shutdown

- **File**: `src/index.ts:78`, `src/services/nominations/job-worker.service.ts:105–132`
- **Category**: Reliability
- **Description**: `startNominationCheckWorkerLoop()` returns a `NodeJS.Timeout | null` but `index.ts:78` discards it. Without a reference to the interval, it cannot be cleared on SIGTERM/SIGINT, potentially firing during shutdown and leaving DB writes in partially committed states.
- **Recommendation**: Store the return value and clear it in `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` handlers.

---

### [LOW] `envFlag` and `parseEnvInt` duplicated across multiple files

- **File**: `src/services/nominations/db.ts:14–28`, `src/services/nominations/job-worker.service.ts:15–37`, `src/services/nominations/org-check.service.ts:17–24`
- **Category**: Code Quality / DRY
- **Description**: Both utility functions are copy-pasted across three files. If the parsing logic needs to change, it must be updated in multiple places.
- **Recommendation**: Extract to `src/utils/env.ts` and import from there.

---

### [LOW] Module-level mutable rate-limiter state is process-global

- **File**: `src/services/nominations/org-check.service.ts:35–38`
- **Category**: Architecture
- **Description**: `activeRequests`, `lastStartedAt`, `drainTimer`, and `waitQueue` are module-level singletons. For the current single-process architecture this is fine, but it is invisible to callers and incompatible with multi-worker or worker_threads scenarios.
- **Recommendation**: Wrap in a class or factory so state can be explicitly instantiated and reset. Not a blocker for this PR.

---

### [LOW] Debug log prefixes are leftover artifacts

- **File**: `src/jobs/discord/purge-member.job.ts:70, 74, 112, 116`
- **Category**: Code Quality / Logging
- **Description**: Messages like `SCHEDTEMPMBR->RUNNING:` and `SCHEDPOTAPP->RUNNING:` are inconsistent with the logging style used everywhere else in the codebase.
- **Recommendation**: Replace with standard structured log messages.

---

### [LOW] Nested variable expansion in `docker-compose.prod.yml` may not expand in Compose V2

- **File**: `docker-compose.prod.yml:44`
- **Category**: Configuration
- **Description**: `"${DATABASE_URL:-postgresql://${POSTGRES_USER:-station_bot}:${POSTGRES_PASSWORD:-change_me}@...}"` uses nested substitution inside a default value, which Compose V2 (Go) does not fully support. The inner `${POSTGRES_USER}` may not be expanded, resulting in a literal string `${POSTGRES_USER}` in the connection string.
- **Recommendation**: Compute the full `DATABASE_URL` in the `.env.production` file and reference it simply as `${DATABASE_URL}` in the Compose file.

---

### [LOW] "Worker started" log fires even when worker is disabled

- **File**: `src/index.ts:79`
- **Category**: Logging Correctness (Copilot comment #2)
- **Description**: When `NOMINATION_WORKER_ENABLED=false`, the worker logs "Nomination worker disabled" and returns `null`, but `index.ts` still logs "Started nomination check worker loop." — a contradictory message.
- **Recommendation**:
  ```typescript
  const workerHandle = startNominationCheckWorkerLoop();
  if (workerHandle) {
    logger.info('Started nomination check worker loop.');
  }
  ```

---

### [LOW] ISO date strings typed as bare `string`

- **File**: `src/services/nominations/job-types.ts`, `src/services/nominations/types.ts`
- **Category**: Type Safety
- **Description**: Fields like `createdAt: string` and `startedAt: string | null` are ISO 8601 strings but typed as bare `string`. The implicit convention is invisible to callers and allows any string to be assigned. A subtle downstream issue: `getLastRefreshedAtUtc` in `review-nominations.command.ts` sorts ISO strings lexicographically via `localeCompare`, which only works correctly for UTC ISO strings.
- **Recommendation**: Consider a branded type `type ISODateString = string & { readonly __iso: true }` or at minimum add JSDoc annotations.

---

### [LOW] RSI handle URL construction may produce incorrect results for user-supplied URLs

- **File**: `src/services/rsi.services.ts:27`
- **Category**: Correctness
- **Description**: `const rsiProfileName = rsiProfile.split('/').pop()` extracts the last path segment if the user enters a full URL, but the `url` variable on the next line is constructed from the original `rsiProfile` rather than the extracted `rsiProfileName`. If a user enters `https://robertsspaceindustries.com/citizens/MyHandle`, the resulting URL will double-encode the full path. This is in the pre-existing verify flow, not the new queue.
- **Recommendation**: Validate that the input is a plain alphanumeric handle and construct the URL from that. The nomination org-check flow does this correctly.

---

### [NITPICK] Magic-number defaults lack explanatory comments

- **File**: `src/services/nominations/job-worker.service.ts:39–43`
- **Description**: Constants like `defaultWorkerConcurrency = 5`, `defaultBatchSize = 20`, `defaultPollMs = 8000` are defined without comments explaining the rationale or throughput target they encode.
- **Recommendation**: Add brief comments (e.g., `// 8s poll: balances RSI rate-limit headroom with job latency`).

---

### [NITPICK] `web-scraping.services.ts` uses `console.error`

- **File**: `src/services/web-scraping.services.ts:25`
- **Description**: Uses `console.error(...)` instead of `logger.error(...)`, bypassing Winston and structured logging.
- **Recommendation**: Replace with `getLogger().error(...)`.

---

### [NITPICK] Module-level `schemaEnsured` flag complicates test isolation

- **File**: `src/services/nominations/db.ts:8`
- **Description**: `let schemaEnsured = false` persists across test cases unless `jest.resetModules()` is called. The current tests handle this correctly but the coupling is invisible.
- **Recommendation**: Expose a `resetSchemaFlag()` test utility or move the flag into a closure.

---

### [NITPICK] `jest.config.mjs` does not configure `resolver` explicitly

- **File**: `jest.config.mjs`
- **Description**: `ts-jest-resolver` is installed as a dev dependency but `resolver` is not set. The ESM `.ts` extension imports rely on ts-jest's default behavior, which may vary across versions.
- **Recommendation**: Add `resolver: 'ts-jest-resolver'` to make the resolution strategy explicit.

---

### [NITPICK] `tsconfig.json` contains inline JSON comments

- **File**: `tsconfig.json:22–23`
- **Description**: Comments (`// Include all TypeScript files in src`) are non-standard JSON, though TypeScript's parser accepts them.
- **Recommendation**: Remove comments or document in a README section.

---

## Copilot Review Comment Assessment

### Comment 1 — `nomination-check-status.command.ts:34`: Use `addIntegerOption` instead of string + manual parse
**Reviewer Severity**: MEDIUM. Correct and actionable. `addIntegerOption` with `setMinValue(1)` eliminates all manual validation. The dead `requestedJobId === null` guard is a direct symptom of this design. Should be fixed before merge.

### Comment 2 — `index.ts:79`: Log "worker started" unconditionally even when worker is disabled
**Reviewer Severity**: LOW. Correct observation. The contradictory log messages are misleading in production. One-line fix: gate the log on a non-null return from `startNominationCheckWorkerLoop()`.

### Comment 3 — `job-worker.service.ts:108`: `envFlag('NOMINATION_WORKER_ENABLED', true)` should default to `false`
**Reviewer Severity**: HIGH. This is the most operationally dangerous issue in the PR. A deploy that omits this variable silently starts RSI scraping. Should be treated as a blocker for merge. One-character fix.

### Comment 4 — `job-queue.repository.ts:400`: `refreshNominationCheckJobProgress` uses multiple separate `withClient()` calls
**Reviewer Severity**: HIGH. Correct and significant. Three non-atomic DB round trips can produce inconsistent job-status snapshots visible to operators and leave the job row stale after a crash. Should be consolidated into a single transaction before merge.

### Comment 5 — `job-queue.repository.ts:252`: Stale-lock interval uses string concatenation instead of interval arithmetic
**Reviewer Severity**: HIGH. Correct. The `safeStaleLockMs` guard reduces risk but does not eliminate it (`Math.floor(NaN)` is `NaN`). Using `($3::numeric * interval '1 millisecond')` is the proper PostgreSQL idiom and costs nothing to implement.

---

## Positive Observations

- **Zero SQL injection risk**: Every query uses `$N` parameterized placeholders consistently throughout all three repository files.
- **Correct `FOR UPDATE SKIP LOCKED` usage**: Idiomatic multi-consumer PostgreSQL job queue pattern applied correctly in both `claimNextRunnableNominationCheckJob` and `claimNominationCheckJobItems`.
- **Bounded concurrency in `mapWithConcurrency`**: Clean and correct implementation avoiding unbounded `Promise.all` on the full item list.
- **Bulk item insertion via `unnest`**: Efficient single-query bulk insert of job items using `unnest($2::text[])` avoids N individual inserts.
- **Startup schema validation**: `ensureNominationsSchema` validates all required tables and columns at startup, providing fast-fail instead of cryptic runtime errors from schema drift.
- **Database constraint quality**: Check constraints for all enum columns, `UNIQUE(job_id, normalized_handle)`, correct composite indexes, and a cross-column consistency constraint between `last_org_check_result_code` and `last_org_check_status` in the nominations table.
- **Complete `down` migrations**: All three migrations include correct reversals with proper dependency ordering (indexes → constraints → tables).
- **`sanitizeForInlineText` applied consistently**: Applied to all user-controlled content before Discord message inclusion and before DB storage in `last_error` fields.
- **Authorization checks correct and consistent**: `ensureAdmin` / `ensureCanManageReviewProcessing` applied on all admin commands. `setDMPermission(false)` on all slash commands. `setDefaultMemberPermissions(Administrator)` provides Discord-side guard on `nomination-access`.
- **Read-only mode evaluated per-interaction**: `isReadOnlyMode()` is called inside the router per interaction (not cached at module load), so flag changes take effect without restart.
- **Error message length-capping**: `refreshNominationCheckJobProgress` caps error summaries at 900 characters before DB write, preventing oversized strings.
- **Docker image hardening**: Multi-stage build with typecheck enforced, `--omit=dev` for runtime, `read_only: true` and `cap_drop: ALL` in docker-compose.
- **Test coverage breadth**: Covers worker happy path, failure/requeue/max-attempts, all HTTP result codes, concurrency sanitization, nomination command flows, access control, read-only mode, startup wiring, handle sanitization, and duplicate-job detection.
- **`allowedMentions: { parse: [] }` everywhere**: All replies containing user-controlled content set this consistently.
- **Retry + exponential backoff in `org-check.service.ts`**: Correct implementation with `Retry-After` header respect, ECONNABORTED detection, and configurable retry parameters.

---

## Recommended Action Order (Before Merging PR #55)

1. **[BLOCKER]** Change `envFlag('NOMINATION_WORKER_ENABLED', true)` → `envFlag('NOMINATION_WORKER_ENABLED', false)` in `job-worker.service.ts:106`
2. **[BLOCKER]** Fix stale-lock SQL in `job-queue.repository.ts:252`: replace `($3::text || ' milliseconds')::interval` with `($3::numeric * interval '1 millisecond')`
3. **[SHOULD FIX]** Make `refreshNominationCheckJobProgress` atomic: consolidate three `withClient()` calls into a single transaction in `job-queue.repository.ts:330–401`
4. **[SHOULD FIX]** Fix the post-COMMIT job reload race in `job-queue.repository.ts:100–109`: reload within the same transaction or add a retry/fallback
5. **[SHOULD FIX]** Replace `addStringOption` with `addIntegerOption` for `job-id` in `nomination-check-status.command.ts:24–34`; remove dead `requestedJobId === null` guard
6. **[SHOULD FIX]** Fix misleading "worker started" log in `index.ts:78–79`: gate on non-null return value
7. **[NICE TO HAVE]** Add cycle-cap to `while(true)` batch loop in `job-worker.service.ts:70`
8. **[NICE TO HAVE]** Store and clear the worker interval handle; add SIGTERM/SIGINT graceful shutdown in `index.ts`
9. **[NICE TO HAVE]** Extract `envFlag` and `parseEnvInt` to `src/utils/env.ts`
10. **[POLISH]** Fix `console.error` → `logger.error` in `web-scraping.services.ts:25`
11. **[POLISH]** Clean up `SCHEDTEMPMBR`/`SCHEDPOTAPP` debug prefixes in `purge-member.job.ts`
12. **[POLISH]** Add `resolver: 'ts-jest-resolver'` to `jest.config.mjs`
