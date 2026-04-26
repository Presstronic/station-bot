import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ManufacturingOrder } from '../../domain/manufacturing/types.js';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';

let latestCleanup: (() => void) | undefined;

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  latestCleanup?.();
  latestCleanup = undefined;
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
    manufacturingMaxItemsPerOrder: 3, // low default so max-items tests work
    manufacturingOrderRateLimitPer5Min: 10, // high default so tests never hit rate limit
    manufacturingOrderRateLimitPerHour: 100,
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

function makeOrder(overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder {
  return {
    id: 42,
    discordUserId: 'user-1',
    discordUsername: 'TestUser',
    forumThreadId: null,
    staffThreadId: null,
    status: 'new',
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

function makeSlashInteraction(overrides: Record<string, unknown> = {}) {
  const i: Record<string, unknown> = {
    inGuild: () => true,
    id: 'slash-id',
    user: { id: 'user-1', username: 'TestUser' },
    options: {},
    replied: false,
    deferred: false,
    reply: jest.fn(async () => { i.replied = true; }),
    showModal: jest.fn(async () => {}),
    ...overrides,
  };
  return i;
}

function makeModalInteraction(
  customId: string,
  fields: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const i: Record<string, unknown> = {
    customId,
    user: { id: 'user-1', username: 'TestUser' },
    replied: false,
    deferred: false,
    fields: { getTextInputValue: (name: string) => fields[name] ?? '' },
    reply: jest.fn(async () => { i.replied = true; }),
    deferReply: jest.fn(async () => { i.deferred = true; }),
    deleteReply: jest.fn(async () => {}),
    editReply: jest.fn(async () => {}),
    ...overrides,
  };
  return i;
}

function makeButtonInteraction(
  customId: string,
  overrides: Record<string, unknown> = {},
) {
  const i: Record<string, unknown> = {
    customId,
    user: { id: 'user-1', username: 'TestUser' },
    replied: false,
    deferred: false,
    update: jest.fn(async () => {}),
    showModal: jest.fn(async () => {}),
    deferUpdate: jest.fn(async () => { i.deferred = true; }),
    editReply: jest.fn(async () => {}),
    client: {
      channels: {
        fetch: jest.fn(async () => ({
          type: 15, // ChannelType.GuildForum
          availableTags: [],
          setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
            availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
          })),
          threads: {
            create: jest.fn(async () => ({ id: 'thread-id', send: jest.fn(async () => {}) })),
          },
        })),
      },
    },
    ...overrides,
  };
  return i;
}

async function setupMocks(overrides: {
  hasRole?: boolean;
  manufacturingEnabled?: boolean;
  databaseConfigured?: boolean;
  activeCount?: number;
  submitOrder?: jest.Mock;
  updateForumThreadId?: jest.Mock;
  updateStaffThreadId?: jest.Mock;
  guildConfigOverrides?: Partial<GuildConfig>;
  getGuildConfigOrNull?: jest.Mock;
} = {}) {
  const hasRole = overrides.hasRole ?? true;
  const manufacturingEnabled = overrides.manufacturingEnabled ?? true;
  const databaseConfigured = overrides.databaseConfigured ?? true;
  const activeCount = overrides.activeCount ?? 0;
  const guildConfig = makeGuildConfig(overrides.guildConfigOverrides);
  const getGuildConfigOrNullMock = overrides.getGuildConfigOrNull ?? jest.fn(async () => guildConfig);

  const warnMock = jest.fn();
  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: warnMock,
      error: jest.fn(),
    }),
  }));

  jest.unstable_mockModule('../nomination.helpers.js', () => ({
    hasOrganizationMemberOrHigher: jest.fn(async () => hasRole),
    getGuildMember: jest.fn(),
    getCommandLocale: jest.fn(() => 'en'),
    ensureAdmin: jest.fn(),
    ensureCanManageReviewProcessing: jest.fn(),
    getOrganizationMemberRoleName: jest.fn(() => 'Organization Member'),
    isNominationConfigurationError: jest.fn(),
    resolveNominationOrgResultCode: jest.fn(),
    formatNominationsAsTable: jest.fn(),
  }));

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    isManufacturingEnabled: () => manufacturingEnabled,
  }));

  jest.unstable_mockModule('../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull: getGuildConfigOrNullMock,
    getAllGuildConfigs: jest.fn(async () => []),
    isFeatureEnabledForGuild: jest.fn(() => false),
    upsertGuildConfig: jest.fn(async () => guildConfig),
  }));

  const submitOrderMock = overrides.submitOrder ?? jest.fn(async () => makeOrder());
  const updateForumThreadIdMock = overrides.updateForumThreadId ?? jest.fn(async () => {});
  const updateStaffThreadIdMock = overrides.updateStaffThreadId ?? jest.fn(async () => {});

  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.service.js', () => ({
    submitOrder: submitOrderMock,
    transitionStatus: jest.fn(),
    cancelOrder: jest.fn(),
  }));

  jest.unstable_mockModule('../../services/nominations/db.js', () => ({
    isDatabaseConfigured: jest.fn(() => databaseConfigured),
    endDbPoolIfInitialized: jest.fn(),
    ensureNominationsSchema: jest.fn(),
    withClient: jest.fn(),
    getPool: jest.fn(),
  }));

  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.repository.js', () => ({
    create: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
    countActiveByUserId: jest.fn(async () => activeCount),
    updateStatus: jest.fn(),
    updateForumThreadId: updateForumThreadIdMock,
    updateStaffThreadId: updateStaffThreadIdMock,
    findByForumThreadId: jest.fn(),
  }));

  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.forum.js', () => ({
    ORDER_STATUS_TAG_NAMES: ['New', 'Accepted', 'Processing', 'Ready for Pickup', 'Complete', 'Cancelled'],
    STATUS_LABEL: { new: '🆕 New', accepted: '✅ Accepted', processing: '⚙️ Processing', ready_for_pickup: '📬 Ready for Pickup', complete: '✔️ Complete', cancelled: '🚫 Cancelled' },
    STATUS_TO_TAG: { new: 'New', accepted: 'Accepted', processing: 'Processing', ready_for_pickup: 'Ready for Pickup', complete: 'Complete', cancelled: 'Cancelled' },
    MFG_CANCEL_ORDER_PREFIX: 'mfg-cancel-order',
    MFG_ACCEPT_ORDER_PREFIX: 'mfg-accept-order',
    MFG_STAFF_CANCEL_PREFIX: 'mfg-staff-cancel',
    MFG_START_PROCESSING_PREFIX: 'mfg-start-processing',
    MFG_READY_FOR_PICKUP_PREFIX: 'mfg-ready-for-pickup',
    MFG_MARK_COMPLETE_PREFIX: 'mfg-mark-complete',
    ensureForumTags: jest.fn(async () => new Map([['New', 'tag-new-id']])),
    formatOrderPost: jest.fn(() => 'post content'),
    formatTransitionReply: jest.fn(() => 'transition reply'),
    buildForumPostComponents: jest.fn(() => []),
  }));

  const mod = await import('../order-submit.command.js');
  latestCleanup = mod.teardownOrderSubmitCommandForTests;
  return { ...mod, submitOrderMock, updateForumThreadIdMock, updateStaffThreadIdMock, warnMock, getGuildConfigOrNullMock };
}

// Helper: run the slash command to create a session, then return the session ID
async function createSession(
  handlers: Awaited<ReturnType<typeof setupMocks>>,
  sessionId = 'sess',
) {
  const slash = makeSlashInteraction({ id: sessionId });
  await handlers.handleOrderCommand(slash as any);
  return sessionId;
}

// Helper: submit one valid modal item into an existing session
async function addItemToSession(
  handlers: Awaited<ReturnType<typeof setupMocks>>,
  sessionId: string,
  itemName = 'Steel Plate',
) {
  const modal = makeModalInteraction(`${handlers.ITEM_MODAL_PREFIX}:${sessionId}`, {
    'item-name': itemName,
    'quantity': '1',
    'priority-stat': 'Ballistic resistance',
    'notes': '',
  });
  await handlers.handleOrderItemModal(modal as any);
  return modal;
}

// ---------------------------------------------------------------------------
// handleOrderCommand
// ---------------------------------------------------------------------------

describe('handleOrderCommand', () => {
  it('replies with an unavailable message when manufacturing is disabled', async () => {
    const h = await setupMocks({ manufacturingEnabled: false });
    const i = makeSlashInteraction();
    await h.handleOrderCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not currently available/i),
    });
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('replies with an error when not in a guild', async () => {
    const h = await setupMocks();
    const i = makeSlashInteraction({ inGuild: () => false });
    await h.handleOrderCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/server/i),
    });
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('replies with a permission error when the user lacks the org member role', async () => {
    const h = await setupMocks({ hasRole: false });
    const i = makeSlashInteraction();
    await h.handleOrderCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/Organization Member/i),
    });
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('replies with a configuration error when the database is not configured', async () => {
    const h = await setupMocks({ databaseConfigured: false });
    const i = makeSlashInteraction();
    await h.handleOrderCommand(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/configuration issue/i),
    });
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('replies with an active-order limit error including the count when limit is reached', async () => {
    const h = await setupMocks({ activeCount: 5, guildConfigOverrides: { manufacturingOrderLimit: 5 } });
    const i = makeSlashInteraction();
    await h.handleOrderCommand(i as any);
    const reply = (i.reply as jest.Mock).mock.calls[0][0] as { content: string };
    expect(reply.content).toMatch(/5 active order/i);
    expect(reply.content).toMatch(/limit: 5/i);
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('shows a modal with the correct customId for an authorized member', async () => {
    const h = await setupMocks();
    const i = makeSlashInteraction({ id: 'abc123' });
    await h.handleOrderCommand(i as any);
    expect(i.showModal).toHaveBeenCalledTimes(1);
    const modal = (i.showModal as jest.Mock).mock.calls[0][0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe(`${h.ITEM_MODAL_PREFIX}:abc123`);
  });
});

// ---------------------------------------------------------------------------
// triggerOrderModal — button entry point (rate limiting applies to both paths)
// ---------------------------------------------------------------------------

describe('triggerOrderModal (button interaction)', () => {
  it('shows the item modal when called with an authorized ButtonInteraction', async () => {
    const h = await setupMocks();
    const i: Record<string, unknown> = {
      inGuild: () => true,
      id: 'btn-id-1',
      customId: 'mfg-create-order',
      user: { id: 'user-1', username: 'TestUser' },
      replied: false,
      deferred: false,
      reply: jest.fn(async () => { i.replied = true; }),
      showModal: jest.fn(async () => {}),
    };
    await h.triggerOrderModal(i as any);
    expect(i.showModal).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
    const modal = (i.showModal as jest.Mock).mock.calls[0][0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe(`${h.ITEM_MODAL_PREFIX}:btn-id-1`);
  });

  it('replies with unavailable message when manufacturing is disabled', async () => {
    const h = await setupMocks({ manufacturingEnabled: false });
    const i: Record<string, unknown> = {
      inGuild: () => true,
      id: 'btn-id-2',
      customId: 'mfg-create-order',
      user: { id: 'user-1', username: 'TestUser' },
      replied: false,
      deferred: false,
      reply: jest.fn(async () => { i.replied = true; }),
      showModal: jest.fn(async () => {}),
    };
    await h.triggerOrderModal(i as any);
    expect((i.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/not currently available/i),
    });
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('rate-limits a button interaction the same as a slash command', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    try {
      const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 5 } });

      const makeBtn = (id: string) => ({
        inGuild: () => true,
        id,
        customId: 'mfg-create-order',
        user: { id: 'user-btn', username: 'BtnUser' },
        replied: false,
        deferred: false,
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
      });

      await h.triggerOrderModal(makeBtn('btn-rl-1') as any); // fills the 5-min slot

      const btn2 = makeBtn('btn-rl-2');
      await h.triggerOrderModal(btn2 as any); // should be blocked
      expect((btn2.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
        content: expect.stringMatching(/too quickly/i),
      });
      expect(btn2.showModal).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// handleOrderCommand — rate limiting (handleOrderCommand delegates to triggerOrderModal)
// ---------------------------------------------------------------------------

describe('handleOrderCommand — rate limiting', () => {
  const base = 1_700_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(base);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('first submission in a fresh window passes through', async () => {
    const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 5 } });
    const i = makeSlashInteraction({ id: 'sess-1' });
    await h.handleOrderCommand(i as any);
    expect(i.showModal).toHaveBeenCalledTimes(1);
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('second submission within 5 minutes is rejected with the per-5-min message and seconds remaining', async () => {
    const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 5 } });
    await h.handleOrderCommand(makeSlashInteraction({ id: 'sess-1' }) as any);

    jest.setSystemTime(base + 60_000); // 60 s later — still inside the 5-min window
    const i2 = makeSlashInteraction({ id: 'sess-2' });
    await h.handleOrderCommand(i2 as any);

    const reply = (i2.reply as jest.Mock).mock.calls[0][0] as { content: string; flags: number };
    expect(reply.flags).toBe(64); // MessageFlags.Ephemeral
    expect(reply.content).toMatch(/too quickly/i);
    // base + 300_000 reset − (base + 60_000) now = 240 s remaining
    expect(reply.content).toContain('240 second');
    expect(i2.showModal).not.toHaveBeenCalled();
  });

  it('submission after the hourly cap is hit is rejected with the hourly message and minutes remaining', async () => {
    // Two calls spaced 6 min apart so each clears the 5-min window; third blocked by hourly cap
    const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 2 } });
    await h.handleOrderCommand(makeSlashInteraction({ id: 'sess-1' }) as any);

    jest.setSystemTime(base + 6 * 60_000);
    await h.handleOrderCommand(makeSlashInteraction({ id: 'sess-2' }) as any);

    jest.setSystemTime(base + 12 * 60_000);
    const i3 = makeSlashInteraction({ id: 'sess-3' });
    await h.handleOrderCommand(i3 as any);

    const reply = (i3.reply as jest.Mock).mock.calls[0][0] as { content: string; flags: number };
    expect(reply.flags).toBe(64); // MessageFlags.Ephemeral
    expect(reply.content).toMatch(/hourly order submission limit/i);
    // oldest limiting ts = base; reset at base+3_600_000; now = base+720_000 → 48 min remaining
    expect(reply.content).toContain('48 minute');
    expect(i3.showModal).not.toHaveBeenCalled();
  });

  it('entries older than 60 minutes are pruned and the submission proceeds', async () => {
    const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 1 } });
    await h.handleOrderCommand(makeSlashInteraction({ id: 'sess-1' }) as any); // fills hourly slot

    jest.setSystemTime(base + 61 * 60_000); // 61 min later — stale entry pruned
    const i2 = makeSlashInteraction({ id: 'sess-2' });
    await h.handleOrderCommand(i2 as any);

    // Old entry pruned → not rate-limited; proceeds to showModal
    expect(i2.showModal).toHaveBeenCalledTimes(1);
    expect(i2.reply).not.toHaveBeenCalled();
  });

  it('background sweep removes entries whose newest timestamp is older than 60 minutes', async () => {
    // Set limits to 1/1 so a submission fills the slot
    const h = await setupMocks({ guildConfigOverrides: { manufacturingOrderRateLimitPer5Min: 1, manufacturingOrderRateLimitPerHour: 1 } });
    await h.handleOrderCommand(makeSlashInteraction({ id: 'sess-sweep-1' }) as any);

    // Advance past the hourly sweep interval — the background interval fires and removes the stale entry
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    // A new submission from the same user should now pass through
    const i2 = makeSlashInteraction({ id: 'sess-sweep-2' });
    await h.handleOrderCommand(i2 as any);
    expect(i2.showModal).toHaveBeenCalledTimes(1);
    expect(i2.reply).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleOrderItemModal
// ---------------------------------------------------------------------------

describe('handleOrderItemModal', () => {
  it('replies with expiry message when session does not exist', async () => {
    const h = await setupMocks();
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:no-such-session`, {});
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/expired/i),
    });
  });

  it('defers and edits reply with max-items error when the session is already full', async () => {
    const h = await setupMocks(); // maxItemsPerOrder = 3
    await createSession(h, 'full-session');
    for (let n = 0; n < 3; n++) await addItemToSession(h, 'full-session', `Item${n}`);

    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:full-session`, {
      'item-name': 'One Too Many',
      'quantity': '1',
      'priority-stat': 'X',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/3 items/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with a validation error for a non-numeric quantity', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-err');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-err`, {
      'item-name': 'Steel Plate',
      'quantity': 'five',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/positive whole number/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with a validation error for a non-positive quantity', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-neg');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-neg`, {
      'item-name': 'Steel Plate',
      'quantity': '-3',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/positive whole number/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with a validation error when quantity exceeds 99999', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-huge');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-huge`, {
      'item-name': 'Steel Plate',
      'quantity': '100000',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/99,999/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with a validation error when item name is blank', async () => {
    const h = await setupMocks();
    await createSession(h, 'empty-name');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:empty-name`, {
      'item-name': '   ',
      'quantity': '1',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/item name and priority stat/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with a validation error when priority stat is blank', async () => {
    const h = await setupMocks();
    await createSession(h, 'empty-stat');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:empty-stat`, {
      'item-name': 'Steel Plate',
      'quantity': '1',
      'priority-stat': '   ',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/item name and priority stat/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('defers and edits reply with item count after the first item is added', async () => {
    const h = await setupMocks();
    await createSession(h, 'store-test');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:store-test`, {
      'item-name': 'Steel Plate',
      'quantity': '5',
      'priority-stat': 'Ballistic resistance',
      'notes': 'rush',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    const editReplyArg = (modal.editReply as jest.Mock).mock.calls[0][0] as { content: string; components: unknown[] };
    expect(editReplyArg.content).toMatch(/Item added \(1 \/ 3\)/);
    expect(editReplyArg.components).toHaveLength(1);
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('edits reply with a temporarily-unavailable message when getGuildConfigOrNull throws', async () => {
    const h = await setupMocks({
      getGuildConfigOrNull: jest.fn(async () => { throw new Error('DB error'); }),
    });
    await createSession(h, 'modal-db-throw');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:modal-db-throw`, {
      'item-name': 'Steel Plate', 'quantity': '1', 'priority-stat': 'X', 'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/right now/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('edits reply with a not-configured message when guild config is null', async () => {
    const h = await setupMocks({
      getGuildConfigOrNull: jest.fn(async () => null),
    });
    await createSession(h, 'modal-cfg-null');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:modal-cfg-null`, {
      'item-name': 'Steel Plate', 'quantity': '1', 'priority-stat': 'X', 'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/not configured/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('edits reply with a disabled message when manufacturingEnabled is false', async () => {
    const h = await setupMocks({
      getGuildConfigOrNull: jest.fn(async () => makeGuildConfig({ manufacturingEnabled: false })),
    });
    await createSession(h, 'modal-cfg-disabled');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:modal-cfg-disabled`, {
      'item-name': 'Steel Plate', 'quantity': '1', 'priority-stat': 'X', 'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    expect(modal.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/disabled/i) }),
    );
    expect(modal.reply).not.toHaveBeenCalled();
  });

  it('disables the Add Item button when maxItemsPerOrder is reached', async () => {
    const h = await setupMocks(); // maxItemsPerOrder = 3
    await createSession(h, 'max-test');
    const modals: ReturnType<typeof makeModalInteraction>[] = [];
    for (let n = 0; n < 3; n++) {
      const m = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:max-test`, {
        'item-name': `Item${n}`,
        'quantity': '1',
        'priority-stat': 'X',
        'notes': '',
      });
      modals.push(m);
      await h.handleOrderItemModal(m as any);
    }
    // Third item goes via editReply on the first modal's interaction (third editReply call overall)
    const editReplyCalls = (modals[0].editReply as jest.Mock).mock.calls;
    const lastEditReply = editReplyCalls[editReplyCalls.length - 1][0] as {
      components: { components: { data: { disabled: boolean; label: string } }[] }[];
    };
    const addBtn = lastEditReply.components[0].components.find((c) => c.data.label === '＋ Add Item');
    expect(addBtn?.data.disabled).toBe(true);
  });

  it('edits the first ephemeral message in place when a second item is added', async () => {
    const h = await setupMocks();
    await createSession(h, 'edit-test');

    const first = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:edit-test`, {
      'item-name': 'Iron Ore', 'quantity': '1', 'priority-stat': 'X', 'notes': '',
    });
    await h.handleOrderItemModal(first as any);
    // First item: deferReply then editReply to create the UI; reply never called
    expect(first.deferReply).toHaveBeenCalledTimes(1);
    expect(first.editReply).toHaveBeenCalledTimes(1);
    expect(first.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Item added \(1 \/ 3\)/) }),
    );
    expect(first.reply).not.toHaveBeenCalled();

    const second = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:edit-test`, {
      'item-name': 'Carbon', 'quantity': '2', 'priority-stat': 'Y', 'notes': '',
    });
    await h.handleOrderItemModal(second as any);
    // Second item: editReply called again on the FIRST interaction to update the UI
    expect(first.editReply).toHaveBeenCalledTimes(2);
    expect(first.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Item added \(2 \/ 3\)/) }),
    );
    expect(second.reply).not.toHaveBeenCalled();
    // New modal interaction is silently acknowledged and deleted
    expect(second.deferReply).toHaveBeenCalledTimes(1);
    expect(second.deleteReply).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// handleOrderButtonInteraction
// ---------------------------------------------------------------------------

describe('handleOrderButtonInteraction', () => {
  it('updates with expiry message when session does not exist', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction(`${h.ADD_ITEM_BUTTON_PREFIX}:no-such-session`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/expired/i) }),
    );
  });

  it('updates with an error and keeps buttons when Submit Order is clicked with zero items', async () => {
    const h = await setupMocks();
    await createSession(h, 'zero-items');
    // Do not add any items — session has items: []
    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:zero-items`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.deferUpdate).not.toHaveBeenCalled();
    expect(h.submitOrderMock).not.toHaveBeenCalled();
    expect(btn.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/at least one item/i) }),
    );
  });

  it('shows a new item modal when Add Item is clicked under the limit', async () => {
    const h = await setupMocks();
    await createSession(h, 'add-btn');
    const btn = makeButtonInteraction(`${h.ADD_ITEM_BUTTON_PREFIX}:add-btn`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.showModal).toHaveBeenCalledTimes(1);
    const modal = (btn.showModal as jest.Mock).mock.calls[0][0] as { data: { custom_id: string } };
    expect(modal.data.custom_id).toBe(`${h.ITEM_MODAL_PREFIX}:add-btn`);
  });

  it('shows a modal when Add Item is clicked even at max items (authoritative check is in handleOrderItemModal)', async () => {
    const h = await setupMocks(); // maxItemsPerOrder = 3
    await createSession(h, 'max-btn');
    for (let n = 0; n < 3; n++) await addItemToSession(h, 'max-btn', `Item${n}`);

    const btn = makeButtonInteraction(`${h.ADD_ITEM_BUTTON_PREFIX}:max-btn`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.showModal).toHaveBeenCalledTimes(1);
    expect(btn.update).not.toHaveBeenCalled();
  });

  it('creates the order and forum post on Submit Order', async () => {
    const order = makeOrder({ id: 99 });
    const submitOrderMock = jest.fn(async () => order);
    const updateForumThreadIdMock = jest.fn(async () => {});
    const h = await setupMocks({ submitOrder: submitOrderMock, updateForumThreadId: updateForumThreadIdMock });

    await createSession(h, 'submit-btn');
    await addItemToSession(h, 'submit-btn', 'Steel Plate');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:submit-btn`);
    await h.handleOrderButtonInteraction(btn as any);

    expect(btn.deferUpdate).toHaveBeenCalledTimes(1);
    expect(submitOrderMock).toHaveBeenCalledWith(
      'user-1',
      'TestUser',
      expect.arrayContaining([expect.objectContaining({ itemName: 'Steel Plate' })]),
      5,
    );
    expect(updateForumThreadIdMock).toHaveBeenCalledWith(99, 'thread-id');
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #99/i) }),
    );
  });

  it('edits reply with a temporarily-unavailable message when getGuildConfigOrNull throws on submit', async () => {
    const h = await setupMocks();
    await createSession(h, 'cfg-throw');
    await addItemToSession(h, 'cfg-throw');
    (h.getGuildConfigOrNullMock as jest.Mock).mockImplementationOnce(async () => { throw new Error('DB error'); });
    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:cfg-throw`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalledTimes(1);
    expect(h.submitOrderMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/temporarily unavailable/i) }),
    );
  });

  it('edits reply with a temporarily-unavailable message when guild config is null on submit', async () => {
    const h = await setupMocks();
    await createSession(h, 'cfg-null');
    await addItemToSession(h, 'cfg-null');
    (h.getGuildConfigOrNullMock as jest.Mock).mockImplementationOnce(async () => null);
    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:cfg-null`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalledTimes(1);
    expect(h.submitOrderMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/temporarily unavailable/i) }),
    );
  });

  it('edits reply with a disabled message when manufacturingEnabled is false on submit', async () => {
    const h = await setupMocks();
    await createSession(h, 'cfg-disabled');
    await addItemToSession(h, 'cfg-disabled');
    (h.getGuildConfigOrNullMock as jest.Mock).mockImplementationOnce(async () => makeGuildConfig({ manufacturingEnabled: false }));
    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:cfg-disabled`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalledTimes(1);
    expect(h.submitOrderMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/disabled/i) }),
    );
  });

  it('edits reply with a misconfiguration error and does not save the order when forum channel is invalid', async () => {
    const h = await setupMocks();
    await createSession(h, 'bad-channel');
    await addItemToSession(h, 'bad-channel');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:bad-channel`, {
      client: {
        channels: {
          fetch: jest.fn(async () => null), // channel not found
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);

    expect(h.submitOrderMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/not configured correctly/i) }),
    );
  });

  it('edits reply with a specific message when post content exceeds Discord message limit', async () => {
    const longContent = 'x'.repeat(2001);
    const h = await setupMocks();
    const forumMod = await import('../../domain/manufacturing/manufacturing.forum.js');
    (forumMod.formatOrderPost as jest.Mock).mockReturnValueOnce(longContent);

    await createSession(h, 'long-post');
    await addItemToSession(h, 'long-post');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:long-post`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/too long/i) }),
    );
  });

  it('edits reply with a specific message when forum thread creation fails', async () => {
    const h = await setupMocks();

    await createSession(h, 'thread-fail');
    await addItemToSession(h, 'thread-fail');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:thread-fail`, {
      client: {
        channels: {
          fetch: jest.fn(async () => ({
            type: 15,
            availableTags: [],
            setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
              availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
            })),
            threads: {
              create: jest.fn(async () => { throw new Error('Discord API error'); }),
            },
          })),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/forum post could not be created/i) }),
    );
  });

  it('edits reply with a link-failure warning when updateForumThreadId throws', async () => {
    const updateForumThreadIdMock = jest.fn(async () => { throw new Error('DB error'); });
    const h = await setupMocks({ updateForumThreadId: updateForumThreadIdMock });

    await createSession(h, 'link-fail');
    await addItemToSession(h, 'link-fail');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:link-fail`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/contact staff/i) }),
    );
  });

  it('passes allowedMentions scoped to the order owner when creating the forum thread', async () => {
    const order = makeOrder({ id: 55, discordUserId: 'owner-uid' });
    const submitOrderMock = jest.fn(async () => order);
    const createThreadMock = jest.fn(async () => ({ id: 'thread-id', send: jest.fn(async () => {}) }));
    const h = await setupMocks({ submitOrder: submitOrderMock });

    await createSession(h, 'mention-btn');
    await addItemToSession(h, 'mention-btn');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:mention-btn`, {
      client: {
        channels: {
          fetch: jest.fn(async () => ({
            type: 15,
            availableTags: [],
            setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
              availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
            })),
            threads: { create: createThreadMock },
          })),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);

    const createCall = (createThreadMock.mock.calls[0] as unknown[])[0] as {
      message: { allowedMentions: { parse: string[]; users: string[]; roles: string[] } };
    };
    expect(createCall.message.allowedMentions).toEqual({ parse: [], users: ['owner-uid'], roles: [] });
  });

  it('shows an active-limit error when OrderLimitExceededError is thrown', async () => {
    const { OrderLimitExceededError } = await import('../../domain/manufacturing/types.js');
    const submitOrderMock = jest.fn(async () => { throw new OrderLimitExceededError(5); });
    const h = await setupMocks({ submitOrder: submitOrderMock });

    await createSession(h, 'limit-btn');
    await addItemToSession(h, 'limit-btn');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:limit-btn`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/active order limit/i) }),
    );
  });

  it('sends a role ping into the thread after successful order creation', async () => {
    const sendMock = jest.fn(async () => {});
    const h = await setupMocks();

    await createSession(h, 'ping-btn');
    await addItemToSession(h, 'ping-btn');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:ping-btn`, {
      client: {
        channels: {
          fetch: jest.fn(async () => ({
            type: 15,
            availableTags: [],
            setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
              availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
            })),
            threads: {
              create: jest.fn(async () => ({ id: 'thread-id', send: sendMock })),
            },
          })),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);

    expect(sendMock).toHaveBeenCalledWith({
      content: '<@&mfg-role> New order submitted.',
      allowedMentions: { roles: ['mfg-role'] },
    });
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #42/i) }),
    );
  });

  it('still sends the success reply when the role ping throws, and logs at warn', async () => {
    const pingError = new Error('ping failed');
    const sendMock = jest.fn(async () => { throw pingError; });
    const h = await setupMocks();

    await createSession(h, 'ping-fail');
    await addItemToSession(h, 'ping-fail');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:ping-fail`, {
      client: {
        channels: {
          fetch: jest.fn(async () => ({
            type: 15,
            availableTags: [],
            setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
              availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
            })),
            threads: {
              create: jest.fn(async () => ({ id: 'thread-id', send: sendMock })),
            },
          })),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(h.warnMock).toHaveBeenCalledWith(
      '[manufacturing] Failed to send role ping in order thread',
      expect.objectContaining({ orderId: 42, threadId: 'thread-id', error: pingError }),
    );
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #42/i) }),
    );
  });

  it('skips the role ping when manufacturingRoleId is not configured', async () => {
    const sendMock = jest.fn(async () => {});
    const h = await setupMocks({ guildConfigOverrides: { manufacturingRoleId: null } });

    await createSession(h, 'no-role');
    await addItemToSession(h, 'no-role');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:no-role`, {
      client: {
        channels: {
          fetch: jest.fn(async () => ({
            type: 15,
            availableTags: [],
            setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
              availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
            })),
            threads: {
              create: jest.fn(async () => ({ id: 'thread-id', send: sendMock })),
            },
          })),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #42/i) }),
    );
  });

  it('clears the session before submitting to prevent double-submission', async () => {
    const h = await setupMocks();
    await createSession(h, 'dedup');
    await addItemToSession(h, 'dedup');

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:dedup`);
    await h.handleOrderButtonInteraction(btn as any);

    // After submit, an Add Item button with the same session ID should show expiry
    const addBtn = makeButtonInteraction(`${h.ADD_ITEM_BUTTON_PREFIX}:dedup`);
    await h.handleOrderButtonInteraction(addBtn as any);
    expect(addBtn.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/expired/i) }),
    );
  });

  it('creates a staff thread and calls updateStaffThreadId after order creation', async () => {
    const order = makeOrder({ id: 77 });
    const publicCreateMock = jest.fn(async () => ({ id: 'pub-thread-id', send: jest.fn(async () => {}) }));
    const staffCreateMock = jest.fn(async () => ({ id: 'staff-thread-id', send: jest.fn(async () => {}) }));
    const updateStaffThreadIdMock = jest.fn(async () => {});
    const h = await setupMocks({ submitOrder: jest.fn(async () => order), updateStaffThreadId: updateStaffThreadIdMock });

    // Grab a reference to the buildForumPostComponents mock so we can assert targets
    const { buildForumPostComponents: buildComponentsMock } = await import('../../domain/manufacturing/manufacturing.forum.js');

    await createSession(h, 'staff-create');
    await addItemToSession(h, 'staff-create');

    const makeForumChannel = (createMock: jest.Mock) => ({
      type: 15, // GuildForum
      availableTags: [],
      setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
        availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
      })),
      threads: { create: createMock },
    });

    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:staff-create`, {
      client: {
        channels: {
          // Return public channel for 'forum-ch', staff channel for 'staff-ch'
          fetch: jest.fn(async (channelId: unknown) =>
            channelId === 'staff-ch'
              ? makeForumChannel(staffCreateMock)
              : makeForumChannel(publicCreateMock),
          ),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);
    // Staff thread creation is fire-and-forget; drain the microtask queue before asserting.
    await new Promise<void>(resolve => { setImmediate(resolve); });

    expect(publicCreateMock).toHaveBeenCalledTimes(1);
    expect(staffCreateMock).toHaveBeenCalledTimes(1);
    // Staff thread must use the 'staff' component target and suppress member pings
    expect(buildComponentsMock as jest.Mock).toHaveBeenCalledWith(77, 'new', 'staff');
    expect(staffCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          allowedMentions: { parse: [], users: [] },
        }),
      }),
    );
    // Public thread must use the 'member' component target
    expect(buildComponentsMock as jest.Mock).toHaveBeenCalledWith(77, 'new', 'member');
    expect(updateStaffThreadIdMock).toHaveBeenCalledWith(77, 'staff-thread-id');
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #77/i) }),
    );
  });

  it('still sends the success reply when staff thread creation throws', async () => {
    const updateStaffThreadIdMock = jest.fn(async () => {});
    const h = await setupMocks({ updateStaffThreadId: updateStaffThreadIdMock });

    await createSession(h, 'staff-fail');
    await addItemToSession(h, 'staff-fail');

    let callCount = 0;
    const btn = makeButtonInteraction(`${h.SUBMIT_ORDER_BUTTON_PREFIX}:staff-fail`, {
      client: {
        channels: {
          fetch: jest.fn(async () => {
            callCount++;
            if (callCount === 1) {
              // Public forum channel — succeeds
              return {
                type: 15,
                availableTags: [],
                setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
                  availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
                })),
                threads: {
                  create: jest.fn(async () => ({ id: 'pub-thread', send: jest.fn(async () => {}) })),
                },
              };
            }
            // Staff channel fetch — throws
            throw new Error('staff channel unavailable');
          }),
        },
      },
    });
    await h.handleOrderButtonInteraction(btn as any);
    // Drain microtasks from fire-and-forget staff thread creation before asserting.
    await new Promise<void>(resolve => { setImmediate(resolve); });

    expect(updateStaffThreadIdMock).not.toHaveBeenCalled();
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #42/i) }),
    );
  });
});
