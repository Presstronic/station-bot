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
    jest.unstable_mockModule('../../commands/review-nominations.command.js', () => ({
      REVIEW_NOMINATIONS_COMMAND_NAME: 'review-nominations',
      handleReviewNominationsCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/refresh-nomination-org-status.command.js', () => ({
      REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME: 'refresh-nomination-org-status',
      handleRefreshNominationOrgStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-check-status.command.js', () => ({
      NOMINATION_CHECK_STATUS_COMMAND_NAME: 'nomination-check-status',
      handleNominationCheckStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/process-nomination.command.js', () => ({
      PROCESS_NOMINATION_COMMAND_NAME: 'process-nomination',
      handleProcessNominationCommand: jest.fn(),
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
        ephemeral: true,
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
    jest.unstable_mockModule('../../commands/review-nominations.command.js', () => ({
      REVIEW_NOMINATIONS_COMMAND_NAME: 'review-nominations',
      handleReviewNominationsCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/refresh-nomination-org-status.command.js', () => ({
      REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME: 'refresh-nomination-org-status',
      handleRefreshNominationOrgStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-check-status.command.js', () => ({
      NOMINATION_CHECK_STATUS_COMMAND_NAME: 'nomination-check-status',
      handleNominationCheckStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/process-nomination.command.js', () => ({
      PROCESS_NOMINATION_COMMAND_NAME: 'process-nomination',
      handleProcessNominationCommand: jest.fn(),
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
        ephemeral: true,
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
    jest.unstable_mockModule('../../commands/review-nominations.command.js', () => ({
      REVIEW_NOMINATIONS_COMMAND_NAME: 'review-nominations',
      handleReviewNominationsCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/refresh-nomination-org-status.command.js', () => ({
      REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME: 'refresh-nomination-org-status',
      handleRefreshNominationOrgStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-check-status.command.js', () => ({
      NOMINATION_CHECK_STATUS_COMMAND_NAME: 'nomination-check-status',
      handleNominationCheckStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/process-nomination.command.js', () => ({
      PROCESS_NOMINATION_COMMAND_NAME: 'process-nomination',
      handleProcessNominationCommand: jest.fn(),
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
    jest.unstable_mockModule('../../commands/review-nominations.command.js', () => ({
      REVIEW_NOMINATIONS_COMMAND_NAME: 'review-nominations',
      handleReviewNominationsCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/refresh-nomination-org-status.command.js', () => ({
      REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME: 'refresh-nomination-org-status',
      handleRefreshNominationOrgStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/nomination-check-status.command.js', () => ({
      NOMINATION_CHECK_STATUS_COMMAND_NAME: 'nomination-check-status',
      handleNominationCheckStatusCommand: jest.fn(),
    }));
    jest.unstable_mockModule('../../commands/process-nomination.command.js', () => ({
      PROCESS_NOMINATION_COMMAND_NAME: 'process-nomination',
      handleProcessNominationCommand: jest.fn(),
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
