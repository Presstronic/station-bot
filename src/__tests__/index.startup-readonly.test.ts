import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-token' };
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function loadIndexAndRunReady(readOnlyMode: 'true' | 'false') {
  process.env.BOT_READ_ONLY_MODE = readOnlyMode;

  const registerAllCommands = jest.fn(async () => ({ passed: [], failed: [] }));
  const ensureNominationsSchema = jest.fn(async () => undefined);
  const isDatabaseConfigured = jest.fn(() => false);
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

  let readyHandler: (() => Promise<void>) | undefined;

  await jest.unstable_mockModule('../bootstrap.ts', () => ({}));
  await jest.unstable_mockModule('../commands/register-commands.ts', () => ({
    registerAllCommands,
  }));
  await jest.unstable_mockModule('../services/nominations/db.ts', () => ({
    ensureNominationsSchema,
    isDatabaseConfigured,
  }));
  await jest.unstable_mockModule('../interactions/interactionRouter.ts', () => ({
    handleInteraction: jest.fn(async () => undefined),
  }));
  await jest.unstable_mockModule('../jobs/discord/purge-member.job.ts', () => ({
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
  }));
  await jest.unstable_mockModule('../services/role.services.ts', () => ({
    addMissingDefaultRoles,
  }));
  await jest.unstable_mockModule('../services/nominations/job-worker.service.ts', () => ({
    startNominationCheckWorkerLoop,
  }));
  await jest.unstable_mockModule('../utils/logger.ts', () => ({
    getLogger: () => logger,
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
        if (event === 'ready') {
          readyHandler = callback;
        }
      }

      on() {
        return undefined;
      }

      login() {
        return Promise.resolve('ok');
      }
    }

    return {
      Client: MockClient,
      IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
    };
  });

  await import('../index.ts');
  expect(readyHandler).toBeDefined();
  await readyHandler!();

  return {
    registerAllCommands,
    ensureNominationsSchema,
    isDatabaseConfigured,
    addMissingDefaultRoles,
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
    startNominationCheckWorkerLoop,
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
    } = await loadIndexAndRunReady('false');

    expect(registerAllCommands).toHaveBeenCalledTimes(1);
    expect(registerAllCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(scheduleTemporaryMemberCleanup).toHaveBeenCalledTimes(1);
    expect(schedulePotentialApplicantCleanup).toHaveBeenCalledTimes(1);
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
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

    await jest.unstable_mockModule('../bootstrap.ts', () => ({}));
    await jest.unstable_mockModule('../commands/register-commands.ts', () => ({
      registerAllCommands,
    }));
    await jest.unstable_mockModule('../services/nominations/db.ts', () => ({
      ensureNominationsSchema,
      isDatabaseConfigured,
    }));
    await jest.unstable_mockModule('../interactions/interactionRouter.ts', () => ({
      handleInteraction: jest.fn(async () => undefined),
    }));
    await jest.unstable_mockModule('../jobs/discord/purge-member.job.ts', () => ({
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    }));
    await jest.unstable_mockModule('../services/role.services.ts', () => ({
      addMissingDefaultRoles,
    }));
    await jest.unstable_mockModule('../services/nominations/job-worker.service.ts', () => ({
      startNominationCheckWorkerLoop,
    }));
    await jest.unstable_mockModule('../utils/logger.ts', () => ({
      getLogger: () => logger,
    }));
    await jest.unstable_mockModule('discord.js', () => {
      class MockClient {
        guilds = { cache: new Map() };
        user = { tag: 'station-bot#0001' };
        once(event: string, callback: () => Promise<void>) {
          if (event === 'ready') {
            readyHandler = callback;
          }
        }
        on() {
          return undefined;
        }
        login() {
          return Promise.resolve('ok');
        }
      }
      return {
        Client: MockClient,
        IntentsBitField: { Flags: { Guilds: 1, GuildMembers: 2 } },
      };
    });

    await import('../index.ts');
    await readyHandler!();

    expect(ensureNominationsSchema).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(registerAllCommands).not.toHaveBeenCalled();
    expect(startNominationCheckWorkerLoop).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
