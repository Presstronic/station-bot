import { describe, expect, it, jest } from '@jest/globals';
import { formatOrderPost, buildForumPostComponents, ensureForumTags, MFG_CANCEL_ORDER_PREFIX, MFG_ACCEPT_ORDER_PREFIX, MFG_STAFF_CANCEL_PREFIX } from '../manufacturing.forum.js';
import type { ManufacturingOrder } from '../types.js';

function makeOrder(overrides: Partial<ManufacturingOrder> = {}): ManufacturingOrder {
  return {
    id: 7,
    discordUserId: 'uid-1',
    discordUsername: 'TestUser',
    forumThreadId: null,
    status: 'new',
    createdAt: '2024-06-15T00:00:00.000Z',
    updatedAt: '2024-06-15T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatOrderPost
// ---------------------------------------------------------------------------

describe('formatOrderPost', () => {
  it('includes order ID, user mention, items, priority stat, note, status, and date', () => {
    const order = makeOrder({
      items: [
        {
          id: 1,
          orderId: 7,
          itemName: 'Steel Plate',
          quantity: 5,
          priorityStat: 'Ballistic resistance',
          note: 'rush',
          sortOrder: 0,
        },
      ],
    });

    const post = formatOrderPost(order);

    expect(post).toContain('📦 Order #7 — <@uid-1>');
    expect(post).toContain('1. Steel Plate × 5');
    expect(post).toContain('⭐ Priority Stat: Ballistic resistance');
    expect(post).toContain('↳ rush');
    expect(post).toContain('Status: 🆕 New');
    expect(post).toContain('Submitted: 2024-06-15');
  });

  it('omits the note line when note is null', () => {
    const order = makeOrder({
      items: [
        {
          id: 1,
          orderId: 7,
          itemName: 'Iron Rod',
          quantity: 2,
          priorityStat: 'EM resistance',
          note: null,
          sortOrder: 0,
        },
      ],
    });

    expect(formatOrderPost(order)).not.toContain('↳');
  });

  it('renders the correct label for each order status', () => {
    const cases: [import('../types.js').OrderStatus, string][] = [
      ['new', '🆕 New'],
      ['accepted', '✅ Accepted'],
      ['processing', '⚙️ Processing'],
      ['ready_for_pickup', '📬 Ready for Pickup'],
      ['complete', '✔️ Complete'],
      ['cancelled', '🚫 Cancelled'],
    ];
    for (const [status, label] of cases) {
      expect(formatOrderPost(makeOrder({ status }))).toContain(`Status: ${label}`);
    }
  });

  it('numbers multiple items sequentially', () => {
    const order = makeOrder({
      items: [
        { id: 1, orderId: 7, itemName: 'Item A', quantity: 1, priorityStat: 'X', note: null, sortOrder: 0 },
        { id: 2, orderId: 7, itemName: 'Item B', quantity: 2, priorityStat: 'Y', note: null, sortOrder: 1 },
      ],
    });

    const post = formatOrderPost(order);

    expect(post).toContain('1. Item A × 1');
    expect(post).toContain('2. Item B × 2');
  });
});

// ---------------------------------------------------------------------------
// buildForumPostComponents
// ---------------------------------------------------------------------------

describe('buildForumPostComponents', () => {
  it('returns two action rows', () => {
    const rows = buildForumPostComponents(42);
    expect(rows).toHaveLength(2);
  });

  it('member row contains a cancel button with the correct customId', () => {
    const rows = buildForumPostComponents(42);
    const memberRow = rows[0];
    const cancelBtn = memberRow.components[0] as unknown as { data: { custom_id: string } };
    expect(cancelBtn.data.custom_id).toBe(`${MFG_CANCEL_ORDER_PREFIX}:42`);
  });

  it('staff row contains accept and cancel buttons with the correct customIds', () => {
    const rows = buildForumPostComponents(42);
    const staffRow = rows[1];
    const [acceptBtn, cancelBtn] = staffRow.components as unknown as { data: { custom_id: string } }[];
    expect(acceptBtn.data.custom_id).toBe(`${MFG_ACCEPT_ORDER_PREFIX}:42`);
    expect(cancelBtn.data.custom_id).toBe(`${MFG_STAFF_CANCEL_PREFIX}:42`);
  });
});

// ---------------------------------------------------------------------------
// ensureForumTags
// ---------------------------------------------------------------------------

describe('ensureForumTags', () => {
  it('returns existing tag map when all tags are already present', async () => {
    const channel = {
      availableTags: [
        { name: 'New', id: 't1' },
        { name: 'Accepted', id: 't2' },
        { name: 'Processing', id: 't3' },
        { name: 'Ready for Pickup', id: 't4' },
        { name: 'Complete', id: 't5' },
        { name: 'Cancelled', id: 't6' },
      ],
      setAvailableTags: jest.fn(),
    };

    const result = await ensureForumTags(channel as any);

    expect(channel.setAvailableTags).not.toHaveBeenCalled();
    expect(result.get('New')).toBe('t1');
    expect(result.get('Cancelled')).toBe('t6');
  });

  it('creates missing tags and returns the updated map', async () => {
    const existingTags = [{ name: 'New', id: 't1' }];
    const channel = {
      availableTags: existingTags,
      setAvailableTags: jest.fn(async (tags: { name: string }[]) => ({
        availableTags: tags.map((t, i) => ({ ...t, id: `new-id-${i}` })),
      })),
    };

    const result = await ensureForumTags(channel as any);

    expect(channel.setAvailableTags).toHaveBeenCalledTimes(1);
    const setArg = (channel.setAvailableTags as jest.Mock).mock.calls[0][0] as { name: string }[];
    expect(setArg.map((t) => t.name)).toContain('New');
    expect(setArg.map((t) => t.name)).toContain('Accepted');
    expect(result.size).toBe(6);
  });
});
