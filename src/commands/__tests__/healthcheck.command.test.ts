import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalReadOnlyMode = process.env.BOT_READ_ONLY_MODE;

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  if (originalReadOnlyMode === undefined) {
    delete process.env.BOT_READ_ONLY_MODE;
  } else {
    process.env.BOT_READ_ONLY_MODE = originalReadOnlyMode;
  }
});

describe('healthcheck command', () => {
  it('registers healthcheck in the active command list', async () => {
    process.env.BOT_READ_ONLY_MODE = 'false';

    jest.unstable_mockModule('../../utils/discord-rest-client.js', () => ({
      discordRestClient: { put: jest.fn() },
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));

    const { getRegisteredCommandNames } = await import('../verify.js');

    expect(getRegisteredCommandNames()).toEqual(expect.arrayContaining(['verify', 'healthcheck']));
  });

  it('rejects non-admin users', async () => {
    jest.unstable_mockModule('../../utils/discord-rest-client.js', () => ({
      discordRestClient: { put: jest.fn() },
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));

    const { handleHealthcheckCommand } = await import('../verify.js');
    const reply = jest.fn(async () => undefined);

    const interaction = {
      locale: 'en-US',
      inGuild: () => true,
      memberPermissions: { has: () => false },
      reply,
      client: { user: { tag: 'station-bot#0001' } },
    } as any;

    await expect(handleHealthcheckCommand(interaction)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Only server administrators'),
        flags: 64,
      })
    );
  });

  it('returns status payload for admin users', async () => {
    process.env.BOT_READ_ONLY_MODE = 'true';

    jest.unstable_mockModule('../../utils/discord-rest-client.js', () => ({
      discordRestClient: { put: jest.fn() },
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));

    const { handleHealthcheckCommand } = await import('../verify.js');
    const reply = jest.fn(async () => undefined);

    const interaction = {
      locale: 'en-US',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      reply,
      client: { user: { tag: 'station-bot#0001' } },
    } as any;

    await expect(handleHealthcheckCommand(interaction)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('station-bot#0001'),
        flags: 64,
      })
    );
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/healthcheck'),
      })
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/verify'),
      })
    );
    const content = ((reply.mock.calls[0] as unknown) as [{ content: string }])[0].content;
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(content).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
  });

  it('rejects usage outside guilds', async () => {
    jest.unstable_mockModule('../../utils/discord-rest-client.js', () => ({
      discordRestClient: { put: jest.fn() },
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));

    const { handleHealthcheckCommand } = await import('../verify.js');
    const reply = jest.fn(async () => undefined);

    const interaction = {
      locale: 'en-US',
      inGuild: () => false,
      memberPermissions: { has: () => true },
      reply,
      client: { user: { tag: 'station-bot#0001' } },
    } as any;

    await expect(handleHealthcheckCommand(interaction)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('only be used in a server'),
        flags: 64,
      })
    );
  });
});
