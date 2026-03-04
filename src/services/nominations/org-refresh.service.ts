import { checkHasAnyOrgMembership } from './org-check.service.ts';
import { updateOrgCheckStatus } from './nominations.repository.ts';
import type { NominationRecord, OrgCheckStatus } from './types.ts';
import { getLogger } from '../../utils/logger.ts';

const logger = getLogger();
const defaultRefreshConcurrency = 5;

interface RefreshResult {
  handle: string;
  status: OrgCheckStatus;
  checkErrored: boolean;
}

export interface OrgRefreshSummary {
  targetCount: number;
  refreshedCount: number;
  errorCount: number;
  inOrgCount: number;
  notInOrgCount: number;
  unknownCount: number;
  errorHandles: string[];
}

function sanitizeHandleForList(handle: string): string {
  return handle.replace(/`/g, "'").replace(/\|/g, '/').replace(/[\r\n]+/g, ' ');
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
      inOrgCount: 0,
      notInOrgCount: 0,
      unknownCount: 0,
      errorHandles: [],
    };
  }

  const results = await mapWithConcurrency(nominations, concurrency, async (nomination): Promise<RefreshResult> => {
    let status: OrgCheckStatus = 'unknown';
    let checkErrored = false;

    try {
      status = await checkHasAnyOrgMembership(nomination.displayHandle);
    } catch (error) {
      checkErrored = true;
      logger.error(`Org refresh failed for handle ${nomination.displayHandle}: ${String(error)}`);
    }

    await updateOrgCheckStatus(nomination.normalizedHandle, status);
    nomination.lastOrgCheckStatus = status;
    nomination.lastOrgCheckAt = new Date().toISOString();

    return {
      handle: sanitizeHandleForList(nomination.displayHandle),
      status,
      checkErrored,
    };
  });

  const completedResults = results.filter((result) => !result.checkErrored);
  const errorHandles = results.filter((result) => result.checkErrored).map((result) => result.handle);

  return {
    targetCount: results.length,
    refreshedCount: completedResults.length,
    errorCount: errorHandles.length,
    inOrgCount: completedResults.filter((result) => result.status === 'in_org').length,
    notInOrgCount: completedResults.filter((result) => result.status === 'not_in_org').length,
    unknownCount: completedResults.filter((result) => result.status === 'unknown').length,
    errorHandles,
  };
}
