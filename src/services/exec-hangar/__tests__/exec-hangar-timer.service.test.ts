import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('exec hangar timer service', () => {
  it('derives status before the stored next change', async () => {
    const { deriveExecHangarStatus, markExecHangarSyncSucceededForTests } = await import('../exec-hangar-timer.service.js');
    markExecHangarSyncSucceededForTests();

    const status = deriveExecHangarStatus(
      {
        id: 'id-1',
        singletonKey: 'global',
        currentState: 'CLOSED',
        nextChangeAt: '2026-05-29T17:30:00.000Z',
        nextChangeType: 'OPEN',
        lastSyncedAt: '2026-05-29T17:00:00.000Z',
        syncSource: 'exec.xyxyll.com',
        openDurationMinutes: 60,
        closedDurationMinutes: 120,
        cycleOffsetMs: 0,
        createdAt: '2026-05-29T17:00:00.000Z',
        updatedAt: '2026-05-29T17:00:00.000Z',
      },
      new Date('2026-05-29T17:05:00.000Z'),
    );

    expect(status.initialized).toBe(true);
    expect(status.currentState).toBe('CLOSED');
    expect(status.nextChangeType).toBe('OPEN');
    expect(status.minutesUntilNextChange).toBe(25);
    expect(status.confidence).toBe('good');
  });

  it('derives status after the first transition using local cycle math', async () => {
    const { deriveExecHangarStatus, markExecHangarSyncSucceededForTests } = await import('../exec-hangar-timer.service.js');
    markExecHangarSyncSucceededForTests();

    const status = deriveExecHangarStatus(
      {
        id: 'id-1',
        singletonKey: 'global',
        currentState: 'CLOSED',
        nextChangeAt: '2026-05-29T17:30:00.000Z',
        nextChangeType: 'OPEN',
        lastSyncedAt: '2026-05-29T17:00:00.000Z',
        syncSource: 'manual-admin',
        openDurationMinutes: 60,
        closedDurationMinutes: 120,
        cycleOffsetMs: 0,
        createdAt: '2026-05-29T17:00:00.000Z',
        updatedAt: '2026-05-29T17:00:00.000Z',
      },
      new Date('2026-05-29T18:00:00.000Z'),
    );

    expect(status.currentState).toBe('OPEN');
    expect(status.nextChangeType).toBe('CLOSE');
    expect(status.minutesUntilNextChange).toBe(30);
  });

  it('marks state as stale when no successful sync has happened this startup', async () => {
    const { deriveExecHangarStatus, resetExecHangarServiceForTests } = await import('../exec-hangar-timer.service.js');
    resetExecHangarServiceForTests();

    const status = deriveExecHangarStatus(
      {
        id: 'id-1',
        singletonKey: 'global',
        currentState: 'CLOSED',
        nextChangeAt: '2026-05-29T17:30:00.000Z',
        nextChangeType: 'OPEN',
        lastSyncedAt: '2026-05-29T17:00:00.000Z',
        syncSource: 'exec.xyxyll.com',
        openDurationMinutes: 60,
        closedDurationMinutes: 120,
        cycleOffsetMs: 0,
        createdAt: '2026-05-29T17:00:00.000Z',
        updatedAt: '2026-05-29T17:00:00.000Z',
      },
      new Date('2026-05-29T17:05:00.000Z'),
    );

    expect(status.confidence).toBe('stale');
    expect(status.warningKey).toBe('startupStale');
  });
});
