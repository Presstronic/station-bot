import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    locale: 'en-US',
    inGuild: () => true,
    memberPermissions: { has: () => true },
    reply: jest.fn(async () => undefined),
    deferReply: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
    options: {
      getSubcommand: () => 'status',
      getInteger: () => null,
    },
    ...overrides,
  } as any;
}

beforeEach(() => {
  jest.resetModules();
  jest.unstable_mockModule('../../services/nominations/db.js', () => ({
    isDatabaseConfigured: jest.fn(() => true),
    withClient: jest.fn(),
  }));
});

afterEach(async () => {
  const mod = await import('../../services/exec-hangar/exec-hangar-timer.service.js');
  if (typeof mod.resetExecHangarServiceForTests === 'function') {
    mod.resetExecHangarServiceForTests();
  }
});

describe('exec-hangar command', () => {
  it('returns disabled message when feature flag is off', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => false),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction();

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not currently enabled'),
        flags: 64,
      }),
    );
  });

  it('returns uninitialized message when no baseline exists', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(async () => ({
        initialized: false,
        currentState: null,
        nextChangeType: null,
        minutesUntilNextChange: null,
        nextChangeAt: null,
        lastSyncedAt: null,
        syncSource: null,
        confidence: 'stale',
        warningKey: 'startupStale',
      })),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction();

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not initialized yet'),
        flags: 64,
      }),
    );
  });

  it('returns status payload for normal members', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(async () => ({
        initialized: true,
        currentState: 'CLOSED',
        nextChangeType: 'OPEN',
        minutesUntilNextChange: 24,
        nextChangeAt: '2026-05-29T18:00:00.000Z',
        lastSyncedAt: '2026-05-29T17:12:00.000Z',
        syncSource: 'exec.xyxyll.com',
        confidence: 'good',
        warningKey: null,
      })),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction();

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Executive Hangars: CLOSED'),
        flags: 64,
      }),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Opens in: 24 min'),
      }),
    );
  });

  it('requires admin for resync', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      memberPermissions: { has: () => false },
      options: { getSubcommand: () => 'resync', getInteger: () => null },
    });

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Only server administrators'),
        flags: 64,
      }),
    );
  });

  it('manual sync requires exactly one direction', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      options: {
        getSubcommand: () => 'sync',
        getInteger: (name: string) => (name === 'opens-in' ? 5 : 10),
      },
    });

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Provide exactly one'),
        flags: 64,
      }),
    );
  });

  it('returns temporary unavailable when manual sync persistence fails', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(async () => {
        throw new Error('db down');
      }),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      options: {
        getSubcommand: () => 'sync',
        getInteger: (name: string) => (name === 'opens-in' ? 5 : null),
      },
    });

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('temporarily unavailable'),
        flags: 64,
      }),
    );
  });

  it('rejects manual sync minute values above the PostgreSQL integer limit', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      options: {
        getSubcommand: () => 'sync',
        getInteger: (name: string) => (name === 'opens-in' ? 2_147_483_648 : null),
      },
    });

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('opens-in must be a whole number between 1 and 2147483647.'),
        flags: 64,
      }),
    );
  });

  it('rejects cycle offsets that collapse the cycle duration', async () => {
    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig: jest.fn(),
      validateExecHangarCycleOffsetMs: jest.fn(() => {
        throw new Error('cycle-offset-ms must keep the total cycle duration above 0 milliseconds.');
      }),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      options: {
        getSubcommand: () => 'config',
        getInteger: (name: string) => {
          if (name === 'open-duration-minutes') return 60;
          if (name === 'closed-duration-minutes') return 120;
          if (name === 'cycle-offset-ms') return -10_800_000;
          return null;
        },
      },
    });

    await handleExecHangarCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cycle-offset-ms must keep the total cycle duration above 0 milliseconds.'),
        flags: 64,
      }),
    );
  });

  it('rejects cycle offsets above the PostgreSQL integer limit before config persistence', async () => {
    const updateExecHangarConfig = jest.fn();

    jest.unstable_mockModule('../../config/exec-hangar.config.js', () => ({
      isExecHangarEnabled: jest.fn(() => true),
    }));
    jest.unstable_mockModule('../../services/exec-hangar/exec-hangar-timer.service.js', () => ({
      getExecHangarStatus: jest.fn(),
      manualSyncExecHangar: jest.fn(),
      resyncExecHangarFromExternalSource: jest.fn(),
      updateExecHangarConfig,
      validateExecHangarCycleOffsetMs: jest.fn(),
    }));

    const { handleExecHangarCommand } = await import('../exec-hangar.command.js');
    const interaction = makeInteraction({
      options: {
        getSubcommand: () => 'config',
        getInteger: (name: string) => {
          if (name === 'open-duration-minutes') return 60;
          if (name === 'closed-duration-minutes') return 120;
          if (name === 'cycle-offset-ms') return 2_147_483_648;
          return null;
        },
      },
    });

    await handleExecHangarCommand(interaction);

    expect(updateExecHangarConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cycle-offset-ms must be a whole number between -2147483648 and 2147483647.'),
        flags: 64,
      }),
    );
  });
});
