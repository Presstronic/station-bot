import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

async function loadHandleVerifyCommand() {
  jest.unstable_mockModule('../../utils/logger.ts', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }));
  jest.unstable_mockModule('../../utils/discord-rest-client.ts', () => ({
    discordRestClient: { put: jest.fn() },
  }));
  jest.unstable_mockModule('../../services/verification-code.services.ts', () => ({
    generateDrdntVerificationCode: jest.fn(() => 'TEST-CODE-123'),
  }));

  const { handleVerifyCommand } = await import('../verify.ts');
  return handleVerifyCommand;
}

function makeVerifyInteraction(inGameName: string) {
  const reply = jest.fn(async () => undefined);
  return {
    guild: { preferredLocale: 'en', name: 'Test Guild' },
    locale: 'en',
    user: { id: 'user-1', tag: 'User#0001', toString: () => '<@user-1>' },
    options: {
      getString: jest.fn(() => inGameName),
    },
    reply,
  } as unknown as import('discord.js').ChatInputCommandInteraction;
}

describe('handleVerifyCommand — handle validation', () => {
  it('accepts a valid plain handle and proceeds to verification', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('Testhandle123');
    await handleVerifyCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content?: string; components?: unknown[] }])[0];
    // Should show the verification code message, not an error
    expect(call.components).toBeDefined();
    expect(call.content).toContain('TEST-CODE-123');
  });

  it('rejects a full RSI URL input', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('https://robertsspaceindustries.com/citizens/Testhandle123');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; ephemeral: boolean }])[0];
    expect(call.ephemeral).toBe(true);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects input containing a slash', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('citizens/Testhandle123');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; ephemeral: boolean }])[0];
    expect(call.ephemeral).toBe(true);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects an empty / too-short input', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('ab');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; ephemeral: boolean }])[0];
    expect(call.ephemeral).toBe(true);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects a handle that is too long', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('a'.repeat(61));
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; ephemeral: boolean }])[0];
    expect(call.ephemeral).toBe(true);
    expect(call.content).toContain('RSI handle only');
  });
});
