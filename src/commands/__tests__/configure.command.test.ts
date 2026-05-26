import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
});

function makeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
    verificationEnabled: true,
    verifiedRoleName: 'Verified',
    tempMemberRoleName: 'Temporary Member',
    potentialApplicantRoleName: 'Potential Applicant',
    orgMemberRoleId: null,
    orgMemberRoleName: null,
    nominationDigestEnabled: false,
    nominationDigestChannelId: null,
    nominationDigestRoleId: null,
    nominationDigestCronSchedule: '0 9 * * *',
    manufacturingEnabled: false,
    manufacturingForumChannelId: null,
    manufacturingStaffChannelId: null,
    manufacturingRoleId: null,
    manufacturingCreateOrderThreadId: null,
    manufacturingOrderLimit: 5,
    manufacturingMaxItemsPerOrder: 10,
    manufacturingOrderRateLimitPer5Min: 1,
    manufacturingOrderRateLimitPerHour: 5,
    manufacturingCreateOrderPostTitle: '📋 Create Order',
    manufacturingCreateOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: false,
    tempMemberHoursToExpire: 48,
    tempMemberPurgeCronSchedule: '0 3 * * *',
    birthdayEnabled: false,
    birthdayChannelId: null,
    birthdayCronSchedule: '0 12 * * *',
    eventRemindersEnabled: false,
    eventRemindersDefaultChannelId: null,
    eventRemindersCronSchedule: '*/15 * * * *',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type ConfigState = {
  verification: boolean;
  nominationDigest: boolean;
  manufacturing: boolean;
};

async function setup(configState: Partial<ConfigState> = {}) {
  const guildConfig = makeGuildConfig();
  const getGuildConfigOrNull = jest.fn(async () => guildConfig);
  const upsertGuildConfig = jest.fn(async (_guildId: string, patch: Record<string, unknown>) =>
    ({ ...guildConfig, ...patch, updatedAt: '2024-01-02T00:00:00.000Z' }),
  );
  const addMissingDefaultRoles = jest.fn(async () => undefined);
  const rescheduleGuildDigest = jest.fn();
  const rescheduleGuildKeepalive = jest.fn();
  const rescheduleGuildPurge = jest.fn();

  const flags: ConfigState = {
    verification: configState.verification ?? true,
    nominationDigest: configState.nominationDigest ?? true,
    manufacturing: configState.manufacturing ?? true,
  };

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }));

  jest.unstable_mockModule('../../config/runtime-flags.js', () => ({
    isVerificationEnabled: () => flags.verification,
    isReadOnlyMode: () => false,
  }));

  jest.unstable_mockModule('../../config/nomination-digest.config.js', () => ({
    isNominationDigestEnabled: () => flags.nominationDigest,
  }));

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    isManufacturingEnabled: () => flags.manufacturing,
  }));

  jest.unstable_mockModule('../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull,
    upsertGuildConfig,
  }));

  jest.unstable_mockModule('../../jobs/discord/nomination-digest.job.js', () => ({
    rescheduleGuildDigest,
  }));

  jest.unstable_mockModule('../../jobs/discord/manufacturing-keepalive.job.js', () => ({
    rescheduleGuildKeepalive,
  }));

  jest.unstable_mockModule('../../jobs/discord/purge-member.job.js', () => ({
    rescheduleGuildPurge,
  }));

  jest.unstable_mockModule('../../services/nominations/db.js', () => ({
    isDatabaseConfigured: () => true,
  }));

  jest.unstable_mockModule('../../services/role.services.js', () => ({
    addMissingDefaultRoles,
  }));

  const mod = await import('../configure.command.js');
  return {
    ...mod,
    guildConfig,
    mocks: {
      getGuildConfigOrNull,
      upsertGuildConfig,
      addMissingDefaultRoles,
      rescheduleGuildDigest,
      rescheduleGuildKeepalive,
      rescheduleGuildPurge,
    },
  };
}

async function setupWithGuildConfigFailure(configState: Partial<ConfigState> = {}) {
  const getGuildConfigOrNull = jest.fn(async () => {
    throw new Error('db unavailable');
  });
  const upsertGuildConfig = jest.fn();
  const addMissingDefaultRoles = jest.fn(async () => undefined);
  const rescheduleGuildDigest = jest.fn();
  const rescheduleGuildKeepalive = jest.fn();
  const rescheduleGuildPurge = jest.fn();

  const flags: ConfigState = {
    verification: configState.verification ?? true,
    nominationDigest: configState.nominationDigest ?? true,
    manufacturing: configState.manufacturing ?? true,
  };

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }));

  jest.unstable_mockModule('../../config/runtime-flags.js', () => ({
    isVerificationEnabled: () => flags.verification,
    isReadOnlyMode: () => false,
  }));

  jest.unstable_mockModule('../../config/nomination-digest.config.js', () => ({
    isNominationDigestEnabled: () => flags.nominationDigest,
  }));

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    isManufacturingEnabled: () => flags.manufacturing,
  }));

  jest.unstable_mockModule('../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull,
    upsertGuildConfig,
  }));

  jest.unstable_mockModule('../../jobs/discord/nomination-digest.job.js', () => ({
    rescheduleGuildDigest,
  }));

  jest.unstable_mockModule('../../jobs/discord/manufacturing-keepalive.job.js', () => ({
    rescheduleGuildKeepalive,
  }));

  jest.unstable_mockModule('../../jobs/discord/purge-member.job.js', () => ({
    rescheduleGuildPurge,
  }));

  jest.unstable_mockModule('../../services/nominations/db.js', () => ({
    isDatabaseConfigured: () => true,
  }));

  jest.unstable_mockModule('../../services/role.services.js', () => ({
    addMissingDefaultRoles,
  }));

  const mod = await import('../configure.command.js');
  return {
    ...mod,
    mocks: {
      getGuildConfigOrNull,
      upsertGuildConfig,
      addMissingDefaultRoles,
      rescheduleGuildDigest,
      rescheduleGuildKeepalive,
      rescheduleGuildPurge,
    },
  };
}

function makeSlashInteraction({
  id = 'slash-1',
  feature = null as string | null,
  inGuild = true,
  canManageGuild = true,
} = {}) {
  return {
    id,
    guildId: 'guild-1',
    locale: 'en-US',
    inGuild: () => inGuild,
    memberPermissions: { has: jest.fn(() => canManageGuild) },
    options: { getString: jest.fn(() => feature) },
    reply: jest.fn(async () => undefined),
    showModal: jest.fn(async () => undefined),
  };
}

function makeGuild(channelType = 0) {
  return {
    id: 'guild-1',
    roles: {
      fetch: jest.fn(async (roleId: string) => ({ id: roleId })),
    },
    channels: {
      fetch: jest.fn(async (channelId: string) => ({
        id: channelId,
        type: channelType,
        isTextBased: () => true,
        send: jest.fn(),
      })),
    },
  };
}

function makeModalInteraction(customId: string, values: Record<string, string>, guild = makeGuild()) {
  return {
    customId,
    guildId: 'guild-1',
    guild,
    client: { user: { username: 'station-bot' } },
    fields: {
      getTextInputValue: jest.fn((key: string) => values[key]),
    },
    deferReply: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
  };
}

function makeSelectInteraction(customId: string, value: string) {
  return {
    customId,
    guildId: 'guild-1',
    inGuild: () => true,
    memberPermissions: { has: jest.fn(() => true) },
    values: [value],
    update: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
    deferred: false,
    replied: false,
  };
}

function makeButtonInteraction(customId: string, guild = makeGuild(), canManageGuild = true) {
  return {
    customId,
    guildId: 'guild-1',
    guild,
    inGuild: () => true,
    memberPermissions: { has: jest.fn(() => canManageGuild) },
    client: {},
    deferUpdate: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
    showModal: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
    deferred: false,
    replied: false,
  };
}

let teardown: (() => void) | null = null;

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe('configure command', () => {
  it('rejects users without ManageGuild permission', async () => {
    const { handleConfigureCommand, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;
    const interaction = makeSlashInteraction({ canManageGuild: false });

    await handleConfigureCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/manage server/i),
      }),
    );
    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
  });

  it('returns a contact-operator message for disabled features', async () => {
    const { handleConfigureCommand, teardownConfigureCommandForTests } = await setup({ nominationDigest: false });
    teardown = teardownConfigureCommandForTests;
    const interaction = makeSlashInteraction({ feature: 'nomination-digest' });

    await handleConfigureCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/contact your operator/i),
      }),
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('rejects unsupported feature values before opening a configure session', async () => {
    const { handleConfigureCommand, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;
    const interaction = makeSlashInteraction({ feature: 'birthdays-later' });

    await handleConfigureCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/unsupported feature selected/i),
      }),
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
  });

  it('saves verification settings and ensures roles after modal submit', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-verify', feature: 'verification' });
    await handleConfigureCommand(slash as never);

    expect(slash.showModal).toHaveBeenCalledTimes(1);

    const modal = makeModalInteraction('cfg-modal:cfg-verify:verification:base', {
      'verified-role-name': 'Members',
      'temp-member-role-name': 'Temps',
      'potential-applicant-role-name': 'Applicants',
      'org-member-role-id': 'role-123',
    });

    await handleConfigureModalSubmit(modal as never);

    expect(mocks.upsertGuildConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      verifiedRoleName: 'Members',
      tempMemberRoleName: 'Temps',
      potentialApplicantRoleName: 'Applicants',
      orgMemberRoleId: 'role-123',
    }));
    expect(mocks.addMissingDefaultRoles).toHaveBeenCalled();
    expect(modal.deferReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.any(Number),
      }),
    );
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/verification saved/i),
      }),
    );
  });

  it('prefills the verification modal from the persisted guild config snapshot', async () => {
    const { handleConfigureCommand, teardownConfigureCommandForTests, guildConfig } = await setup();
    teardown = teardownConfigureCommandForTests;
    guildConfig.verifiedRoleName = 'Existing Verified';

    const interaction = makeSlashInteraction({ id: 'cfg-verify-prefill', feature: 'verification' });
    await handleConfigureCommand(interaction as never);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls.at(0)?.[0] as
      | { toJSON: () => { components: Array<{ components: Array<{ value: string }> }> } }
      | undefined;
    expect(modal).toBeDefined();
    const modalJson = modal!.toJSON();
    expect(modalJson.components[0].components[0].value).toBe('Existing Verified');
  });

  it('persists nomination digest settings after schedule selection', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, handleConfigureButtonInteraction, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-digest', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-digest:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    const freqSelect = makeSelectInteraction('cfg-freq:cfg-digest:nomination-digest', 'weekly');
    await handleConfigureSelectMenuInteraction(freqSelect as never);

    const hourSelect = makeSelectInteraction('cfg-hour:cfg-digest:nomination-digest', '09');
    await handleConfigureSelectMenuInteraction(hourSelect as never);

    const button = makeButtonInteraction('cfg-save:cfg-digest:nomination-digest');
    await handleConfigureButtonInteraction(button as never);

    expect(mocks.upsertGuildConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      nominationDigestEnabled: true,
      nominationDigestChannelId: 'channel-123',
      nominationDigestRoleId: 'role-456',
      nominationDigestCronSchedule: '0 9 * * 0',
    }));
    expect(mocks.rescheduleGuildDigest).toHaveBeenCalledWith(expect.anything(), 'guild-1', '0 9 * * 0');
    expect(button.deferUpdate).toHaveBeenCalled();
    expect(button.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/nomination digest saved/i),
      }),
    );
  });

  it('advances to the next feature when skipped in the full wizard', async () => {
    const { handleConfigureCommand, handleConfigureButtonInteraction, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-full' });
    await handleConfigureCommand(slash as never);

    const button = makeButtonInteraction('cfg-skip:cfg-full:verification');
    await handleConfigureButtonInteraction(button as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(button.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/nomination digest/i),
      }),
    );
  });

  it('rejects purge values outside the allowed range before writing', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-purge', feature: 'purge-jobs' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-purge:purge-jobs:base', {
      'temp-member-hours': '721',
    });

    await handleConfigureModalSubmit(modal as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(modal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/between 1 and 720/i),
      }),
    );
  });

  it('saves manufacturing settings after the second modal and schedule selection', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureButtonInteraction, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '3',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    const continueButton = makeButtonInteraction('cfg-continue:cfg-mfg:manufacturing');
    await handleConfigureButtonInteraction(continueButton as never);
    expect(continueButton.showModal).toHaveBeenCalledTimes(1);

    const advancedModal = makeModalInteraction('cfg-modal:cfg-mfg:manufacturing:advanced', {
      'rate-limit-5min': '2',
      'rate-limit-hour': '6',
      'post-title': 'Build Request',
      'post-message': 'Use this thread to submit a build request.',
    });
    await handleConfigureModalSubmit(advancedModal as never);

    const freqSelect = makeSelectInteraction('cfg-freq:cfg-mfg:manufacturing', 'weekly');
    await handleConfigureSelectMenuInteraction(freqSelect as never);
    const hourSelect = makeSelectInteraction('cfg-hour:cfg-mfg:manufacturing', '06');
    await handleConfigureSelectMenuInteraction(hourSelect as never);

    const saveButton = makeButtonInteraction('cfg-save:cfg-mfg:manufacturing', makeGuild(15));
    await handleConfigureButtonInteraction(saveButton as never);

    expect(mocks.upsertGuildConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      manufacturingEnabled: true,
      manufacturingForumChannelId: 'forum-1',
      manufacturingStaffChannelId: 'staff-1',
      manufacturingRoleId: 'role-1',
      manufacturingOrderLimit: 3,
      manufacturingMaxItemsPerOrder: 7,
      manufacturingOrderRateLimitPer5Min: 2,
      manufacturingOrderRateLimitPerHour: 6,
      manufacturingCreateOrderPostTitle: 'Build Request',
      manufacturingCreateOrderPostMessage: 'Use this thread to submit a build request.',
      manufacturingKeepaliveCronSchedule: '0 6 * * 0',
    }));
    expect(mocks.rescheduleGuildKeepalive).toHaveBeenCalled();
    expect(saveButton.deferUpdate).toHaveBeenCalled();
    expect(saveButton.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/manufacturing saved/i),
      }),
    );
  });

  it('prefills the manufacturing advanced modal from the persisted guild config snapshot', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureButtonInteraction, teardownConfigureCommandForTests, guildConfig } = await setup();
    teardown = teardownConfigureCommandForTests;
    guildConfig.manufacturingOrderRateLimitPer5Min = 4;
    guildConfig.manufacturingOrderRateLimitPerHour = 9;
    guildConfig.manufacturingCreateOrderPostTitle = 'Existing Order Title';

    const slash = makeSlashInteraction({ id: 'cfg-mfg-prefill', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-prefill:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '3',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    const continueButton = makeButtonInteraction('cfg-continue:cfg-mfg-prefill:manufacturing');
    await handleConfigureButtonInteraction(continueButton as never);

    expect(continueButton.showModal).toHaveBeenCalledTimes(1);
    const modal = (continueButton.showModal as jest.Mock).mock.calls.at(0)?.[0] as
      | { toJSON: () => { components: Array<{ components: Array<{ value: string }> }> } }
      | undefined;
    expect(modal).toBeDefined();
    const modalJson = modal!.toJSON();
    expect(modalJson.components[0].components[0].value).toBe('4');
    expect(modalJson.components[1].components[0].value).toBe('9');
    expect(modalJson.components[2].components[0].value).toBe('Existing Order Title');
  });

  it('rejects empty nomination digest IDs before showing the schedule prompt', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-empty-digest', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-empty-digest:nomination-digest:base', {
      'channel-id': '   ',
      'role-id': '',
    });
    await handleConfigureModalSubmit(modal as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(modal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/required/i),
      }),
    );
  });

  it('rejects unsupported schedule selections before enabling save', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-invalid-select', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-invalid-select:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    const invalidFreq = makeSelectInteraction('cfg-freq:cfg-invalid-select:nomination-digest', 'every-2-weeks');
    await handleConfigureSelectMenuInteraction(invalidFreq as never);

    expect(invalidFreq.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/unsupported schedule frequency/i),
      }),
    );
  });

  it('keeps the schedule summary visible when select-menu validation fails', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-invalid-select-summary', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-invalid-select-summary:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    await handleConfigureSelectMenuInteraction(makeSelectInteraction('cfg-freq:cfg-invalid-select-summary:nomination-digest', 'weekly') as never);

    const invalidHour = makeSelectInteraction('cfg-hour:cfg-invalid-select-summary:nomination-digest', '99');
    await handleConfigureSelectMenuInteraction(invalidHour as never);

    expect(invalidHour.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/unsupported utc hour selected\..*finish configuring \*\*nomination digest\*\*.*weekly \(sunday utc\)/is),
      }),
    );
  });

  it('shows weekly schedules as Sunday UTC in the schedule summary', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-weekly-summary', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-weekly-summary:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    const freqSelect = makeSelectInteraction('cfg-freq:cfg-weekly-summary:nomination-digest', 'weekly');
    await handleConfigureSelectMenuInteraction(freqSelect as never);

    expect(freqSelect.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/weekly \(sunday utc\)/i),
      }),
    );
  });

  it('keeps the digest schedule summary visible when save validation fails', async () => {
    const textlessGuild = {
      ...makeGuild(),
      channels: {
        fetch: jest.fn(async (channelId: string) => ({
          id: channelId,
          type: 0,
          isTextBased: () => false,
        })),
      },
    };
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, handleConfigureButtonInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-digest-error', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-digest-error:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    await handleConfigureSelectMenuInteraction(makeSelectInteraction('cfg-freq:cfg-digest-error:nomination-digest', 'weekly') as never);
    await handleConfigureSelectMenuInteraction(makeSelectInteraction('cfg-hour:cfg-digest-error:nomination-digest', '09') as never);

    const button = makeButtonInteraction('cfg-save:cfg-digest-error:nomination-digest', textlessGuild as never);
    await handleConfigureButtonInteraction(button as never);

    expect(button.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/digest channel id must point to a text-based channel\..*finish configuring \*\*nomination digest\*\*.*weekly \(sunday utc\)/is),
      }),
    );
  });

  it('rejects empty manufacturing post content before showing the schedule prompt', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureButtonInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg-empty-post', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-empty-post:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '3',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    const continueButton = makeButtonInteraction('cfg-continue:cfg-mfg-empty-post:manufacturing');
    await handleConfigureButtonInteraction(continueButton as never);

    const advancedModal = makeModalInteraction('cfg-modal:cfg-mfg-empty-post:manufacturing:advanced', {
      'rate-limit-5min': '2',
      'rate-limit-hour': '6',
      'post-title': '   ',
      'post-message': '',
    });
    await handleConfigureModalSubmit(advancedModal as never);

    expect(advancedModal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/post title cannot be empty/i),
      }),
    );
  });

  it('rejects overlong manufacturing post content before showing the schedule prompt', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureButtonInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg-long-post', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-long-post:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '3',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    const continueButton = makeButtonInteraction('cfg-continue:cfg-mfg-long-post:manufacturing');
    await handleConfigureButtonInteraction(continueButton as never);

    const advancedModal = makeModalInteraction('cfg-modal:cfg-mfg-long-post:manufacturing:advanced', {
      'rate-limit-5min': '2',
      'rate-limit-hour': '6',
      'post-title': 'T'.repeat(101),
      'post-message': 'Message body',
    });
    await handleConfigureModalSubmit(advancedModal as never);

    expect(advancedModal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/100 characters or fewer/i),
      }),
    );
  });

  it('keeps the manufacturing schedule summary visible when save validation fails', async () => {
    const nonForumGuild = makeGuild(0);
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureButtonInteraction, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg-error', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-error:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '3',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    const continueButton = makeButtonInteraction('cfg-continue:cfg-mfg-error:manufacturing');
    await handleConfigureButtonInteraction(continueButton as never);

    const advancedModal = makeModalInteraction('cfg-modal:cfg-mfg-error:manufacturing:advanced', {
      'rate-limit-5min': '2',
      'rate-limit-hour': '6',
      'post-title': 'Build Request',
      'post-message': 'Use this thread to submit a build request.',
    });
    await handleConfigureModalSubmit(advancedModal as never);

    await handleConfigureSelectMenuInteraction(makeSelectInteraction('cfg-freq:cfg-mfg-error:manufacturing', 'weekly') as never);
    await handleConfigureSelectMenuInteraction(makeSelectInteraction('cfg-hour:cfg-mfg-error:manufacturing', '06') as never);

    const saveButton = makeButtonInteraction('cfg-save:cfg-mfg-error:manufacturing', nonForumGuild);
    await handleConfigureButtonInteraction(saveButton as never);

    expect(saveButton.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/manufacturing forum channel id must point to a forum channel\..*finish configuring \*\*manufacturing\*\*.*weekly \(sunday utc\)/is),
      }),
    );
  });

  it('returns a friendly message when the initial guild config snapshot cannot be loaded', async () => {
    const { handleConfigureCommand, teardownConfigureCommandForTests } = await setupWithGuildConfigFailure();
    teardown = teardownConfigureCommandForTests;

    const interaction = makeSlashInteraction({ feature: 'verification' });
    await handleConfigureCommand(interaction as never);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/could not be loaded right now/i),
      }),
    );
  });

  it('uses friendly lower-bound wording for unbounded integer validation errors', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg-lower-bound', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-lower-bound:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '0',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(baseModal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/whole number of at least 1/i),
      }),
    );
  });

  it('rejects truncated numeric input instead of silently parsing it', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-mfg-truncated-number', feature: 'manufacturing' });
    await handleConfigureCommand(slash as never);

    const baseModal = makeModalInteraction('cfg-modal:cfg-mfg-truncated-number:manufacturing:base', {
      'forum-channel-id': 'forum-1',
      'staff-channel-id': 'staff-1',
      'role-id': 'role-1',
      'order-limit': '10abc',
      'max-items': '7',
    });
    await handleConfigureModalSubmit(baseModal as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(baseModal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/active order limit must be a whole number of at least 1/i),
      }),
    );
  });

  it('rejects select-menu interactions when the session guild does not match', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-guild-mismatch', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-guild-mismatch:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    const select = makeSelectInteraction('cfg-freq:cfg-guild-mismatch:nomination-digest', 'weekly');
    select.guildId = 'guild-2';
    await handleConfigureSelectMenuInteraction(select as never);

    expect(select.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/does not belong to this server/i),
      }),
    );
  });

  it('rejects select-menu interactions without ManageGuild permission', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, handleConfigureSelectMenuInteraction, teardownConfigureCommandForTests } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-select-perms', feature: 'nomination-digest' });
    await handleConfigureCommand(slash as never);

    const modal = makeModalInteraction('cfg-modal:cfg-select-perms:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(modal as never);

    const select = makeSelectInteraction('cfg-freq:cfg-select-perms:nomination-digest', 'weekly');
    select.memberPermissions.has = jest.fn(() => false);
    await handleConfigureSelectMenuInteraction(select as never);

    expect(select.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/requires manage server permission/i),
      }),
    );
  });

  it('rejects stale modal submissions that no longer match the active feature step', async () => {
    const { handleConfigureCommand, handleConfigureModalSubmit, teardownConfigureCommandForTests, mocks } = await setup();
    teardown = teardownConfigureCommandForTests;

    const slash = makeSlashInteraction({ id: 'cfg-stale-modal' });
    await handleConfigureCommand(slash as never);

    const staleModal = makeModalInteraction('cfg-modal:cfg-stale-modal:nomination-digest:base', {
      'channel-id': 'channel-123',
      'role-id': 'role-456',
    });
    await handleConfigureModalSubmit(staleModal as never);

    expect(mocks.upsertGuildConfig).not.toHaveBeenCalled();
    expect(staleModal.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/step is no longer active/i),
      }),
    );
  });
});
