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
  rateLimitPerMinute = 1,
  rateLimitPerHour = 10,
  i18nMock,
}: {
  verificationEnabled?: boolean;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
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
    verifyRateLimitPerMinute: jest.fn(() => rateLimitPerMinute),
    verifyRateLimitPerHour: jest.fn(() => rateLimitPerHour),
    rsiHttpTimeoutMs: jest.fn(() => 12_000),
  }));

  const effectiveI18n = i18nMock ?? makeDefaultI18n();
  jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
    default: {
      __: effectiveI18n,
      __mf: jest.fn(
        (_opts: unknown, vars: Record<string, string>) =>
          `${vars.user ?? ''} code:${vars.code ?? ''} seconds:${vars.seconds ?? ''} minutes:${vars.minutes ?? ''} ${vars.verifyButtonLabel ?? ''}`.trim()
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

describe('handleVerifyCommand — rate limiting', () => {
  it('first invocation within a fresh window passes through', async () => {
    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 10 });
    const interaction = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction);

    const call = ((interaction.reply as jest.Mock).mock.calls[0] as [{ content?: string; components?: unknown[]; flags?: number }])[0];
    expect(call.components).toBeDefined();
    expect(call.content).toContain('TEST-CODE-123');
  });

  it('second invocation within 60 seconds is rejected with per-minute message and remaining seconds', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    nowSpy.mockReturnValueOnce(base).mockReturnValueOnce(base + 30_000);

    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 10 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne')); // first: passes
    const interaction2 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction2); // second: blocked

    const call = ((interaction2.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    expect(call.content).toContain('seconds:30');
    nowSpy.mockRestore();
  });

  it('invocation after the hourly cap is reached is rejected with the hourly message and remaining minutes', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    // Three calls spaced 90 s apart (past per-minute window, within per-hour window)
    nowSpy
      .mockReturnValueOnce(base)
      .mockReturnValueOnce(base + 90_000)
      .mockReturnValueOnce(base + 180_000)
      .mockReturnValueOnce(base + 270_000); // 4th call — should be blocked

    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 3 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    const interaction4 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction4); // 4th: blocked by hourly cap

    const call = ((interaction4.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    // oldestTimestamp=base, reset at base+3600000, now=base+270000 → 56 minutes remaining
    expect(call.content).toContain('minutes:56');
    nowSpy.mockRestore();
  });

  it('per-minute cap=2: first two calls pass; third within 60 s is blocked with correct seconds', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    nowSpy
      .mockReturnValueOnce(base)             // call 1 passes
      .mockReturnValueOnce(base + 10_000)    // call 2 passes
      .mockReturnValueOnce(base + 20_000);   // call 3 blocked

    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 2, rateLimitPerHour: 10 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    const interaction3 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction3);

    const call = ((interaction3.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    // limitingTimestamp = recentTimestamps[2-2=0] = base; reset at base+60000; now=base+20000 → 40 s
    expect(call.content).toContain('seconds:40');
    nowSpy.mockRestore();
  });

  it('hourly cap=2: first two calls pass; third within the hour is blocked with correct minutes', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    // Calls spaced 90 s apart so each clears the per-minute window
    nowSpy
      .mockReturnValueOnce(base)
      .mockReturnValueOnce(base + 90_000)
      .mockReturnValueOnce(base + 180_000); // blocked by hourly cap

    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 2 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    await handleVerifyCommand(makeVerifyInteraction('PilotOne'));
    const interaction3 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction3);

    const call = ((interaction3.reply as jest.Mock).mock.calls[0] as [{ content: string; flags: number }])[0];
    expect(call.flags).toBe(MessageFlags.Ephemeral);
    // limitingTimestamp = timestamps[2-2=0] = base; reset at base+3600000; now=base+180000 → 57 min
    expect(call.content).toContain('minutes:57');
    nowSpy.mockRestore();
  });

  it('timestamps older than 60 minutes are pruned and the invocation proceeds', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    nowSpy
      .mockReturnValueOnce(base)               // call 1: pushes base
      .mockReturnValueOnce(base + 3_601_000);  // call 2: base is >60 min old, pruned

    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 1 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne')); // fills the hourly slot
    const interaction2 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction2); // old entry pruned → passes

    const call = ((interaction2.reply as jest.Mock).mock.calls[0] as [{ content?: string; components?: unknown[] }])[0];
    expect(call.components).toBeDefined(); // proceeded to verification, not rate-limited
    nowSpy.mockRestore();
  });

  it('periodic sweep removes entries whose newest timestamp is older than 60 minutes', async () => {
    jest.useFakeTimers();
    const base = 1_700_000_000_000;
    jest.setSystemTime(base);

    // rateLimitPerHour:1 so that the first call fills the hourly window
    const handleVerifyCommand = await loadHandleVerifyCommand({ rateLimitPerMinute: 1, rateLimitPerHour: 1 });
    await handleVerifyCommand(makeVerifyInteraction('PilotOne')); // stores timestamp at base

    // Advance time by just over 60 minutes — triggers the sweep interval
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    // Date.now() is now base + 3_600_001; the stored entry (base) is stale → swept

    const interaction2 = makeVerifyInteraction('PilotOne');
    await handleVerifyCommand(interaction2); // map was cleared → should proceed

    const call = ((interaction2.reply as jest.Mock).mock.calls[0] as [{ content?: string; components?: unknown[] }])[0];
    expect(call.components).toBeDefined(); // verification proceeded, not rate-limited

    jest.useRealTimers();
  });
});
