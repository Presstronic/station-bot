import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-token' };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function loadIndexAndRunReady(readOnlyMode: 'true' | 'false') {
  process.env.BOT_READ_ONLY_MODE = readOnlyMode;

  const registerCommands = jest.fn(async () => undefined);
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
  await jest.unstable_mockModule('../commands/verify.ts', () => ({
    registerCommands,
  }));
  await jest.unstable_mockModule('../interactions/verifyButton.ts', () => ({
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
    registerCommands,
    addMissingDefaultRoles,
    scheduleTemporaryMemberCleanup,
    schedulePotentialApplicantCleanup,
  };
}

describe('startup wiring with read-only mode', () => {
  it('skips startup side effects when BOT_READ_ONLY_MODE=true', async () => {
    const {
      registerCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    } = await loadIndexAndRunReady('true');

    expect(registerCommands).toHaveBeenCalledTimes(1);
    expect(registerCommands).toHaveBeenCalledWith(true);
    expect(addMissingDefaultRoles).not.toHaveBeenCalled();
    expect(scheduleTemporaryMemberCleanup).not.toHaveBeenCalled();
    expect(schedulePotentialApplicantCleanup).not.toHaveBeenCalled();
  });

  it('runs startup side effects when BOT_READ_ONLY_MODE=false', async () => {
    const {
      registerCommands,
      addMissingDefaultRoles,
      scheduleTemporaryMemberCleanup,
      schedulePotentialApplicantCleanup,
    } = await loadIndexAndRunReady('false');

    expect(registerCommands).toHaveBeenCalledTimes(1);
    expect(registerCommands).toHaveBeenCalledWith(false);
    expect(addMissingDefaultRoles).toHaveBeenCalledTimes(2);
    expect(scheduleTemporaryMemberCleanup).toHaveBeenCalledTimes(1);
    expect(schedulePotentialApplicantCleanup).toHaveBeenCalledTimes(1);
  });
});
