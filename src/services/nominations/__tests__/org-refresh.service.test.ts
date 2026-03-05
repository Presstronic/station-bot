import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function buildNomination(handle: string) {
  return {
    normalizedHandle: handle.toLowerCase(),
    displayHandle: handle,
    nominationCount: 1,
    isProcessed: false,
    processedByUserId: null,
    processedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastOrgCheckStatus: null,
    lastOrgCheckAt: null,
    events: [],
  };
}

describe('refreshOrgStatusesForNominations', () => {
  it('sanitizes invalid concurrency values and still processes nominations', async () => {
    const updateOrgCheckStatus = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => 'not_in_org');

    jest.unstable_mockModule('../nominations.repository.ts', () => ({
      updateOrgCheckStatus,
    }));
    jest.unstable_mockModule('../org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { refreshOrgStatusesForNominations } = await import('../org-refresh.service.ts');
    const summary = await refreshOrgStatusesForNominations(
      [buildNomination('PilotOne'), buildNomination('PilotTwo')] as any,
      0
    );

    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(2);
    expect(updateOrgCheckStatus).toHaveBeenCalledTimes(2);
    expect(summary.targetCount).toBe(2);
    expect(summary.refreshedCount).toBe(2);
    expect(summary.errorCount).toBe(0);
  });

  it('sanitizes handle text before logging refresh failures', async () => {
    const updateOrgCheckStatus = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => {
      throw new Error('transient');
    });
    const loggerError = jest.fn();

    jest.unstable_mockModule('../nominations.repository.ts', () => ({
      updateOrgCheckStatus,
    }));
    jest.unstable_mockModule('../org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));
    jest.unstable_mockModule('../../../utils/logger.ts', () => ({
      getLogger: () => ({
        error: loggerError,
      }),
    }));

    const { refreshOrgStatusesForNominations } = await import('../org-refresh.service.ts');
    const summary = await refreshOrgStatusesForNominations([buildNomination('Bad\n|`Handle') as any], 1);

    expect(summary.errorHandles).toEqual(["Bad /'Handle"]);
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("Org refresh failed for handle Bad /'Handle:")
    );
    expect(loggerError).toHaveBeenCalledWith(expect.not.stringContaining('\n'));
    expect(updateOrgCheckStatus).not.toHaveBeenCalled();
  });
});
