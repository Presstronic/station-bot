import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalReadOnlyMode = process.env.BOT_READ_ONLY_MODE;

beforeEach(() => {
  jest.resetModules();
  process.env.BOT_READ_ONLY_MODE = 'true';
});

afterEach(() => {
  if (originalReadOnlyMode === undefined) {
    delete process.env.BOT_READ_ONLY_MODE;
  } else {
    process.env.BOT_READ_ONLY_MODE = originalReadOnlyMode;
  }
});

describe('handleInteraction in read-only mode', () => {
  it('returns maintenance message for slash commands and does not execute command flow', async () => {
    jest.unstable_mockModule('../../commands/verify.ts', () => ({
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.ts', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.ts', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.ts', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.ts', () => ({
      default: { __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../verifyButton.ts');
    const reply = jest.fn(async () => undefined);

    const interaction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'verify',
      replied: false,
      deferred: false,
      reply,
      // Intentionally omitted full command interaction shape.
      // If command flow executes, this test should throw.
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
      })
    );
  });

  it('returns maintenance message for button interactions and does not execute verify side effects', async () => {
    jest.unstable_mockModule('../../commands/verify.ts', () => ({
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.ts', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.ts', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.ts', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.ts', () => ({
      default: { __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../verifyButton.ts');
    const reply = jest.fn(async () => undefined);

    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      replied: false,
      deferred: false,
      reply,
      // Intentionally omitted button interaction shape.
      // If button flow executes, this test should throw.
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
      })
    );
  });
});
