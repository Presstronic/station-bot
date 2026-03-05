import { checkHasAnyOrgMembership } from './org-check.service.ts';
import { updateOrgCheckResult } from './nominations.repository.ts';
import type { NominationRecord, OrgCheckResult, OrgCheckResultCode } from './types.ts';
import { getLogger } from '../../utils/logger.ts';
import { sanitizeForInlineText } from '../../utils/sanitize.ts';

const logger = getLogger();
const defaultRefreshConcurrency = 5;

interface RefreshResult {
  handle: string;
  checkResult: OrgCheckResult;
  checkErrored: boolean;
}

type OrgCheckReasonCounts = Record<OrgCheckResultCode, number>;

export interface OrgRefreshSummary {
  targetCount: number;
  refreshedCount: number;
  errorCount: number;
  businessOutcomeCount: number;
  technicalOutcomeCount: number;
  reasonCounts: OrgCheckReasonCounts;
  errorHandles: string[];
}

function createEmptyReasonCounts(): OrgCheckReasonCounts {
  return {
    in_org: 0,
    not_in_org: 0,
    not_found: 0,
    http_timeout: 0,
    rate_limited: 0,
    parse_failed: 0,
    http_error: 0,
  } satisfies Record<OrgCheckResultCode, number>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function refreshOrgStatusesForNominations(
  nominations: NominationRecord[],
  concurrency = defaultRefreshConcurrency
): Promise<OrgRefreshSummary> {
  if (nominations.length === 0) {
    return {
      targetCount: 0,
      refreshedCount: 0,
      errorCount: 0,
      businessOutcomeCount: 0,
      technicalOutcomeCount: 0,
      reasonCounts: createEmptyReasonCounts(),
      errorHandles: [],
    };
  }

  const safeConcurrency =
    Number.isFinite(concurrency) && concurrency > 0
      ? Math.max(1, Math.floor(concurrency))
      : defaultRefreshConcurrency;

  const results = await mapWithConcurrency(nominations, safeConcurrency, async (nomination): Promise<RefreshResult> => {
    let checkResult: OrgCheckResult = {
      code: nomination.lastOrgCheckResultCode ?? 'http_error',
      status: nomination.lastOrgCheckStatus ?? 'unknown',
      message: nomination.lastOrgCheckResultMessage ?? 'No previous org-check result found',
      checkedAt: nomination.lastOrgCheckResultAt ?? nomination.lastOrgCheckAt ?? new Date().toISOString(),
    };
    let checkErrored = false;

    try {
      checkResult = await checkHasAnyOrgMembership(nomination.displayHandle);
      await updateOrgCheckResult(nomination.normalizedHandle, checkResult);
      nomination.lastOrgCheckStatus = checkResult.status;
      nomination.lastOrgCheckResultCode = checkResult.code;
      nomination.lastOrgCheckResultMessage = checkResult.message ?? null;
      nomination.lastOrgCheckResultAt = checkResult.checkedAt;
      nomination.lastOrgCheckAt = checkResult.checkedAt;
    } catch (error) {
      checkErrored = true;
      logger.error(
        `Org refresh failed for handle ${sanitizeForInlineText(nomination.displayHandle)}: ${String(error)}`
      );
    }

    return {
      handle: sanitizeForInlineText(nomination.displayHandle),
      checkResult,
      checkErrored,
    };
  });

  const completedResults = results.filter((result) => !result.checkErrored);
  const errorHandles = results.filter((result) => result.checkErrored).map((result) => result.handle);
  const reasonCounts = createEmptyReasonCounts();
  for (const result of completedResults) {
    reasonCounts[result.checkResult.code] += 1;
  }

  return {
    targetCount: results.length,
    refreshedCount: completedResults.length,
    errorCount: errorHandles.length,
    businessOutcomeCount:
      reasonCounts.in_org + reasonCounts.not_in_org + reasonCounts.not_found,
    technicalOutcomeCount:
      reasonCounts.http_timeout +
      reasonCounts.rate_limited +
      reasonCounts.parse_failed +
      reasonCounts.http_error,
    reasonCounts,
    errorHandles,
  };
}
