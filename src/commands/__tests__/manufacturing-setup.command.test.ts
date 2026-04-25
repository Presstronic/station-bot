import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ChannelType } from 'discord.js';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    manufacturingEnabled: true,
    manufacturingForumChannelId: 'forum-ch',
    manufacturingStaffChannelId: 'staff-ch',
    manufacturingRoleId: 'mfg-role',
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeChannel({
  type = ChannelType.GuildForum,
  activeThreadNames = [] as string[],
  archivedThreadNames = [] as string[],
  threadsCreate = jest.fn(async () => ({ id: 'thread-123' })),
}: {
  type?: number;
  activeThreadNames?: string[];
  archivedThreadNames?: string[];
  threadsCreate?: jest.Mock;
} = {}) {
  const activeCollection = {
    some: (fn: (t: { name: string }) => boolean) =>
      activeThreadNames.map((name) => ({ name })).some(fn),
  };
  const archivedCollection = {
    some: (fn: (t: { name: string }) => boolean) =>
      archivedThreadNames.map((name) => ({ name })).some(fn),
  };
  return {
    type,
    threads: {
      fetchActive: jest.fn(async () => ({ threads: activeCollection })),
      fetchArchived: jest.fn(async () => ({ threads: archivedCollection })),
      create: threadsCreate,
    },
  };
}

function makeInteraction({
  subcommand = 'setup',
  channelFetch = jest.fn(async () => makeChannel()),
  inGuild = true,
  isAdmin = true,
}: {
  subcommand?: string;
  channelFetch?: jest.Mock;
  inGuild?: boolean;
  isAdmin?: boolean;
} = {}) {
  const i: Record<string, unknown> = {
    replied: false,
    deferred: false,
    guildId: 'guild-1',
    inGuild: () => inGuild,
    memberPermissions: { has: jest.fn(() => isAdmin) },
    options: { getSubcommand: jest.fn(() => subcommand) },
    client: { channels: { fetch: channelFetch } },
    reply: jest.fn(async () => { i.replied = true; }),
    deferReply: jest.fn(async () => { i.deferred = true; }),
    editReply: jest.fn(async () => {}),
  };
  return i;
}

async function setupMocks(opts: {
  manufacturingEnabled?: boolean;
  guildConfigOverrides?: Partial<GuildConfig>;
} = {}) {
  const manufacturingEnabled = opts.manufacturingEnabled ?? true;
  const guildConfig = makeGuildConfig(opts.guildConfigOverrides);
  const mockGetGuildConfigOrNull = jest.fn(async () => guildConfig);
  const mockUpsertGuildConfig = jest.fn(async () => guildConfig);

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }));

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    isManufacturingEnabled: () => manufacturingEnabled,
  }));

  jest.unstable_mockModule('../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull: mockGetGuildConfigOrNull,
    getAllGuildConfigs: jest.fn(async () => []),
    isFeatureEnabledForGuild: jest.fn(() => false),
    upsertGuildConfig: mockUpsertGuildConfig,
  }));

  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.forum.js', () => ({
    MFG_CREATE_ORDER_PREFIX: 'mfg-create-order',
    MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
    MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
    MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    MFG_START_PROCESSING_PREFIX: 'mfg-start-processing',
    MFG_READY_FOR_PICKUP_PREFIX: 'mfg-ready-for-pickup',
    MFG_MARK_COMPLETE_PREFIX: 'mfg-mark-complete',
    ensureForumTags: jest.fn(async () => new Map()),
    formatOrderPost: jest.fn(() => ''),
    formatTransitionReply: jest.fn(() => ''),
    buildForumPostComponents: jest.fn(() => []),
  }));

  const mod = await import('../manufacturing-setup.command.js');
  return { ...mod, mockGetGuildConfigOrNull, mockUpsertGuildConfig };
}

// ---------------------------------------------------------------------------
// handleManufacturingSetupCommand
// ---------------------------------------------------------------------------

describe('handleManufacturingSetupCommand', () => {
  it('replies with unavailable message when manufacturing is disabled', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks({ manufacturingEnabled: false });
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);
    // Sync guard — uses reply directly (no deferReply)
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not currently enabled/i),
    });
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and edits with a config error when forumChannelId is not set', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks({
      guildConfigOverrides: { manufacturingForumChannelId: null },
    });
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not configured/i),
    });
    expect(i.reply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and rejects when the interaction is not in a guild', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch, inGuild: false });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/administrator/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and rejects when the user is not an administrator', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch, isAdmin: false });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/administrator/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and edits with a config error when the channel is not a forum', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ type: 0, threadsCreate })); // 0 = GuildText
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not a valid forum channel/i),
    });
    expect(i.reply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and edits "already set up" when an active thread with that name exists', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () =>
      makeChannel({ activeThreadNames: ['📋 Create Order'], threadsCreate }),
    );
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/already set up/i),
    });
    expect(i.reply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('defers and edits "already set up" when an archived thread with that name exists', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () =>
      makeChannel({ archivedThreadNames: ['📋 Create Order'], threadsCreate }),
    );
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/already set up/i),
    });
    expect(i.reply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('creates a thread with the Create Order button and edits with success', async () => {
    const { handleManufacturingSetupCommand, mockUpsertGuildConfig } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);

    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect(threadsCreate).toHaveBeenCalledTimes(1);
    const createArg = (threadsCreate as jest.Mock).mock.calls[0][0] as {
      name: string;
      message: { components: { components: { data: { custom_id: string } }[] }[] };
    };
    expect(createArg.name).toBe('📋 Create Order');
    const buttonCustomId = createArg.message.components[0].components[0].data.custom_id;
    expect(buttonCustomId).toBe('mfg-create-order');

    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(
      'guild-1',
      { manufacturingCreateOrderThreadId: 'thread-123' },
    );

    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/✅ Manufacturing channel set up/i),
    });
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('replies with a warning when upsertGuildConfig fails after thread creation', async () => {
    const { handleManufacturingSetupCommand, mockUpsertGuildConfig } = await setupMocks();
    mockUpsertGuildConfig.mockRejectedValueOnce(new Error('DB connection lost'));
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);

    expect(threadsCreate).toHaveBeenCalledTimes(1);
    expect(mockUpsertGuildConfig).toHaveBeenCalledTimes(1);
    expect((i.editReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/could not be saved/i),
    });
  });

  it('uses custom post title and message from guild config', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks({
      guildConfigOverrides: {
        manufacturingCreateOrderPostTitle: '🛠️ Place Your Order',
        manufacturingCreateOrderPostMessage: 'Hit the button to get started.',
      },
    });
    const threadsCreate = jest.fn(async () => ({ id: 'thread-456' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as never);

    expect(threadsCreate).toHaveBeenCalledTimes(1);
    const createArg = (threadsCreate as jest.Mock).mock.calls[0][0] as {
      name: string;
      message: { content: string };
    };
    expect(createArg.name).toBe('🛠️ Place Your Order');
    expect(createArg.message.content).toBe('Hit the button to get started.');
  });

  it('returns without action when subcommand is not "setup"', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ subcommand: 'other', channelFetch });
    await handleManufacturingSetupCommand(i as never);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });
});
