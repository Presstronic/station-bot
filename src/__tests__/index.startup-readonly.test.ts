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

  const registerNominationCommands = jest.fn(async () => ({ passed: [], failed: [] }));
  const addMissingDefaultRoles = jest.fn(async () => undefined);
  const scheduleTemporaryMemberCleanup = jest.fn();
  const schedulePotentialApplicantCleanup = jest.fn();
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let readyHandler: (() => Promise<void>) | undefined;

  await jest.unstable_mockModule('../bootstrap.ts', () => ({}));
  await jest.unstable_mockModule('../commands/register-nomination-commands.ts', () => ({
    registerNominationCommands,
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
    registerNominationCommands,
    addMissingDefaultRoles,
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
  };
}

describe('startup wiring with read-only mode', () => {
  it('skips startup side effects when BOT_READ_ONLY_MODE=true', async () => {
    const {
      registerNominationCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    } = await loadIndexAndRunReady('true');

    expect(registerNominationCommands).toHaveBeenCalledTimes(1);
    expect(registerNominationCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).not.toHaveBeenCalled();
    expect(scheduleTemporaryMemberCleanup).not.toHaveBeenCalled();
    expect(schedulePotentialApplicantCleanup).not.toHaveBeenCalled();
  });

  it('runs startup side effects when BOT_READ_ONLY_MODE=false', async () => {
    const {
      registerNominationCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    } = await loadIndexAndRunReady('false');

    expect(registerNominationCommands).toHaveBeenCalledTimes(1);
    expect(registerNominationCommands).toHaveBeenCalledWith();
    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(scheduleTemporaryMemberCleanup).toHaveBeenCalledTimes(1);
    expect(schedulePotentialApplicantCleanup).toHaveBeenCalledTimes(1);
  });
});
