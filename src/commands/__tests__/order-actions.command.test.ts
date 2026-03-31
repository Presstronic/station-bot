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
  maxItemsPerOrder: 10,
};

function makeOrder(overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder {
  return {
    id: 42,
    discordUserId: 'owner-1',
    discordUsername: 'Owner',
    forumThreadId: 'thread-1',
    status: 'new',
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

function makeThreadChannel(overrides: Record<string, unknown> = {}) {
  return {
    type: 11, // PublicThread
    parent: {
      type: 15, // GuildForum
      availableTags: [
        { name: 'New', id: 't-new' },
        { name: 'Accepted', id: 't-accepted' },
        { name: 'Processing', id: 't-processing' },
        { name: 'Ready for Pickup', id: 't-pickup' },
        { name: 'Complete', id: 't-complete' },
        { name: 'Cancelled', id: 't-cancelled' },
      ],
      setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
        availableTags: tags.map((t) => ({ ...t, id: `id-${t.name}` })),
      })),
    },
    setAppliedTags: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    ...overrides,
  };
}

function makeButtonInteraction(
  customId: string,
  {
    userId = 'staff-1',
    roles = ['mfg-role'],
    isAdmin = false,
  }: { userId?: string; roles?: string[]; isAdmin?: boolean } = {},
) {
  const channel = makeThreadChannel();
  const i: Record<string, unknown> = {
    customId,
    user: { id: userId },
    inGuild: () => true,
    member: { roles },
    memberPermissions: { has: () => isAdmin },
    channel,
    replied: false,
    deferred: false,
    reply: jest.fn(async () => { i.replied = true; }),
    deferUpdate: jest.fn(async () => { i.deferred = true; }),
    editReply: jest.fn(async () => {}),
    followUp: jest.fn(async () => {}),
  };
  return i;
}

async function setupMocks(overrides: {
  findById?: jest.Mock;
  updateStatus?: jest.Mock;
  transitionStatus?: jest.Mock;
  cancelOrder?: jest.Mock;
  manufacturingEnabled?: boolean;
} = {}) {
  const findByIdMock = overrides.findById ?? jest.fn(async () => makeOrder());
  const updateStatusMock = overrides.updateStatus ?? jest.fn(async (_id: number, status: string) =>
    makeOrder({ status: status as ManufacturingOrder['status'] }),
  );
  const transitionStatusMock = overrides.transitionStatus ?? jest.fn(async (_id: number, _from: string, status: string) =>
    makeOrder({ status: status as ManufacturingOrder['status'] }),
  );
  const cancelOrderMock = overrides.cancelOrder ?? jest.fn(async () =>
    makeOrder({ status: 'cancelled' }),
  );
  const manufacturingEnabled = overrides.manufacturingEnabled ?? true;

  jest.unstable_mockModule('../../config/manufacturing.config.js', () => ({
    getManufacturingConfig: () => BASE_CONFIG,
    isManufacturingEnabled: () => manufacturingEnabled,
    validateManufacturingConfig: () => [],
  }));

  jest.unstable_mockModule('../../domain/manufacturing/manufacturing.repository.js', () => ({
    create: jest.fn(),
    findById: findByIdMock,
    findByUserId: jest.fn(),
    countActiveByUserId: jest.fn(async () => 0),
    updateStatus: updateStatusMock,
    transitionStatus: transitionStatusMock,
    cancelOrder: cancelOrderMock,
    updateForumThreadId: jest.fn(),
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
    ensureForumTags: jest.fn(async () => new Map([
      ['New', 't-new'], ['Accepted', 't-accepted'], ['Processing', 't-processing'],
      ['Ready for Pickup', 't-pickup'], ['Complete', 't-complete'], ['Cancelled', 't-cancelled'],
    ])),
    formatOrderPost: jest.fn(() => 'updated post content'),
    formatTransitionReply: jest.fn(() => 'transition reply text'),
    buildForumPostComponents: jest.fn(() => []),
  }));

  class MockInvalidStatusTransitionError extends Error {
    readonly from: string;
    readonly to: string;
    constructor(from: string, to: string) {
      super(`Invalid status transition: ${from} → ${to}`);
      this.name = 'InvalidStatusTransitionError';
      this.from = from;
      this.to = to;
    }
  }

  class MockOrderNotFoundError extends Error {
    constructor(orderId: number) {
      super(`Manufacturing order ${orderId} not found`);
      this.name = 'OrderNotFoundError';
    }
  }

  class MockOrderLimitExceededError extends Error {
    constructor(limit: number) {
      super(`Active order limit of ${limit} reached`);
      this.name = 'OrderLimitExceededError';
    }
  }

  class MockOrderCancelForbiddenError extends Error {
    constructor(reason: string) {
      super(reason);
      this.name = 'OrderCancelForbiddenError';
    }
  }

  jest.unstable_mockModule('../../domain/manufacturing/types.js', () => ({
    TERMINAL_STATUSES: ['complete', 'cancelled'],
    VALID_TRANSITIONS: {
      new: ['accepted', 'cancelled'],
      accepted: ['processing', 'cancelled'],
      processing: ['ready_for_pickup', 'cancelled'],
      ready_for_pickup: ['complete', 'cancelled'],
      complete: [],
      cancelled: [],
    },
    InvalidStatusTransitionError: MockInvalidStatusTransitionError,
    OrderNotFoundError: MockOrderNotFoundError,
    OrderLimitExceededError: MockOrderLimitExceededError,
    OrderCancelForbiddenError: MockOrderCancelForbiddenError,
  }));

  const mod = await import('../order-actions.command.js');
  return { ...mod, findByIdMock, updateStatusMock, transitionStatusMock, cancelOrderMock };
}

// ---------------------------------------------------------------------------
// handleMfgCancelOrder — member cancel button
// ---------------------------------------------------------------------------

describe('handleMfgCancelOrder', () => {
  it('replies ephemerally when order is not found', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => null) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1' });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("could not be found") }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when order is already terminal', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'cancelled' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1' });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when actor is not owner and not staff', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'outsider', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/permission/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies with "no longer be cancelled" when non-staff owner tries to cancel a terminal order', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'complete' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no longer be cancelled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when owner tries to cancel a processing order', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'processing' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no longer be cancelled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when owner tries to cancel a ready_for_pickup order', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'ready_for_pickup' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no longer be cancelled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when manufacturing is disabled', async () => {
    const h = await setupMocks({ manufacturingEnabled: false });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/not currently enabled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('succeeds when owner cancels their own new order', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.cancelOrderMock).toHaveBeenCalledWith(42, ['new', 'accepted']);
    expect(btn.editReply).toHaveBeenCalled();
  });

  it('succeeds when owner cancels their own accepted order', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'accepted' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.cancelOrderMock).toHaveBeenCalledWith(42, ['new', 'accepted']);
  });

  it('succeeds when staff cancels a processing order they do not own', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'processing' })) });
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'staff-1', roles: ['mfg-role'] });
    await h.handleMfgCancelOrder(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.cancelOrderMock).toHaveBeenCalledWith(42, ['new', 'accepted', 'processing', 'ready_for_pickup']);
  });

  it('posts a thread reply on successful cancel', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-cancel-order:42', { userId: 'owner-1', roles: [] });
    await h.handleMfgCancelOrder(btn as any);
    const thread = btn.channel as ReturnType<typeof makeThreadChannel>;
    expect(thread.send).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleMfgStaffCancel — staff cancel button
// ---------------------------------------------------------------------------

describe('handleMfgStaffCancel', () => {
  it('replies ephemerally when actor is not staff', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-staff-cancel:42', { userId: 'outsider', roles: [] });
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/permission/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when order is not found', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => null) });
    const btn = makeButtonInteraction('mfg-staff-cancel:42');
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("could not be found") }));
  });

  it('replies ephemerally when order is already terminal', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'complete' })) });
    const btn = makeButtonInteraction('mfg-staff-cancel:42');
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when manufacturing is disabled', async () => {
    const h = await setupMocks({ manufacturingEnabled: false });
    const btn = makeButtonInteraction('mfg-staff-cancel:42');
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/not currently enabled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('succeeds when staff cancels a non-terminal order', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'processing' })) });
    const btn = makeButtonInteraction('mfg-staff-cancel:42');
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.cancelOrderMock).toHaveBeenCalledWith(42, ['new', 'accepted', 'processing', 'ready_for_pickup']);
    expect(btn.editReply).toHaveBeenCalled();
  });

  it('allows admin without mfg role to cancel', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-staff-cancel:42', { userId: 'admin-1', roles: [], isAdmin: true });
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.cancelOrderMock).toHaveBeenCalledWith(42, ['new', 'accepted', 'processing', 'ready_for_pickup']);
  });
});

// ---------------------------------------------------------------------------
// handleMfgAdvance — staff status-advance buttons
// ---------------------------------------------------------------------------

describe('handleMfgAdvance', () => {
  it('replies ephemerally when manufacturing is disabled', async () => {
    const h = await setupMocks({ manufacturingEnabled: false });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/not currently enabled/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when customId has no colon', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order-no-colon');
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Invalid action.' }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when actor is not staff', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order:42', { userId: 'outsider', roles: [] });
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/permission/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when order is not found', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => null) });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('could not be found') }));
  });

  it('replies ephemerally when the transition is invalid for the current status', async () => {
    // Order is already accepted — trying to accept again is invalid
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'accepted' })) });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    // Message uses STATUS_LABEL values, not raw keys
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/✅ Accepted.*cannot be moved/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('accepts a new order (new → accepted)', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.transitionStatusMock).toHaveBeenCalledWith(42, 'new', 'accepted');
    expect(btn.editReply).toHaveBeenCalled();
  });

  it('starts processing an accepted order (accepted → processing)', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'accepted' })) });
    const btn = makeButtonInteraction('mfg-start-processing:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.transitionStatusMock).toHaveBeenCalledWith(42, 'accepted', 'processing');
  });

  it('marks processing order ready for pickup (processing → ready_for_pickup)', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'processing' })) });
    const btn = makeButtonInteraction('mfg-ready-for-pickup:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.transitionStatusMock).toHaveBeenCalledWith(42, 'processing', 'ready_for_pickup');
  });

  it('marks ready_for_pickup order complete (ready_for_pickup → complete)', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'ready_for_pickup' })) });
    const btn = makeButtonInteraction('mfg-mark-complete:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(h.transitionStatusMock).toHaveBeenCalledWith(42, 'ready_for_pickup', 'complete');
  });

  it('replies ephemerally when order is already terminal (complete)', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'complete' })) });
    const btn = makeButtonInteraction('mfg-mark-complete:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('replies ephemerally when order is already terminal (cancelled)', async () => {
    const h = await setupMocks({ findById: jest.fn(async () => makeOrder({ status: 'cancelled' })) });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already/i) }));
    expect(btn.deferUpdate).not.toHaveBeenCalled();
  });

  it('uses transitionStatus (not updateStatus) for advance actions', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(h.transitionStatusMock).toHaveBeenCalledWith(42, 'new', 'accepted');
    expect(h.updateStatusMock).not.toHaveBeenCalled();
  });

  it('replies with followUp when concurrent modification is detected (non-terminal)', async () => {
    const { InvalidStatusTransitionError } = await import('../../domain/manufacturing/types.js');
    const h = await setupMocks({
      transitionStatus: jest.fn(async () => { throw new InvalidStatusTransitionError('processing', 'accepted'); }),
    });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(btn.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already updated/i) }));
    expect(btn.editReply).not.toHaveBeenCalled();
  });

  it('replies with terminal message when order became terminal during concurrent advance', async () => {
    const { InvalidStatusTransitionError } = await import('../../domain/manufacturing/types.js');
    const h = await setupMocks({
      transitionStatus: jest.fn(async () => { throw new InvalidStatusTransitionError('cancelled', 'accepted'); }),
    });
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(btn.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already cancelled/i) }));
    expect(btn.editReply).not.toHaveBeenCalled();
  });

  it('replies with terminal message when order became terminal during concurrent staff cancel', async () => {
    const { InvalidStatusTransitionError } = await import('../../domain/manufacturing/types.js');
    const h = await setupMocks({
      cancelOrder: jest.fn(async () => { throw new InvalidStatusTransitionError('complete', 'cancelled'); }),
    });
    const btn = makeButtonInteraction('mfg-staff-cancel:42');
    await h.handleMfgStaffCancel(btn as any);
    expect(btn.deferUpdate).toHaveBeenCalled();
    expect(btn.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already complete/i) }));
    expect(btn.editReply).not.toHaveBeenCalled();
  });

  it('posts a thread reply on successful advance', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    const thread = btn.channel as ReturnType<typeof makeThreadChannel>;
    expect(thread.send).toHaveBeenCalled();
  });

  it('updates applied tags on successful advance', async () => {
    const h = await setupMocks();
    const btn = makeButtonInteraction('mfg-accept-order:42');
    await h.handleMfgAdvance(btn as any);
    const thread = btn.channel as ReturnType<typeof makeThreadChannel>;
    expect(thread.setAppliedTags).toHaveBeenCalledWith(['t-accepted']);
  });
});
