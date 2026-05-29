import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

let preTestSigtermListeners: Function[] = [];
let preTestSigintListeners: Function[] = [];

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-token' };
  delete process.env.DATABASE_URL;
  process.env.LOG_LEVEL = 'info';
  preTestSigtermListeners = [...process.rawListeners('SIGTERM')];
  preTestSigintListeners = [...process.rawListeners('SIGINT')];
});

afterEach(() => {
  process.env = { ...originalEnv };
  for (const listener of process.rawListeners('SIGTERM')) {
    if (!preTestSigtermListeners.includes(listener)) {
      process.off('SIGTERM', listener as NodeJS.SignalsListener);
    }
  }
  for (const listener of process.rawListeners('SIGINT')) {
    if (!preTestSigintListeners.includes(listener)) {
      process.off('SIGINT', listener as NodeJS.SignalsListener);
    }
  }
});

async function loadIndexAndRunReady(
  readOnlyMode: 'true' | 'false',
  options: {
    nominationDigestEnabled?: 'true' | 'false';
    execHangarEnabled?: 'true' | 'false';
    dbConfigured?: boolean;
    purgeTaskCount?: number;
    digestTaskCount?: number;
    guildConfigThrows?: boolean;
    guildConfigs?: Array<{ guildId: string; verificationEnabled: boolean; purgeJobsEnabled: boolean; manufacturingEnabled: boolean }>;
  } = {},
) {
  process.env.BOT_READ_ONLY_MODE = readOnlyMode;
  if (options.nominationDigestEnabled !== undefined) {
    process.env.NOMINATION_DIGEST_ENABLED = options.nominationDigestEnabled;
  } else {
    delete process.env.NOMINATION_DIGEST_ENABLED;
  }
  if (options.execHangarEnabled !== undefined) {
    process.env.EXEC_HANGAR_ENABLED = options.execHangarEnabled;
  } else {
    delete process.env.EXEC_HANGAR_ENABLED;
  }

  const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
  const ensureNominationsSchema = jest.fn(async () => undefined);
  const isDatabaseConfigured = jest.fn(() => options.dbConfigured ?? false);
  const addMissingDefaultRoles = jest.fn(async () => undefined);
  const purgeTaskCount = options.purgeTaskCount ?? 0;
  const purgeTasks = new Map(
    Array.from({ length: purgeTaskCount }, (_, i) => [`purge-guild-${i}`, { stop: jest.fn() }]),
  );
  const schedulePurgeJobs = jest.fn(() => purgeTasks);
  const digestTaskCount = options.digestTaskCount ?? 0;
  const digestTasks = new Map(
    Array.from({ length: digestTaskCount }, (_, i) => [`guild-${i}`, { stop: jest.fn() }]),
  );
  const scheduleNominationDigests = jest.fn(() => digestTasks);
  const startNominationCheckWorkerLoop = jest.fn();
  const buildStartupBanner = jest.fn(() => '[startup banner]');
  const checkBotPermissions = jest.fn(() => []);
  const notifyOwnerOfMissingPermissions = jest.fn(async () => undefined);
  const ensureExecHangarSchema = jest.fn(async () => undefined);
  const performExecHangarStartupSync = jest.fn(async () => ({
    success: true,
    state: {
      currentState: 'OPEN',
      nextChangeAt: new Date().toISOString(),
      nextChangeType: 'CLOSE',
      openDurationMinutes: 60,
      closedDurationMinutes: 120,
      cycleOffsetMs: 0,
    },
  }));
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let readyHandler: (() => Promise<void>) | undefined;

  await jest.unstable_mockModule('../bootstrap.js', () => ({}));
  await jest.unstable_mockModule('../commands/register-commands.js', () => ({
    registerAllCommands,
  }));
  await jest.unstable_mockModule('../services/nominations/db.js', () => ({
    ensureNominationsSchema,
    isDatabaseConfigured,
    endDbPoolIfInitialized: jest.fn(async () => undefined),
  }));
  await jest.unstable_mockModule('../interactions/interactionRouter.js', () => ({
    handleInteraction: jest.fn(async () => undefined),
    attemptFallbackReply: jest.fn(async () => undefined),
  }));
  await jest.unstable_mockModule('../jobs/discord/purge-member.job.js', () => ({
    schedulePurgeJobs,
  }));
  await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
    scheduleNominationDigests,
    rescheduleGuildDigest: jest.fn(),
  }));
  await jest.unstable_mockModule('../jobs/discord/manufacturing-keepalive.job.js', () => ({
    scheduleManufacturingKeepalives: jest.fn(() => new Map()),
    rescheduleGuildKeepalive: jest.fn(),
  }));
  await jest.unstable_mockModule('../services/role.services.js', () => ({
    addMissingDefaultRoles,
  }));
  await jest.unstable_mockModule('../config/nomination-digest.config.js', () => ({
    isNominationDigestEnabled: () => options.nominationDigestEnabled === 'true',
  }));
  await jest.unstable_mockModule('../config/exec-hangar.config.js', () => ({
    isExecHangarEnabled: () => options.execHangarEnabled === 'true',
  }));
  await jest.unstable_mockModule('../services/nominations/job-worker.service.js', () => ({
    startNominationCheckWorkerLoop,
  }));
  await jest.unstable_mockModule('../utils/startup-banner.js', () => ({
    buildStartupBanner,
  }));
  await jest.unstable_mockModule('../utils/permission-check.js', () => ({
    checkBotPermissions,
    notifyOwnerOfMissingPermissions,
  }));
  await jest.unstable_mockModule('../domain/exec-hangar/exec-hangar.repository.js', () => ({
    ensureExecHangarSchema,
  }));
  await jest.unstable_mockModule('../services/exec-hangar/exec-hangar-timer.service.js', () => ({
    performExecHangarStartupSync,
  }));
  await jest.unstable_mockModule('../utils/logger.js', () => ({
    getLogger: () => logger,
  }));
  await jest.unstable_mockModule('../utils/diagnostics.js', () => ({
    startEventLoopMonitor: jest.fn(() => {
      const handle = setInterval(() => undefined, 99999);
      handle.unref();
      return handle;
    }),
    subscribeRestEvents: jest.fn(),
    subscribeUndiciDiagnostics: jest.fn(),
  }));
  await jest.unstable_mockModule('../domain/manufacturing/manufacturing.forum.js', () => ({
    ensureForumTags: jest.fn(async () => new Map()),
    formatOrderPost: jest.fn(() => ''),
    buildForumPostComponents: jest.fn(() => []),
    ORDER_STATUS_TAG_NAMES: [],
    MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
    MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
    MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
  }));
  const seedGuildConfigsFromEnv = jest.fn(async () => undefined);
  await jest.unstable_mockModule('../domain/guild-config/guild-config.seeder.js', () => ({
    seedGuildConfigFromEnv: jest.fn(async () => undefined),
    seedGuildConfigsFromEnv,
  }));
  await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
    ensureGuildConfigsSchema: jest.fn(async () => undefined),
    getGuildConfigOrNull: options.guildConfigThrows
      ? jest.fn(async () => { throw new Error('DB down'); })
      : jest.fn(async (guildId: string) => options.guildConfigs?.find((config) => config.guildId === guildId) ?? null),
    getAllGuildConfigs: jest.fn(async () => options.guildConfigs ?? []),
  }));
  await jest.unstable_mockModule('discord.js', () => {
    class MockClient {
      guilds = {
        cache: new Map([
          ['1', { id: '1', name: 'Guild One' }],
          ['2', { id: '2', name: 'Guild Two' }],
        ]),
      };
      user = { tag: 'station-bot#0001' };

      once(event: string, callback: () => Promise<void>) {
        if (event === 'clientReady') {
          readyHandler = callback;
        }
      }

      on() {
        return undefined;
      }

      destroy() {
        return undefined;
      }

      login() {
        return Promise.resolve('ok');
      }
    }

    class MockForumChannel {}

    return {
      Client: MockClient,
      IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
      MessageFlags: { Ephemeral: 64 },
      ChannelType: { GuildForum: 15 },
      ForumChannel: MockForumChannel,
    };
  });

  await import('../index.js');
  expect(readyHandler).toBeDefined();
  await readyHandler!();

  return {
    registerAllCommands,
    ensureNominationsSchema,
    isDatabaseConfigured,
    addMissingDefaultRoles,
    schedulePurgeJobs,
    scheduleNominationDigests,
    startNominationCheckWorkerLoop,
    buildStartupBanner,
    checkBotPermissions,
    notifyOwnerOfMissingPermissions,
    ensureExecHangarSchema,
    performExecHangarStartupSync,
    logger,
    seedGuildConfigsFromEnv,
  };
}

describe('startup wiring with read-only mode', () => {
  it('skips startup side effects when BOT_READ_ONLY_MODE=true', async () => {
    const {
      registerAllCommands,
      addMissingDefaultRoles,
      schedulePurgeJobs,
      startNominationCheckWorkerLoop,
      seedGuildConfigsFromEnv,
    } = await loadIndexAndRunReady('true');

    expect(registerAllCommands).toHaveBeenCalledTimes(1);
    expect(registerAllCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).not.toHaveBeenCalled();
    expect(schedulePurgeJobs).not.toHaveBeenCalled();
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
    expect(seedGuildConfigsFromEnv).not.toHaveBeenCalled();
  });

  it('runs startup side effects when BOT_READ_ONLY_MODE=false', async () => {
    const {
      registerAllCommands,
      addMissingDefaultRoles,
      schedulePurgeJobs,
      startNominationCheckWorkerLoop,
    } = await loadIndexAndRunReady('false');

    expect(registerAllCommands).toHaveBeenCalledTimes(1);
    expect(registerAllCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(schedulePurgeJobs).not.toHaveBeenCalled();
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
  });

  it('schedules nomination digest jobs when enabled and the database is configured', async () => {
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const { scheduleNominationDigests, schedulePurgeJobs, buildStartupBanner } = await loadIndexAndRunReady(
      'false',
      { nominationDigestEnabled: 'true', dbConfigured: true, digestTaskCount: 1 },
    );

    expect(scheduleNominationDigests).toHaveBeenCalledTimes(1);
    expect(schedulePurgeJobs).toHaveBeenCalledTimes(1);
    expect(buildStartupBanner).toHaveBeenCalledWith(
      expect.objectContaining({ nominationDigestJobActive: true }),
    );
  });

  it('reports nominationDigestJobActive=false when scheduling returns an empty map', async () => {
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const { scheduleNominationDigests, buildStartupBanner } = await loadIndexAndRunReady(
      'false',
      {
        nominationDigestEnabled: 'true',
        dbConfigured: true,
        digestTaskCount: 0,
      },
    );

    expect(scheduleNominationDigests).toHaveBeenCalledTimes(1);
    expect(buildStartupBanner).toHaveBeenCalledWith(
      expect.objectContaining({ nominationDigestJobActive: false }),
    );
  });

  it('schedules purge jobs from guild config rows when the database is configured', async () => {
    const {
      addMissingDefaultRoles,
      schedulePurgeJobs,
      buildStartupBanner,
    } = await loadIndexAndRunReady('false', { dbConfigured: true, purgeTaskCount: 1 });

    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(schedulePurgeJobs).toHaveBeenCalledTimes(1);
    expect(buildStartupBanner).toHaveBeenCalledWith(
      expect.objectContaining({ purgeJobsEnabled: true }),
    );
  });

  it('skips addMissingDefaultRoles when guild config load throws during startup', async () => {
    const { addMissingDefaultRoles } = await loadIndexAndRunReady('false', {
      dbConfigured: true,
      guildConfigThrows: true,
    });

    expect(addMissingDefaultRoles).not.toHaveBeenCalled();
  });

  it('does not require verification permissions in guilds where guild config disables verification', async () => {
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const { checkBotPermissions } = await loadIndexAndRunReady('false', {
      dbConfigured: true,
      guildConfigs: [
        {
          guildId: '1',
          verificationEnabled: false,
          purgeJobsEnabled: false,
          manufacturingEnabled: false,
        },
      ],
    });

    expect(checkBotPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({
        verificationEnabled: false,
        purgeJobsEnabled: false,
        manufacturingEnabled: false,
      }),
    );
  });

  it('fails fast when DATABASE_URL is configured but schema check fails', async () => {
    process.env.BOT_READ_ONLY_MODE = 'false';
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
    const ensureNominationsSchema = jest.fn(async () => {
      throw new Error('schema missing');
    });
    const isDatabaseConfigured = jest.fn(() => true);
    const addMissingDefaultRoles = jest.fn(async () => undefined);
    const schedulePurgeJobs = jest.fn();
    const startNominationCheckWorkerLoop = jest.fn();
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    let readyHandler: (() => Promise<void>) | undefined;

    await jest.unstable_mockModule('../bootstrap.js', () => ({}));
    await jest.unstable_mockModule('../commands/register-commands.js', () => ({
      registerAllCommands,
    }));
    await jest.unstable_mockModule('../services/nominations/db.js', () => ({
      ensureNominationsSchema,
      isDatabaseConfigured,
      endDbPoolIfInitialized: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../interactions/interactionRouter.js', () => ({
      handleInteraction: jest.fn(async () => undefined),
      attemptFallbackReply: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../jobs/discord/purge-member.job.js', () => ({
      schedulePurgeJobs,
    }));
    await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
      scheduleNominationDigests: jest.fn(() => new Map()),
      rescheduleGuildDigest: jest.fn(),
    }));
    await jest.unstable_mockModule('../jobs/discord/manufacturing-keepalive.job.js', () => ({
      scheduleManufacturingKeepalives: jest.fn(() => new Map()),
      rescheduleGuildKeepalive: jest.fn(),
    }));
    await jest.unstable_mockModule('../services/role.services.js', () => ({
      addMissingDefaultRoles,
    }));
    await jest.unstable_mockModule('../config/nomination-digest.config.js', () => ({
      isNominationDigestEnabled: () => false,
    }));
    await jest.unstable_mockModule('../services/nominations/job-worker.service.js', () => ({
      startNominationCheckWorkerLoop,
    }));
    await jest.unstable_mockModule('../utils/startup-banner.js', () => ({
      buildStartupBanner: jest.fn(() => '[startup banner]'),
    }));
    await jest.unstable_mockModule('../utils/permission-check.js', () => ({
      checkBotPermissions: jest.fn(() => []),
      notifyOwnerOfMissingPermissions: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../utils/logger.js', () => ({
      getLogger: () => logger,
    }));
    await jest.unstable_mockModule('../utils/diagnostics.js', () => ({
      startEventLoopMonitor: jest.fn(() => {
        const handle = setInterval(() => undefined, 99999);
        handle.unref();
        return handle;
      }),
      subscribeRestEvents: jest.fn(),
      subscribeUndiciDiagnostics: jest.fn(),
    }));
    await jest.unstable_mockModule('../domain/manufacturing/manufacturing.forum.js', () => ({
      ensureForumTags: jest.fn(async () => new Map()),
      formatOrderPost: jest.fn(() => ''),
      buildForumPostComponents: jest.fn(() => []),
      ORDER_STATUS_TAG_NAMES: [],
      MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
      MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
      MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.seeder.js', () => ({
      seedGuildConfigFromEnv: jest.fn(async () => undefined),
      seedGuildConfigsFromEnv: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
      ensureGuildConfigsSchema: jest.fn(async () => undefined),
      getGuildConfigOrNull: jest.fn(async () => null),
      getAllGuildConfigs: jest.fn(async () => []),
    }));
    await jest.unstable_mockModule('discord.js', () => {
      class MockClient {
        guilds = { cache: new Map() };
        user = { tag: 'station-bot#0001' };
        once(event: string, callback: () => Promise<void>) {
          if (event === 'clientReady') {
            readyHandler = callback;
          }
        }
        on() {
          return undefined;
        }
        destroy() {
          return undefined;
        }
        login() {
          return Promise.resolve('ok');
        }
      }
      class MockForumChannel {}
      return {
        Client: MockClient,
        IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
        MessageFlags: { Ephemeral: 64 },
        ChannelType: { GuildForum: 15 },
        ForumChannel: MockForumChannel,
      };
    });

    await import('../index.js');
    await readyHandler!();

    expect(ensureNominationsSchema).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(registerAllCommands).not.toHaveBeenCalled();
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('fails fast when guild config seeding throws', async () => {
    process.env.BOT_READ_ONLY_MODE = 'false';
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
    const ensureNominationsSchema = jest.fn(async () => undefined);
    const isDatabaseConfigured = jest.fn(() => true);
    const startNominationCheckWorkerLoop = jest.fn();
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let readyHandler: (() => Promise<void>) | undefined;

    await jest.unstable_mockModule('../bootstrap.js', () => ({}));
    await jest.unstable_mockModule('../commands/register-commands.js', () => ({ registerAllCommands }));
    await jest.unstable_mockModule('../services/nominations/db.js', () => ({
      ensureNominationsSchema,
      isDatabaseConfigured,
      endDbPoolIfInitialized: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../interactions/interactionRouter.js', () => ({
      handleInteraction: jest.fn(async () => undefined),
      attemptFallbackReply: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../jobs/discord/purge-member.job.js', () => ({
      schedulePurgeJobs: jest.fn(() => new Map()),
    }));
    await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
      scheduleNominationDigests: jest.fn(() => new Map()),
      rescheduleGuildDigest: jest.fn(),
    }));
    await jest.unstable_mockModule('../services/role.services.js', () => ({
      addMissingDefaultRoles: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../config/nomination-digest.config.js', () => ({
      isNominationDigestEnabled: () => false,
      validateNominationDigestConfig: () => [],
      getNominationDigestConfig: () => ({ channelId: 'c', roleId: 'r', cronSchedule: '0 9 * * *' }),
    }));
    await jest.unstable_mockModule('../services/nominations/job-worker.service.js', () => ({
      startNominationCheckWorkerLoop,
    }));
    await jest.unstable_mockModule('../utils/startup-banner.js', () => ({
      buildStartupBanner: jest.fn(() => '[startup banner]'),
    }));
    await jest.unstable_mockModule('../utils/permission-check.js', () => ({
      checkBotPermissions: jest.fn(() => []),
      notifyOwnerOfMissingPermissions: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../utils/logger.js', () => ({ getLogger: () => logger }));
    await jest.unstable_mockModule('../utils/diagnostics.js', () => ({
      startEventLoopMonitor: jest.fn(() => { const h = setInterval(() => undefined, 99999); h.unref(); return h; }),
      subscribeRestEvents: jest.fn(),
      subscribeUndiciDiagnostics: jest.fn(),
    }));
    await jest.unstable_mockModule('../domain/manufacturing/manufacturing.forum.js', () => ({
      ensureForumTags: jest.fn(async () => new Map()),
      formatOrderPost: jest.fn(() => ''),
      buildForumPostComponents: jest.fn(() => []),
      ORDER_STATUS_TAG_NAMES: [],
      MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
      MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
      MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.seeder.js', () => ({
      seedGuildConfigFromEnv: jest.fn(async () => undefined),
      seedGuildConfigsFromEnv: jest.fn(async () => {
        throw new AggregateError([new Error('DB down')], 'seeding failed');
      }),
    }));
    await jest.unstable_mockModule('discord.js', () => {
      class MockClient {
        guilds = { cache: new Map() };
        user = { tag: 'station-bot#0001' };
        once(event: string, callback: () => Promise<void>) {
          if (event === 'clientReady') readyHandler = callback;
        }
        on() { return undefined; }
        destroy() { return undefined; }
        login() { return Promise.resolve('ok'); }
      }
      class MockForumChannel {}
      return {
        Client: MockClient,
        IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
        MessageFlags: { Ephemeral: 64 },
        ChannelType: { GuildForum: 15 },
        ForumChannel: MockForumChannel,
      };
    });

    await import('../index.js');
    await readyHandler!();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to seed guild configs from environment', expect.any(AggregateError));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('guild config seeding failed. Aborting startup'));
    expect(registerAllCommands).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('shutdown handler clears the worker interval, destroys the client, and sets exitCode=0', async () => {
    const fakeInterval = { _destroyed: false } as unknown as NodeJS.Timeout;
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
    const destroySpy = jest.fn();
    const endDbPoolIfInitialized = jest.fn(async () => undefined);

    const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
    const ensureNominationsSchema = jest.fn(async () => undefined);
    const isDatabaseConfigured = jest.fn(() => true);
    const addMissingDefaultRoles = jest.fn(async () => undefined);
    const purgeStopSpy = jest.fn();
    const schedulePurgeJobs = jest.fn(() => new Map([['guild-1', { stop: purgeStopSpy }]]));
    const startNominationCheckWorkerLoop = jest.fn(() => fakeInterval);
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    let readyHandler: (() => Promise<void>) | undefined;

    await jest.unstable_mockModule('../bootstrap.js', () => ({}));
    await jest.unstable_mockModule('../commands/register-commands.js', () => ({ registerAllCommands }));
    await jest.unstable_mockModule('../services/nominations/db.js', () => ({
      ensureNominationsSchema,
      isDatabaseConfigured,
      endDbPoolIfInitialized,
    }));
    await jest.unstable_mockModule('../interactions/interactionRouter.js', () => ({
      handleInteraction: jest.fn(async () => undefined),
      attemptFallbackReply: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../jobs/discord/purge-member.job.js', () => ({
      schedulePurgeJobs,
    }));
    await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
      scheduleNominationDigests: jest.fn(() => new Map()),
      rescheduleGuildDigest: jest.fn(),
    }));
    await jest.unstable_mockModule('../jobs/discord/manufacturing-keepalive.job.js', () => ({
      scheduleManufacturingKeepalives: jest.fn(() => new Map()),
      rescheduleGuildKeepalive: jest.fn(),
    }));
    await jest.unstable_mockModule('../services/role.services.js', () => ({ addMissingDefaultRoles }));
    await jest.unstable_mockModule('../config/nomination-digest.config.js', () => ({
      isNominationDigestEnabled: () => false,
    }));
    await jest.unstable_mockModule('../services/nominations/job-worker.service.js', () => ({
      startNominationCheckWorkerLoop,
    }));
    await jest.unstable_mockModule('../utils/startup-banner.js', () => ({
      buildStartupBanner: jest.fn(() => '[startup banner]'),
    }));
    await jest.unstable_mockModule('../utils/permission-check.js', () => ({
      checkBotPermissions: jest.fn(() => []),
      notifyOwnerOfMissingPermissions: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../utils/logger.js', () => ({ getLogger: () => logger }));
    await jest.unstable_mockModule('../utils/diagnostics.js', () => ({
      startEventLoopMonitor: jest.fn(() => {
        const handle = setInterval(() => undefined, 99999);
        handle.unref();
        return handle;
      }),
      subscribeRestEvents: jest.fn(),
      subscribeUndiciDiagnostics: jest.fn(),
    }));
    await jest.unstable_mockModule('../domain/manufacturing/manufacturing.forum.js', () => ({
      ensureForumTags: jest.fn(async () => new Map()),
      formatOrderPost: jest.fn(() => ''),
      buildForumPostComponents: jest.fn(() => []),
      ORDER_STATUS_TAG_NAMES: [],
      MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
      MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
      MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.seeder.js', () => ({
      seedGuildConfigFromEnv: jest.fn(async () => undefined),
      seedGuildConfigsFromEnv: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
      ensureGuildConfigsSchema: jest.fn(async () => undefined),
      getGuildConfigOrNull: jest.fn(async () => null),
      getAllGuildConfigs: jest.fn(async () => []),
    }));
    await jest.unstable_mockModule('discord.js', () => {
      class MockClient {
        guilds = { cache: new Map() };
        user = { tag: 'station-bot#0001' };
        once(event: string, callback: () => Promise<void>) {
          if (event === 'clientReady') { readyHandler = callback; }
        }
        on() { return undefined; }
        destroy = destroySpy;
        login() { return Promise.resolve('ok'); }
      }
      class MockForumChannel {}
      return {
        Client: MockClient,
        IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
        MessageFlags: { Ephemeral: 64 },
        ChannelType: { GuildForum: 15 },
        ForumChannel: MockForumChannel,
      };
    });

    process.env.BOT_READ_ONLY_MODE = 'false';
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';
    process.env.NOMINATION_WORKER_ENABLED = 'true';

    await import('../index.js');
    await readyHandler!();

    process.emit('SIGTERM');

    expect(process.exitCode).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledWith(fakeInterval);
    expect(purgeStopSpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(endDbPoolIfInitialized).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    process.emit('SIGINT');
    expect(destroySpy).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
    exitSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    delete process.env.NOMINATION_WORKER_ENABLED;
  });

  it('logs the startup banner via logger.info after "Startup tasks completed."', async () => {
    const { buildStartupBanner, logger } = await loadIndexAndRunReady('false');

    expect(buildStartupBanner).toHaveBeenCalledTimes(1);

    const infoCalls = (logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    const startupTasksIdx = infoCalls.indexOf('Startup tasks completed.');
    const bannerIdx = infoCalls.indexOf('[startup banner]');

    expect(startupTasksIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeGreaterThan(startupTasksIdx);
  });
});
