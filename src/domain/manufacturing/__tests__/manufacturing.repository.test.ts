import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2024-06-01T00:00:00.000Z';

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    discord_user_id: 'user-1',
    discord_username: 'User#1234',
    forum_thread_id: null,
    status: 'new',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    order_id: 1,
    item_name: 'Steel Plate',
    quantity: 5,
    priority_stat: 'Ballistic resistance',
    note: null,
    sort_order: 0,
    ...overrides,
  };
}

function makeWithClient(querySpy: jest.Mock) {
  return jest.fn(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
    fn({ query: querySpy }),
  );
}

function queryCalls(spy: jest.Mock): string[] {
  return (spy.mock.calls as [string, ...unknown[]][]).map((c) => String(c[0]));
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('create', () => {
  it('inserts order and items in a transaction and returns the assembled order', async () => {
    const orderRow = makeOrderRow();
    const itemRow = makeItemRow();

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [orderRow] })    // INSERT order RETURNING *
      .mockResolvedValueOnce({ rows: [] })            // INSERT item
      .mockResolvedValueOnce({ rows: [itemRow] })     // SELECT items
      .mockResolvedValueOnce({ rows: [] });           // COMMIT

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { create } = await import('../manufacturing.repository.js');
    const result = await create('user-1', 'User#1234', [
      { itemName: 'Steel Plate', quantity: 5, priorityStat: 'Ballistic resistance', note: null, sortOrder: 0 },
    ]);

    expect(result.id).toBe(1);
    expect(result.discordUserId).toBe('user-1');
    expect(result.status).toBe('new');
    expect(result.forumThreadId).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemName).toBe('Steel Plate');
    expect(result.items[0].priorityStat).toBe('Ballistic resistance');
    expect(result.items[0].note).toBeNull();

    const calls = queryCalls(query);
    expect(calls[0]).toMatch(/BEGIN/i);
    expect(calls[calls.length - 1]).toMatch(/COMMIT/i);
  });

  it('inserts multiple items in order', async () => {
    const orderRow = makeOrderRow();

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })                                  // BEGIN
      .mockResolvedValueOnce({ rows: [orderRow] })                          // INSERT order
      .mockResolvedValueOnce({ rows: [] })                                  // INSERT item 1
      .mockResolvedValueOnce({ rows: [] })                                  // INSERT item 2
      .mockResolvedValueOnce({ rows: [makeItemRow({ sort_order: 0 }), makeItemRow({ id: 11, sort_order: 1 })] }) // SELECT items
      .mockResolvedValueOnce({ rows: [] });                                 // COMMIT

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { create } = await import('../manufacturing.repository.js');
    await create('user-1', 'User#1234', [
      { itemName: 'Steel Plate', quantity: 5, priorityStat: 'Ballistic resistance', note: null, sortOrder: 0 },
      { itemName: 'Iron Rod', quantity: 2, priorityStat: 'EM resistance', note: 'rush', sortOrder: 1 },
    ]);

    const insertItemCalls = queryCalls(query).filter((q) => q.includes('manufacturing_order_items') && q.includes('INSERT'));
    expect(insertItemCalls).toHaveLength(2);
  });

  it('rolls back and rethrows on error', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })                    // BEGIN
      .mockRejectedValueOnce(new Error('DB failure'))         // INSERT order fails
      .mockResolvedValueOnce({ rows: [] });                   // ROLLBACK

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { create } = await import('../manufacturing.repository.js');
    await expect(create('user-1', 'User#1234', [])).rejects.toThrow('DB failure');

    const calls = queryCalls(query);
    expect(calls.some((q) => q.includes('ROLLBACK'))).toBe(true);
    expect(calls.some((q) => q.includes('COMMIT'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('findById', () => {
  it('returns the order with items when found', async () => {
    const orderRow = makeOrderRow({ forum_thread_id: 'thread-99' });
    const itemRow = makeItemRow({ note: 'urgent' });

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [orderRow] })  // SELECT order
      .mockResolvedValueOnce({ rows: [itemRow] });  // SELECT items

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findById } = await import('../manufacturing.repository.js');
    const result = await findById(1);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.forumThreadId).toBe('thread-99');
    expect(result!.items[0].note).toBe('urgent');
  });

  it('returns null when not found', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findById } = await import('../manufacturing.repository.js');
    expect(await findById(999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByUserId
// ---------------------------------------------------------------------------

describe('findByUserId', () => {
  it('returns orders with batched items', async () => {
    const orderRow1 = makeOrderRow({ id: 1 });
    const orderRow2 = makeOrderRow({ id: 2, status: 'accepted' });
    const itemRow = makeItemRow({ order_id: 1 });

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [orderRow1, orderRow2] })  // SELECT orders
      .mockResolvedValueOnce({ rows: [itemRow] });              // SELECT all items

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findByUserId } = await import('../manufacturing.repository.js');
    const results = await findByUserId('user-1');

    expect(results).toHaveLength(2);
    expect(results[0].items).toHaveLength(1);
    expect(results[1].items).toHaveLength(0);
  });

  it('returns empty array when user has no orders', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findByUserId } = await import('../manufacturing.repository.js');
    expect(await findByUserId('user-none')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// countActiveByUserId
// ---------------------------------------------------------------------------

describe('countActiveByUserId', () => {
  it('returns the active order count', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [{ active_count: 3 }] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { countActiveByUserId } = await import('../manufacturing.repository.js');
    expect(await countActiveByUserId('user-1')).toBe(3);
  });

  it('returns 0 when the user has no active orders', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [{ active_count: 0 }] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { countActiveByUserId } = await import('../manufacturing.repository.js');
    expect(await countActiveByUserId('user-1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
  it('returns the updated order with items', async () => {
    const updatedRow = makeOrderRow({ status: 'accepted' });

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [updatedRow] })  // UPDATE RETURNING *
      .mockResolvedValueOnce({ rows: [] });           // SELECT items

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { updateStatus } = await import('../manufacturing.repository.js');
    const result = await updateStatus(1, 'accepted');

    expect(result.status).toBe('accepted');
    expect(result.items).toEqual([]);
  });

  it('throws OrderNotFoundError when no row is updated', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });  // UPDATE returns nothing

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { updateStatus } = await import('../manufacturing.repository.js');
    const { OrderNotFoundError } = await import('../types.js');
    await expect(updateStatus(999, 'accepted')).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// updateForumThreadId
// ---------------------------------------------------------------------------

describe('updateForumThreadId', () => {
  it('executes an UPDATE without returning a value', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { updateForumThreadId } = await import('../manufacturing.repository.js');
    const result = await updateForumThreadId(1, 'thread-abc');

    expect(result).toBeUndefined();
    const calls = queryCalls(query);
    expect(calls[0]).toMatch(/forum_thread_id/);
  });

  it('throws OrderNotFoundError when no row is updated', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { updateForumThreadId } = await import('../manufacturing.repository.js');
    const { OrderNotFoundError } = await import('../types.js');
    await expect(updateForumThreadId(999, 'thread-abc')).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// findByForumThreadId
// ---------------------------------------------------------------------------

describe('findByForumThreadId', () => {
  it('returns the order with items when found', async () => {
    const orderRow = makeOrderRow({ forum_thread_id: 'thread-42' });
    const itemRow = makeItemRow();

    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [orderRow] })  // SELECT order
      .mockResolvedValueOnce({ rows: [itemRow] });  // SELECT items

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findByForumThreadId } = await import('../manufacturing.repository.js');
    const result = await findByForumThreadId('thread-42');

    expect(result).not.toBeNull();
    expect(result!.forumThreadId).toBe('thread-42');
    expect(result!.items).toHaveLength(1);
  });

  it('returns null when not found', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      withClient: makeWithClient(query),
    }));

    const { findByForumThreadId } = await import('../manufacturing.repository.js');
    expect(await findByForumThreadId('thread-none')).toBeNull();
  });
});
