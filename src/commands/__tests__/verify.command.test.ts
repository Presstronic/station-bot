import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MessageFlags } from 'discord.js';

beforeEach(() => {
  jest.resetModules();
});

// Default i18n stub — returns real-ish strings so handle-validation tests pass without
// mocking i18n themselves. Always registered so unstable_mockModule doesn't bleed between tests.
function makeDefaultI18n() {
  const phrases: Record<string, string> = {
    'commands.verify.description': 'Verify your account with your in-game name.',
    'commands.verify.options.inGameName.name': 'in-game-name',
    'commands.verify.options.inGameName.description': 'Enter your in-game name.',
    'commands.verify.buttonLabel': 'Verify',
    'commands.verify.responses.invalidHandle':
      '❌ Please enter your RSI handle only (e.g. Testhandle123), not a full URL.',
    'commands.verify.responses.disabled': '❌ Verification is not available on this server.',
    'commands.healthcheck.description': 'Check bot runtime status.',
  };
  return jest.fn(({ phrase }: { phrase: string }) => phrases[phrase] ?? phrase);
}

async function loadHandleVerifyCommand({
  verificationEnabled = true,
  i18nMock,
}: {
  verificationEnabled?: boolean;
  i18nMock?: ReturnType<typeof jest.fn>;
} = {}) {
  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }));
  jest.unstable_mockModule('../../utils/discord-rest-client.js', () => ({
    discordRestClient: { put: jest.fn() },
  }));
  jest.unstable_mockModule('../../services/verification-code.services.js', () => ({
    generateDrdntVerificationCode: jest.fn(() => 'TEST-CODE-123'),
  }));
  jest.unstable_mockModule('../../config/runtime-flags.js', () => ({
    isVerificationEnabled: jest.fn(() => verificationEnabled),
    isReadOnlyMode: jest.fn(() => false),
    isPurgeJobsEnabled: jest.fn(() => false),
    isManufacturingEnabled: jest.fn(() => false),
    rsiHttpTimeoutMs: jest.fn(() => 12_000),
  }));

  const effectiveI18n = i18nMock ?? makeDefaultI18n();
  jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
    default: {
      __: effectiveI18n,
      __mf: jest.fn(
        (_opts: unknown, vars: Record<string, string>) =>
          `${vars.user ?? ''} code:${vars.code ?? ''} ${vars.verifyButtonLabel ?? ''}`.trim()
      ),
    },
  }));

  const { handleVerifyCommand } = await import('../verify.js');
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

describe('handleVerifyCommand — verification disabled', () => {
  it('replies ephemerally with the i18n disabled message when verification is off', async () => {
    const i18nMock = jest.fn(({ phrase }: { phrase: string }) => {
      if (phrase === 'commands.verify.responses.disabled') return 'DISABLED_MESSAGE';
      if (phrase === 'commands.verify.options.inGameName.name') return 'in-game-name';
      return 'test-value';
    });
    const handleVerifyCommand = await loadHandleVerifyCommand({ verificationEnabled: false, i18nMock });
    const interaction = makeVerifyInteraction('Testhandle123');
    await handleVerifyCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(i18nMock).toHaveBeenCalledWith({ phrase: 'commands.verify.responses.disabled', locale: 'en' });
    expect(call.content).toBe('DISABLED_MESSAGE');
  });
});

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

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects input containing a slash', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('citizens/Testhandle123');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects an empty / too-short input', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('ab');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(call.content).toContain('RSI handle only');
  });

  it('rejects a handle that is too long', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand();
    const interaction = makeVerifyInteraction('a'.repeat(61));
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(call.content).toContain('RSI handle only');
  });
});
