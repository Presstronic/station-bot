import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ChannelType } from 'discord.js';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  forumChannelId: 'forum-ch',
  manufacturingRoleId: 'mfg-role',
  organizationMemberRoleId: 'org-role',
  orderLimit: 5,
  maxItemsPerOrder: 10,
};

function makeChannel({
  type = ChannelType.GuildForum,
  existingThreadNames = [] as string[],
  threadsCreate = jest.fn(async () => ({ id: 'thread-123' })),
}: {
  type?: number;
  existingThreadNames?: string[];
  threadsCreate?: jest.Mock;
} = {}) {
  const threadCollection = {
    some: (fn: (t: { name: string }) => boolean) =>
      existingThreadNames.map((name) => ({ name })).some(fn),
  };
  return {
    type,
    threads: {
      fetchActive: jest.fn(async () => ({ threads: threadCollection })),
      create: threadsCreate,
    },
  };
}

function makeInteraction({
  subcommand = 'setup',
  channelFetch = jest.fn(async () => makeChannel()),
}: {
  subcommand?: string;
  channelFetch?: jest.Mock;
} = {}) {
  const i: Record<string, unknown> = {
    replied: false,
    deferred: false,
    options: { getSubcommand: jest.fn(() => subcommand) },
    client: { channels: { fetch: channelFetch } },
    reply: jest.fn(async () => { i.replied = true; }),
  };
  return i;
}

async function setupMocks(opts: {
  manufacturingEnabled?: boolean;
  config?: Partial<typeof BASE_CONFIG>;
} = {}) {
  const manufacturingEnabled = opts.manufacturingEnabled ?? true;
  const config = { ...BASE_CONFIG, ...opts.config };

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }));

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    getManufacturingConfig: () => config,
    isManufacturingEnabled: () => manufacturingEnabled,
    validateManufacturingConfig: () => [],
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
  return mod;
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
    await handleManufacturingSetupCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not currently enabled/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('replies with a config error when forumChannelId is not set', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks({ config: { forumChannelId: '' } });
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not configured/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('replies with a config error when the channel is not a forum', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ type: 0, threadsCreate })); // 0 = GuildText
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not a valid forum channel/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('replies "already set up" and does not create a thread when one already exists', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () =>
      makeChannel({ existingThreadNames: ['📋 Create Order'], threadsCreate }),
    );
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/already set up/i),
    });
    expect(threadsCreate).not.toHaveBeenCalled();
  });

  it('creates a thread with the Create Order button and replies with success', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ channelFetch });
    await handleManufacturingSetupCommand(i as any);

    expect(threadsCreate).toHaveBeenCalledTimes(1);
    const createArg = (threadsCreate as jest.Mock).mock.calls[0][0] as {
      name: string;
      message: { components: { components: { data: { custom_id: string } }[] }[] };
    };
    expect(createArg.name).toBe('📋 Create Order');
    const buttonCustomId = createArg.message.components[0].components[0].data.custom_id;
    expect(buttonCustomId).toBe('mfg-create-order');

    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/✅ Manufacturing channel set up/i),
    });
  });

  it('returns without action when subcommand is not "setup"', async () => {
    const { handleManufacturingSetupCommand } = await setupMocks();
    const threadsCreate = jest.fn(async () => ({ id: 'thread-123' }));
    const channelFetch = jest.fn(async () => makeChannel({ threadsCreate }));
    const i = makeInteraction({ subcommand: 'other', channelFetch });
    await handleManufacturingSetupCommand(i as any);
    expect(i.reply).not.toHaveBeenCalled();
    expect(threadsCreate).not.toHaveBeenCalled();
  });
});
