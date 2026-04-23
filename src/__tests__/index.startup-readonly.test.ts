import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

// Captured in beforeEach so afterEach can remove only the listeners added
// by the current test's index.js import, leaving any pre-existing Jest or
// Node signal handlers untouched.
let preTestSigtermListeners: Function[] = [];
let preTestSigintListeners: Function[] = [];

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-token' };
  delete process.env.DATABASE_URL;
  // Prevent environment-dependent flakiness: if the test runner has LOG_LEVEL=debug|trace,
  // subscribeRestEvents() will try client.rest.on(...) on MockClient which has no rest property.
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
    purgeJobsEnabled?: 'true' | 'false';
    nominationDigestEnabled?: 'true' | 'false';
    dbConfigured?: boolean;
    digestTaskCount?: number;
  } = {}
) {
  process.env.BOT_READ_ONLY_MODE = readOnlyMode;
  if (options.purgeJobsEnabled !== undefined) {
    process.env.PURGE_JOBS_ENABLED = options.purgeJobsEnabled;
  } else {
    delete process.env.PURGE_JOBS_ENABLED;
  }
  if (options.nominationDigestEnabled !== undefined) {
    process.env.NOMINATION_DIGEST_ENABLED = options.nominationDigestEnabled;
  } else {
    delete process.env.NOMINATION_DIGEST_ENABLED;
  }

  const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
  const ensureNominationsSchema = jest.fn(async () => undefined);
  const isDatabaseConfigured = jest.fn(() => options.dbConfigured ?? false);
  const addMissingDefaultRoles = jest.fn(async () => undefined);
  const scheduleTemporaryMemberCleanup = jest.fn(() => ({ stop: jest.fn() }));
  const schedulePotentialApplicantCleanup = jest.fn(() => ({ stop: jest.fn() }));
  const digestTaskCount = options.digestTaskCount ?? 0;
  const digestTasks = new Map(
    Array.from({ length: digestTaskCount }, (_, i) => [`guild-${i}`, { stop: jest.fn() }]),
  );
  const scheduleNominationDigests = jest.fn(() => digestTasks);
  const startNominationCheckWorkerLoop = jest.fn();
  const buildStartupBanner = jest.fn(() => '[startup banner]');
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
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
  }));
  await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
    scheduleNominationDigests,
    rescheduleGuildDigest: jest.fn(),
  }));
  await jest.unstable_mockModule('../services/role.services.js', () => ({
    addMissingDefaultRoles,
  }));
  await jest.unstable_mockModule('../config/nomination-digest.config.js', () => ({
    isNominationDigestEnabled: () => options.nominationDigestEnabled === 'true',
  }));
  await jest.unstable_mockModule('../services/nominations/job-worker.service.js', () => ({
    startNominationCheckWorkerLoop,
  }));
  await jest.unstable_mockModule('../utils/startup-banner.js', () => ({
    buildStartupBanner,
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
    seedGuildConfigsFromEnv: jest.fn(async () => undefined),
  }));
  await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull: jest.fn(async () => null),
    getAllGuildConfigs: jest.fn(async () => []),
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
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
    scheduleNominationDigests,
    startNominationCheckWorkerLoop,
    buildStartupBanner,
    logger,
  };
}

describe('startup wiring with read-only mode', () => {
  it('skips startup side effects when BOT_READ_ONLY_MODE=true', async () => {
    const {
      registerAllCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
      startNominationCheckWorkerLoop,
    } = await loadIndexAndRunReady('true');

    expect(registerAllCommands).toHaveBeenCalledTimes(1);
    expect(registerAllCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).not.toHaveBeenCalled();
    expect(scheduleTemporaryMemberCleanup).not.toHaveBeenCalled();
    expect(schedulePotentialApplicantCleanup).not.toHaveBeenCalled();
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
  });

  it('runs startup side effects when BOT_READ_ONLY_MODE=false', async () => {
    const {
      registerAllCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
      startNominationCheckWorkerLoop,
    } = await loadIndexAndRunReady('false', { purgeJobsEnabled: 'true' });

    expect(registerAllCommands).toHaveBeenCalledTimes(1);
    expect(registerAllCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(scheduleTemporaryMemberCleanup).toHaveBeenCalledTimes(1);
    expect(schedulePotentialApplicantCleanup).toHaveBeenCalledTimes(1);
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
  });

  it('schedules nomination digest jobs when enabled and the database is configured', async () => {
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const { scheduleNominationDigests, buildStartupBanner } = await loadIndexAndRunReady(
      'false',
      { purgeJobsEnabled: 'false', nominationDigestEnabled: 'true', dbConfigured: true, digestTaskCount: 1 },
    );

    expect(scheduleNominationDigests).toHaveBeenCalledTimes(1);
    expect(buildStartupBanner).toHaveBeenCalledWith(
      expect.objectContaining({ nominationDigestJobActive: true }),
    );
  });

  it('reports nominationDigestJobActive=false when scheduling returns an empty map', async () => {
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';

    const { scheduleNominationDigests, buildStartupBanner } = await loadIndexAndRunReady(
      'false',
      {
        purgeJobsEnabled: 'false',
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

  it('skips purge jobs when PURGE_JOBS_ENABLED=false even if not in read-only mode', async () => {
    const {
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    } = await loadIndexAndRunReady('false', { purgeJobsEnabled: 'false' });

    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(scheduleTemporaryMemberCleanup).not.toHaveBeenCalled();
    expect(schedulePotentialApplicantCleanup).not.toHaveBeenCalled();
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
    const scheduleTemporaryMemberCleanup = jest.fn();
    const schedulePotentialApplicantCleanup = jest.fn();
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
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    }));
    await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
      scheduleNominationDigests: jest.fn(() => new Map()),
      rescheduleGuildDigest: jest.fn(),
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
      seedGuildConfigsFromEnv: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
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
    const tempMemberStopSpy = jest.fn();
    const potentialApplicantStopSpy = jest.fn();
    const scheduleTemporaryMemberCleanup = jest.fn(() => ({ stop: tempMemberStopSpy }));
    const schedulePotentialApplicantCleanup = jest.fn(() => ({ stop: potentialApplicantStopSpy }));
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
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    }));
    await jest.unstable_mockModule('../jobs/discord/nomination-digest.job.js', () => ({
      scheduleNominationDigests: jest.fn(() => new Map()),
      rescheduleGuildDigest: jest.fn(),
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
      seedGuildConfigsFromEnv: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../domain/guild-config/guild-config.service.js', () => ({
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
    process.env.PURGE_JOBS_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgresql://station_bot:change_me@postgres:5432/station_bot';
    process.env.NOMINATION_WORKER_ENABLED = 'true';

    await import('../index.js');
    await readyHandler!();

    process.emit('SIGTERM');

    expect(process.exitCode).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledWith(fakeInterval);
    expect(tempMemberStopSpy).toHaveBeenCalledTimes(1);
    expect(potentialApplicantStopSpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(endDbPoolIfInitialized).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    // SIGINT arriving after SIGTERM must not re-invoke cleanup (idempotency guard)
    process.emit('SIGINT');
    expect(destroySpy).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
    exitSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    delete process.env.NOMINATION_WORKER_ENABLED;
    delete process.env.PURGE_JOBS_ENABLED;
  });

  it('logs the startup banner via logger.info after "Startup tasks completed."', async () => {
    const { buildStartupBanner, logger } = await loadIndexAndRunReady('false', { purgeJobsEnabled: 'true' });

    expect(buildStartupBanner).toHaveBeenCalledTimes(1);

    const infoCalls = (logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    const startupTasksIdx = infoCalls.indexOf('Startup tasks completed.');
    const bannerIdx = infoCalls.indexOf('[startup banner]');

    expect(startupTasksIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeGreaterThan(startupTasksIdx);
  });
});
