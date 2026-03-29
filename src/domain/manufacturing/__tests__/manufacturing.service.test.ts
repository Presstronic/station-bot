import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ManufacturingOrder } from '../types.js';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2024-06-01T00:00:00.000Z';

function makeOrder(overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder {
  return {
    id: 1,
    discordUserId: 'user-1',
    discordUsername: 'User#1234',
    forumThreadId: null,
    status: 'new',
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
    ...overrides,
  };
}

function makeRepoMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    create: jest.fn<() => Promise<ManufacturingOrder>>(),
    findById: jest.fn<() => Promise<ManufacturingOrder | null>>(),
    findByUserId: jest.fn<() => Promise<ManufacturingOrder[]>>(),
    countActiveByUserId: jest.fn<() => Promise<number>>(),
    updateStatus: jest.fn<() => Promise<ManufacturingOrder>>(),
    updateForumThreadId: jest.fn<() => Promise<void>>(),
    findByForumThreadId: jest.fn<() => Promise<ManufacturingOrder | null>>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// submitOrder
// ---------------------------------------------------------------------------

describe('submitOrder', () => {
  it('throws OrderLimitExceededError when the active order limit is reached', async () => {
    const repo = makeRepoMock({
      countActiveByUserId: jest.fn<() => Promise<number>>().mockResolvedValue(5),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { submitOrder } = await import('../manufacturing.service.js');
    const { OrderLimitExceededError } = await import('../types.js');

    await expect(submitOrder('user-1', 'User#1234', [])).rejects.toBeInstanceOf(OrderLimitExceededError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates the order when under the active limit', async () => {
    const created = makeOrder();
    const repo = makeRepoMock({
      countActiveByUserId: jest.fn<() => Promise<number>>().mockResolvedValue(2),
      create: jest.fn<() => Promise<ManufacturingOrder>>().mockResolvedValue(created),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { submitOrder } = await import('../manufacturing.service.js');

    const result = await submitOrder('user-1', 'User#1234', []);
    expect(result).toBe(created);
    expect(repo.create).toHaveBeenCalledWith('user-1', 'User#1234', []);
  });

  it('creates the order when at zero active orders', async () => {
    const created = makeOrder();
    const repo = makeRepoMock({
      countActiveByUserId: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      create: jest.fn<() => Promise<ManufacturingOrder>>().mockResolvedValue(created),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { submitOrder } = await import('../manufacturing.service.js');
    const result = await submitOrder('user-1', 'User#1234', []);
    expect(result).toBe(created);
  });
});

// ---------------------------------------------------------------------------
// transitionStatus
// ---------------------------------------------------------------------------

describe('transitionStatus', () => {
  async function setupTransitionTest(currentStatus: ManufacturingOrder['status']) {
    const order = makeOrder({ status: currentStatus });
    const updated = makeOrder({ status: 'accepted' }); // placeholder — actual value set per test
    const repo = makeRepoMock({
      findById: jest.fn<() => Promise<ManufacturingOrder | null>>().mockResolvedValue(order),
      updateStatus: jest.fn<() => Promise<ManufacturingOrder>>().mockResolvedValue(updated),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { transitionStatus } = await import('../manufacturing.service.js');
    return { transitionStatus, repo };
  }

  it.each([
    ['new', 'accepted'],
    ['accepted', 'processing'],
    ['processing', 'ready_for_pickup'],
    ['ready_for_pickup', 'complete'],
    ['new', 'cancelled'],
    ['accepted', 'cancelled'],
    ['processing', 'cancelled'],
    ['ready_for_pickup', 'cancelled'],
  ] as [ManufacturingOrder['status'], ManufacturingOrder['status']][])(
    'allows valid transition %s → %s',
    async (from, to) => {
      const { transitionStatus, repo } = await setupTransitionTest(from);
      await transitionStatus(1, to);
      expect(repo.updateStatus).toHaveBeenCalledWith(1, to);
    },
  );

  it.each([
    ['new', 'processing'],
    ['new', 'ready_for_pickup'],
    ['new', 'complete'],
    ['accepted', 'ready_for_pickup'],
    ['accepted', 'complete'],
    ['processing', 'accepted'],
    ['processing', 'complete'],
    ['complete', 'cancelled'],
    ['cancelled', 'new'],
  ] as [ManufacturingOrder['status'], ManufacturingOrder['status']][])(
    'rejects invalid transition %s → %s',
    async (from, to) => {
      const { transitionStatus } = await setupTransitionTest(from);
      const { InvalidStatusTransitionError } = await import('../types.js');
      await expect(transitionStatus(1, to)).rejects.toBeInstanceOf(InvalidStatusTransitionError);
    },
  );

  it('throws OrderNotFoundError when the order does not exist', async () => {
    const repo = makeRepoMock({
      findById: jest.fn<() => Promise<ManufacturingOrder | null>>().mockResolvedValue(null),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { transitionStatus } = await import('../manufacturing.service.js');
    const { OrderNotFoundError } = await import('../types.js');

    await expect(transitionStatus(999, 'accepted')).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// cancelOrder
// ---------------------------------------------------------------------------

describe('cancelOrder', () => {
  async function setupCancelTest(orderOverrides: Partial<ManufacturingOrder> = {}) {
    const order = makeOrder(orderOverrides);
    const cancelled = makeOrder({ ...orderOverrides, status: 'cancelled' });
    const repo = makeRepoMock({
      findById: jest.fn<() => Promise<ManufacturingOrder | null>>().mockResolvedValue(order),
      updateStatus: jest.fn<() => Promise<ManufacturingOrder>>().mockResolvedValue(cancelled),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { cancelOrder } = await import('../manufacturing.service.js');
    return { cancelOrder, repo };
  }

  it('member cancels their own new order', async () => {
    const { cancelOrder, repo } = await setupCancelTest({ status: 'new', discordUserId: 'user-1' });
    await cancelOrder(1, 'user-1', false);
    expect(repo.updateStatus).toHaveBeenCalledWith(1, 'cancelled');
  });

  it('member cancels their own accepted order', async () => {
    const { cancelOrder, repo } = await setupCancelTest({ status: 'accepted', discordUserId: 'user-1' });
    await cancelOrder(1, 'user-1', false);
    expect(repo.updateStatus).toHaveBeenCalledWith(1, 'cancelled');
  });

  it('member cannot cancel an order in processing status', async () => {
    const { cancelOrder } = await setupCancelTest({ status: 'processing', discordUserId: 'user-1' });
    const { OrderCancelForbiddenError } = await import('../types.js');
    await expect(cancelOrder(1, 'user-1', false)).rejects.toBeInstanceOf(OrderCancelForbiddenError);
  });

  it('member cannot cancel a ready_for_pickup order', async () => {
    const { cancelOrder } = await setupCancelTest({ status: 'ready_for_pickup', discordUserId: 'user-1' });
    const { OrderCancelForbiddenError } = await import('../types.js');
    await expect(cancelOrder(1, 'user-1', false)).rejects.toBeInstanceOf(OrderCancelForbiddenError);
  });

  it('member cannot cancel another user\'s order', async () => {
    const { cancelOrder } = await setupCancelTest({ status: 'new', discordUserId: 'user-1' });
    const { OrderCancelForbiddenError } = await import('../types.js');
    await expect(cancelOrder(1, 'user-other', false)).rejects.toBeInstanceOf(OrderCancelForbiddenError);
  });

  it('staff can cancel a new order', async () => {
    const { cancelOrder, repo } = await setupCancelTest({ status: 'new', discordUserId: 'user-1' });
    await cancelOrder(1, 'staff-user', true);
    expect(repo.updateStatus).toHaveBeenCalledWith(1, 'cancelled');
  });

  it('staff can cancel a processing order', async () => {
    const { cancelOrder, repo } = await setupCancelTest({ status: 'processing', discordUserId: 'user-1' });
    await cancelOrder(1, 'staff-user', true);
    expect(repo.updateStatus).toHaveBeenCalledWith(1, 'cancelled');
  });

  it('staff can cancel a ready_for_pickup order', async () => {
    const { cancelOrder, repo } = await setupCancelTest({ status: 'ready_for_pickup', discordUserId: 'user-1' });
    await cancelOrder(1, 'staff-user', true);
    expect(repo.updateStatus).toHaveBeenCalledWith(1, 'cancelled');
  });

  it('throws InvalidStatusTransitionError when cancelling a complete order', async () => {
    const { cancelOrder } = await setupCancelTest({ status: 'complete', discordUserId: 'user-1' });
    const { InvalidStatusTransitionError } = await import('../types.js');
    await expect(cancelOrder(1, 'staff-user', true)).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it('throws InvalidStatusTransitionError when cancelling an already cancelled order', async () => {
    const { cancelOrder } = await setupCancelTest({ status: 'cancelled', discordUserId: 'user-1' });
    const { InvalidStatusTransitionError } = await import('../types.js');
    await expect(cancelOrder(1, 'staff-user', true)).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it('throws OrderNotFoundError when the order does not exist', async () => {
    const repo = makeRepoMock({
      findById: jest.fn<() => Promise<ManufacturingOrder | null>>().mockResolvedValue(null),
    });

    jest.unstable_mockModule('../manufacturing.repository.js', () => repo);
    jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
      getManufacturingConfig: () => ({ orderLimit: 5, maxItemsPerOrder: 10, forumChannelId: '', manufacturingRoleId: '', organizationMemberRoleId: '' }),
      isManufacturingEnabled: () => true,
      validateManufacturingConfig: () => [],
    }));

    const { cancelOrder } = await import('../manufacturing.service.js');
    const { OrderNotFoundError } = await import('../types.js');

    await expect(cancelOrder(999, 'user-1', false)).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});
