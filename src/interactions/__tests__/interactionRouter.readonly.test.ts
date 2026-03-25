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
    const handleHealthcheckCommand = jest.fn();
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand: jest.fn(),
      handleHealthcheckCommand,
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      handleNominatePlayerCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');
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
        flags: 64, // MessageFlags.Ephemeral
      })
    );
  });

  it('returns maintenance message for button interactions and does not execute verify side effects', async () => {
    const handleHealthcheckCommand = jest.fn();
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand: jest.fn(),
      handleHealthcheckCommand,
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      handleNominatePlayerCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');
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
        flags: 64, // MessageFlags.Ephemeral
      })
    );
  });

  it('evaluates read-only mode at interaction time (not only at module import)', async () => {
    const handleVerifyCommand = jest.fn(async () => undefined);
    const handleHealthcheckCommand = jest.fn();

    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand,
      handleHealthcheckCommand,
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      handleNominatePlayerCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');

    process.env.BOT_READ_ONLY_MODE = 'false';
    const reply = jest.fn(async () => undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'verify',
      replied: false,
      deferred: false,
      reply,
      followUp: jest.fn(async () => undefined),
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    expect(handleVerifyCommand).toHaveBeenCalledTimes(1);
  });

  it('resolves without rethrowing when deferReply throws a ConnectTimeoutError (transport failure)', async () => {
    // Models the real failure mode: the Discord REST API is unreachable and
    // deferReply itself rejects with a ConnectTimeoutError from undici.
    const networkError = Object.assign(new Error('Connect Timeout Error'), { name: 'ConnectTimeoutError' });
    const warnSpy = jest.fn();
    const errorSpy = jest.fn();

    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand: jest.fn(),
      handleHealthcheckCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      // Handler calls deferReply and does not catch it — error propagates to router.
      handleNominatePlayerCommand: jest.fn(async (interaction: any) => {
        await interaction.deferReply({ ephemeral: true });
      }),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: warnSpy, error: errorSpy }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');
    process.env.BOT_READ_ONLY_MODE = 'false';
    const interaction = {
      id: 'cid-net',
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'nominate-player',
      replied: false,
      deferred: false,
      locale: 'en',
      deferReply: jest.fn(async () => { throw networkError; }),
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[cid:cid-net]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connectivity error'));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resolves without rethrowing when a handler throws a genuine bug (TypeError), logged at error', async () => {
    // A real code bug (not a transport failure) must be classified at ERROR with
    // a correlation ID — not silently downgraded to WARN.
    const handlerBug = new TypeError('Cannot read properties of undefined');
    const warnSpy = jest.fn();
    const errorSpy = jest.fn();

    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand: jest.fn(),
      handleHealthcheckCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      handleNominatePlayerCommand: jest.fn(async () => { throw handlerBug; }),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: warnSpy, error: errorSpy }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');
    process.env.BOT_READ_ONLY_MODE = 'false';
    const interaction = {
      id: 'cid-bug',
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'nominate-player',
      replied: false,
      deferred: false,
      locale: 'en',
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[cid:cid-bug]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot read properties of undefined'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('connectivity error'));
  });

  it('allows /healthcheck in read-only mode', async () => {
    const handleVerifyCommand = jest.fn();
    const handleHealthcheckCommand = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../commands/verify.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleVerifyCommand,
      handleHealthcheckCommand,
      getUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      handleNominatePlayerCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-review.command.js', () => ({
      NOMINATION_REVIEW_COMMAND_NAME: 'nomination-review',
      handleNominationReviewCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-refresh.command.js', () => ({
      NOMINATION_REFRESH_COMMAND_NAME: 'nomination-refresh',
      handleNominationRefreshCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-job-status.command.js', () => ({
      NOMINATION_JOB_STATUS_COMMAND_NAME: 'nomination-job-status',
      handleNominationJobStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-process.command.js', () => ({
      NOMINATION_PROCESS_COMMAND_NAME: 'nomination-process',
      handleNominationProcessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-access.command.js', () => ({
      NOMINATION_ACCESS_COMMAND_NAME: 'nomination-access',
      handleNominationAccessCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-audit.command.js', () => ({
      NOMINATION_AUDIT_COMMAND_NAME: 'nomination-audit',
      handleNominationAuditCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }));
    jest.unstable_mockModule('../../services/role.services.js', () => ({
      assignVerifiedRole: jest.fn(),
      removeVerifiedRole: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/rsi.services.js', () => ({
      verifyRSIProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
      default: { __: jest.fn(() => 'maintenance'), __mf: jest.fn() },
    }));

    const { handleInteraction } = await import('../interactionRouter.js');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'healthcheck',
      replied: false,
      deferred: false,
      reply,
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    expect(handleVerifyCommand).not.toHaveBeenCalled();
    expect(handleHealthcheckCommand).toHaveBeenCalledTimes(1);
  });
});
