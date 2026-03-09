import { getLogger } from '../../utils/logger.ts';
import { sanitizeForInlineText } from '../../utils/sanitize.ts';
import { checkHasAnyOrgMembership } from './org-check.service.ts';
import { updateOrgCheckResult } from './nominations.repository.ts';
import {
  claimNextRunnableNominationCheckJob,
  claimNominationCheckJobItems,
  completeNominationCheckJobItem,
  failNominationCheckJobItem,
  refreshNominationCheckJobProgress,
  requeueNominationCheckJobItem,
} from './job-queue.repository.ts';

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
  const workerConcurrency = Math.max(1, parseEnvInt('NOMINATION_WORKER_CONCURRENCY', defaultWorkerConcurrency));
  const batchSize = Math.max(1, parseEnvInt('NOMINATION_WORKER_BATCH_SIZE', defaultBatchSize));
  const staleLockMs = Math.max(1000, parseEnvInt('NOMINATION_WORKER_STALE_LOCK_MS', defaultStaleLockMs));
  const maxAttempts = Math.max(1, parseEnvInt('NOMINATION_WORKER_MAX_ATTEMPTS', defaultMaxAttempts));

  const job = await claimNextRunnableNominationCheckJob();
  if (!job) {
    return false;
  }

  logger.info(`Nomination worker claimed job ${job.id} (scope=${job.requestedScope}, total=${job.totalCount})`);

  while (true) {
    const items = await claimNominationCheckJobItems(job.id, batchSize, staleLockMs);
    if (items.length === 0) {
      break;
    }

    await mapWithConcurrency(items, workerConcurrency, async (item) => {
      try {
        const result = await checkHasAnyOrgMembership(item.normalizedHandle);
        await updateOrgCheckResult(item.normalizedHandle, result);
        await completeNominationCheckJobItem(item.id);
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

    await refreshNominationCheckJobProgress(job.id);
  }

  const finishedJob = await refreshNominationCheckJobProgress(job.id);
  const jobStatus = finishedJob?.status ?? 'unknown';
  const isTerminal = jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'cancelled';
  if (isTerminal) {
    logger.info(
      `Nomination worker completed job ${job.id} (status=${jobStatus}, completed=${finishedJob?.completedCount ?? 0}, failed=${finishedJob?.failedCount ?? 0})`
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
