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

function mockRouterOnlyDependencies() {
  jest.unstable_mockModule('../../commands/order-submit.command.js', () => ({
    handleOrderCommand: jest.fn(),
    handleOrderItemModal: jest.fn(),
    handleOrderButtonInteraction: jest.fn(),
    triggerOrderModal: jest.fn(),
    ORDER_COMMAND_NAME: 'order',
    ITEM_MODAL_PREFIX: 'item-modal',
    ADD_ITEM_BUTTON_PREFIX: 'add-item',
    SUBMIT_ORDER_BUTTON_PREFIX: 'submit-order',
  }));
  jest.unstable_mockModule('../../commands/manufacturing-setup.command.js', () => ({
    handleManufacturingSetupCommand: jest.fn(),
    MANUFACTURING_SETUP_COMMAND_NAME: 'manufacturing-setup',
  }));
  jest.unstable_mockModule('../../commands/order-actions.command.js', () => ({
    handleMfgCancelOrder: jest.fn(),
    handleMfgStaffCancel: jest.fn(),
    handleMfgAdvance: jest.fn(),
  }));
  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.forum.js', () => ({
    MFG_CREATE_ORDER_PREFIX: 'mfg-create-order',
    MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
    MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
    MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    MFG_START_PROCESSING_PREFIX: 'mfg-start-processing',
    MFG_READY_FOR_PICKUP_PREFIX: 'mfg-ready-for-pickup',
    MFG_MARK_COMPLETE_PREFIX: 'mfg-mark-complete',
  }));
  jest.unstable_mockModule('../verifyButton.js', () => ({
    handleVerifyButtonInteraction: jest.fn(),
  }));
  jest.unstable_mockModule('../../utils/request-context.js', () => ({
    runWithCorrelationId: jest.fn(async (_correlationId: string, fn: () => Promise<unknown>) => await fn()),
  }));
}

describe('handleInteraction in read-only mode', () => {
  it('returns maintenance message for slash commands and does not execute command flow', async () => {
    const handleHealthcheckCommand = jest.fn();
    mockRouterOnlyDependencies();
    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand,
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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
    mockRouterOnlyDependencies();
    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand,
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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
    mockRouterOnlyDependencies();

    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand,
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand,
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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

  it('allows /healthcheck in read-only mode', async () => {
    const handleVerifyCommand = jest.fn();
    const handleHealthcheckCommand = jest.fn(async () => undefined);
    mockRouterOnlyDependencies();

    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand,
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand,
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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

describe('handleInteraction error handling', () => {
  it('resolves without rethrowing when deferReply throws a ConnectTimeoutError (transport failure), no fallback reply', async () => {
    // Models the real failure mode: the Discord REST API is unreachable and
    // deferReply itself rejects with a ConnectTimeoutError from undici.
    // No fallback reply should be attempted — Discord is unreachable.
    const networkError = Object.assign(new Error('Connect Timeout Error'), { name: 'ConnectTimeoutError' });
    const warnSpy = jest.fn();
    const errorSpy = jest.fn();
    mockRouterOnlyDependencies();

    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nominate-player.command.js', () => ({
      NOMINATE_PLAYER_COMMAND_NAME: 'nominate-player',
      // Handler calls deferReply and does not catch it — error propagates to router.
      handleNominatePlayerCommand: jest.fn(async (interaction: any) => {
        await interaction.deferReply({ flags: 64 }); // MessageFlags.Ephemeral
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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
    const replySpy = jest.fn(async () => undefined);
    const interaction = {
      id: 'cid-net',
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'nominate-player',
      replied: false,
      deferred: false,
      locale: 'en',
      isRepliable: () => true,
      reply: replySpy,
      deferReply: jest.fn(async () => { throw networkError; }),
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[cid:cid-net]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connectivity error'));
    expect(errorSpy).not.toHaveBeenCalled();
    // Transport path must not attempt a fallback reply — Discord is unreachable.
    expect(replySpy).not.toHaveBeenCalled();
  });

  it('resolves without rethrowing when a handler throws a genuine bug (TypeError), logs at error and sends fallback reply', async () => {
    // A real code bug must be classified at ERROR (not downgraded to WARN) and
    // a fallback reply must be sent so the user is not left without a response.
    const handlerBug = new TypeError('Cannot read properties of undefined');
    const warnSpy = jest.fn();
    const errorSpy = jest.fn();
    mockRouterOnlyDependencies();

    jest.unstable_mockModule('../../commands/verify.command.js', () => ({
      VERIFY_COMMAND_NAME: 'verify',
      handleVerifyCommand: jest.fn(),
      getUserVerificationData: jest.fn(),
      clearUserVerificationData: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/healthcheck.command.js', () => ({
      HEALTHCHECK_COMMAND_NAME: 'healthcheck',
      handleHealthcheckCommand: jest.fn(),
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
    jest.unstable_mockModule('../../commands/my-nominations.command.js', () => ({
      MY_NOMINATIONS_COMMAND_NAME: 'my-nominations',
      handleMyNominationsCommand: jest.fn(),
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
    const replySpy = jest.fn(async () => undefined);
    const interaction = {
      id: 'cid-bug',
      isChatInputCommand: () => true,
      isButton: () => false,
      commandName: 'nominate-player',
      replied: false,
      deferred: false,
      locale: 'en',
      isRepliable: () => true,
      reply: replySpy,
    } as any;

    await expect(handleInteraction(interaction, {} as any)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[cid:cid-bug]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot read properties of undefined'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('connectivity error'));
    // Fallback reply must be sent so the user receives a response.
    expect(replySpy).toHaveBeenCalledWith(expect.objectContaining({
      content: 'An unexpected error occurred while processing your request.',
    }));
  });
});
