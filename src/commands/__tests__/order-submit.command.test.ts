import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ManufacturingOrder } from '../../domain/manufacturing/types.js';

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
  maxItemsPerOrder: 3,
};

function makeOrder(overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder {
  return {
    id: 42,
    discordUserId: 'user-1',
    discordUsername: 'TestUser',
    forumThreadId: null,
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
            create: jest.fn(async () => ({ id: 'thread-id' })),
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
  configOverrides?: Partial<typeof BASE_CONFIG>;
} = {}) {
  const hasRole = overrides.hasRole ?? true;
  const manufacturingEnabled = overrides.manufacturingEnabled ?? true;
  const databaseConfigured = overrides.databaseConfigured ?? true;
  const activeCount = overrides.activeCount ?? 0;
  const config = { ...BASE_CONFIG, ...overrides.configOverrides };

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
    getManufacturingConfig: () => config,
    isManufacturingEnabled: () => manufacturingEnabled,
    validateManufacturingConfig: () => [],
  }));

  const submitOrderMock = overrides.submitOrder ?? jest.fn(async () => makeOrder());
  const updateForumThreadIdMock = overrides.updateForumThreadId ?? jest.fn(async () => {});

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
  return { ...mod, submitOrderMock, updateForumThreadIdMock };
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
    const h = await setupMocks({ activeCount: 5, configOverrides: { orderLimit: 5 } });
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

  it('replies with max-items error when the session is already full', async () => {
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
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/3 items/i),
    });
  });

  it('replies with a validation error for a non-numeric quantity', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-err');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-err`, {
      'item-name': 'Steel Plate',
      'quantity': 'five',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/positive whole number/i),
    });
  });

  it('replies with a validation error for a non-positive quantity', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-neg');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-neg`, {
      'item-name': 'Steel Plate',
      'quantity': '-3',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/positive whole number/i),
    });
  });

  it('replies with a validation error when quantity exceeds 99999', async () => {
    const h = await setupMocks();
    await createSession(h, 'q-huge');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:q-huge`, {
      'item-name': 'Steel Plate',
      'quantity': '100000',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/99,999/i),
    });
  });

  it('replies with a validation error when item name is blank', async () => {
    const h = await setupMocks();
    await createSession(h, 'empty-name');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:empty-name`, {
      'item-name': '   ',
      'quantity': '1',
      'priority-stat': 'Ballistic resistance',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/item name and priority stat/i),
    });
  });

  it('replies with a validation error when priority stat is blank', async () => {
    const h = await setupMocks();
    await createSession(h, 'empty-stat');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:empty-stat`, {
      'item-name': 'Steel Plate',
      'quantity': '1',
      'priority-stat': '   ',
      'notes': '',
    });
    await h.handleOrderItemModal(modal as any);
    expect((modal.reply as jest.Mock).mock.calls[0][0]).toMatchObject({
      content: expect.stringMatching(/item name and priority stat/i),
    });
  });

  it('stores the item and echoes item count in the reply', async () => {
    const h = await setupMocks();
    await createSession(h, 'store-test');
    const modal = makeModalInteraction(`${h.ITEM_MODAL_PREFIX}:store-test`, {
      'item-name': 'Steel Plate',
      'quantity': '5',
      'priority-stat': 'Ballistic resistance',
      'notes': 'rush',
    });
    await h.handleOrderItemModal(modal as any);
    const replyArg = (modal.reply as jest.Mock).mock.calls[0][0] as { content: string; components: unknown[] };
    expect(replyArg.content).toMatch(/Item added \(1 \/ 3\)/);
    expect(replyArg.components).toHaveLength(1);
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
    const lastReply = (modals[2].reply as jest.Mock).mock.calls[0][0] as {
      components: { components: { data: { disabled: boolean; label: string } }[] }[];
    };
    const addBtn = lastReply.components[0].components.find((c) => c.data.label === '＋ Add Item');
    expect(addBtn?.data.disabled).toBe(true);
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

  it('updates with a limit message when Add Item is clicked at max items', async () => {
    const h = await setupMocks(); // maxItemsPerOrder = 3
    await createSession(h, 'max-btn');
    for (let n = 0; n < 3; n++) await addItemToSession(h, 'max-btn', `Item${n}`);

    const btn = makeButtonInteraction(`${h.ADD_ITEM_BUTTON_PREFIX}:max-btn`);
    await h.handleOrderButtonInteraction(btn as any);
    expect(btn.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/maximum/i) }),
    );
    expect(btn.showModal).not.toHaveBeenCalled();
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
    );
    expect(updateForumThreadIdMock).toHaveBeenCalledWith(99, 'thread-id');
    expect(btn.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/Order #99/i) }),
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
    const createThreadMock = jest.fn(async () => ({ id: 'thread-id' }));
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
      message: { allowedMentions: { users: string[] } };
    };
    expect(createCall.message.allowedMentions).toEqual({ users: ['owner-uid'] });
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
});
