import { getLogger } from '../../utils/logger.js';
import { sanitizeForInlineText } from '../../utils/sanitize.js';
import { checkHasAnyOrgMembership } from './org-check.service.js';
import { updateOrgCheckResult } from './nominations.repository.js';
import {
  claimNextRunnableNominationCheckJob,
  claimNominationCheckJobItems,
  completeNominationCheckJobItem,
  failNominationCheckJobItem,
  refreshNominationCheckJobProgress,
  requeueNominationCheckJobItem,
} from './job-queue.repository.js';

const logger = getLogger();

function parseEnvInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

const defaultWorkerConcurrency = 5;
const defaultBatchSize = 20;
const defaultStaleLockMs = 5 * 60 * 1000;
const defaultMaxAttempts = 3;
const defaultPollMs = 8000;

async function mapWithConcurrency<T>(items: T[], limit: number, iteratee: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await iteratee(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
}

export async function runNominationCheckWorkerCycle(): Promise<boolean> {
  const workerConcurrency = Math.max(1, Math.floor(parseEnvInt('NOMINATION_WORKER_CONCURRENCY', defaultWorkerConcurrency)));
  const batchSize = Math.max(1, Math.floor(parseEnvInt('NOMINATION_WORKER_BATCH_SIZE', defaultBatchSize)));
  const staleLockMs = Math.max(1000, parseEnvInt('NOMINATION_WORKER_STALE_LOCK_MS', defaultStaleLockMs));
  const maxAttempts = Math.max(1, Math.floor(parseEnvInt('NOMINATION_WORKER_MAX_ATTEMPTS', defaultMaxAttempts)));

  const job = await claimNextRunnableNominationCheckJob(staleLockMs);
  if (!job) {
    logger.debug('worker: poll — no runnable job found');
    return false;
  }

  logger.info(`Nomination worker claimed job ${job.id} (scope=${job.requestedScope}, total=${job.totalCount})`);

  // Scale by maxAttempts so items that fail and are requeued within the same
  // cycle still have room to exhaust all retry attempts before the cap fires.
  // +2 slack accounts for stale-lock reclaims that may re-claim items
  // already counted in totalCount.
  const maxBatches = Math.ceil(job.totalCount / batchSize) * maxAttempts + 2;
  let batchNumber = 0;
  let cappedByLimit = false;
  // Tracks the most recent refreshNominationCheckJobProgress result. Reused as
  // finishedJob after the loop to avoid a redundant DB round-trip whenever the
  // last refresh is still current (terminal break, empty-items break after ≥1
  // batch, or cap break after ≥1 batch). Null when zero batches were processed.
  let lastKnownProgress: Awaited<ReturnType<typeof refreshNominationCheckJobProgress>> = null;

  while (true) {
    if (batchNumber >= maxBatches) {
      logger.warn(
        `Nomination worker reached max batch iterations for job ${job.id} — possible stuck items, breaking`,
        { jobId: job.id, batchesProcessed: batchNumber, maxBatches }
      );
      cappedByLimit = true;
      break;
    }
    batchNumber++;

    const items = await claimNominationCheckJobItems(job.id, batchSize, staleLockMs);
    logger.debug(`worker: batch ${batchNumber}/${maxBatches} claimed ${items.length} items (jobId=${job.id})`);
    if (items.length === 0) {
      break;
    }

    await mapWithConcurrency(items, workerConcurrency, async (item) => {
      const itemStart = Date.now();
      logger.debug(
        `worker: checking "${sanitizeForInlineText(item.normalizedHandle)}" (jobId=${job.id}, itemId=${item.id}, attempt=${item.attemptCount})`
      );
      try {
        const result = await checkHasAnyOrgMembership(item.normalizedHandle);
        await updateOrgCheckResult(item.normalizedHandle, result);
        await completeNominationCheckJobItem(item.id);
        logger.debug(
          `worker: item done (jobId=${job.id}, itemId=${item.id}, handle="${sanitizeForInlineText(item.normalizedHandle)}", result=${result.code}, elapsed=${Date.now() - itemStart}ms)`
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          `Nomination worker item failed (jobId=${job.id}, itemId=${item.id}, handle=${sanitizeForInlineText(item.normalizedHandle)}, attempt=${item.attemptCount}): ${sanitizeForInlineText(errorMessage)}`
        );
        if (item.attemptCount >= maxAttempts) {
          await failNominationCheckJobItem(item.id, errorMessage);
        } else {
          await requeueNominationCheckJobItem(item.id, errorMessage);
        }
      }
    });

    lastKnownProgress = await refreshNominationCheckJobProgress(job.id);
    const batchStatus = lastKnownProgress?.status ?? 'unknown';
    if (batchStatus === 'completed' || batchStatus === 'failed' || batchStatus === 'cancelled') {
      break;
    }
  }

  // Use the cached result when available (any break path after ≥1 processed batch
  // leaves lastKnownProgress current). Fall back to a fresh refresh only when zero
  // batches were processed (first claim returned empty).
  const finishedJob = lastKnownProgress ?? await refreshNominationCheckJobProgress(job.id);
  const jobStatus = finishedJob?.status ?? 'unknown';
  const isTerminal = jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'cancelled';
  if (isTerminal) {
    logger.info(
      `Nomination worker completed job ${job.id} (status=${jobStatus}, completed=${finishedJob?.completedCount ?? 0}, failed=${finishedJob?.failedCount ?? 0})`
    );
  } else if (cappedByLimit) {
    logger.warn(
      `Nomination worker hit batch cap for job ${job.id} — items remain unprocessed; job stays running and will be retried on a subsequent poll once items become claimable (after staleLockMs elapses)`,
      { jobId: job.id, status: jobStatus, completed: finishedJob?.completedCount ?? 0, failed: finishedJob?.failedCount ?? 0, staleLockMs }
    );
  } else {
    logger.info(
      `Nomination worker exhausted claimable items for job ${job.id} (status=${jobStatus}, completed=${finishedJob?.completedCount ?? 0}, failed=${finishedJob?.failedCount ?? 0}) — will retry on next poll`
    );
  }

  return true;
}

export function startNominationCheckWorkerLoop(): NodeJS.Timeout | null {
  if (!envFlag('NOMINATION_WORKER_ENABLED', false)) {
    logger.info('Nomination worker disabled (NOMINATION_WORKER_ENABLED=false).');
    return null;
  }

  const pollMs = Math.max(1000, parseEnvInt('NOMINATION_WORKER_POLL_MS', defaultPollMs));
  let running = false;

  const runCycleSafely = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runNominationCheckWorkerCycle();
    } catch (error) {
      logger.error(`Nomination worker cycle failed: ${String(error)}`);
    } finally {
      running = false;
    }
  };

  void runCycleSafely();
  return setInterval(() => {
    void runCycleSafely();
  }, pollMs);
}
