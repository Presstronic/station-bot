import { withClient } from '../../services/nominations/db.js';
import { InvalidStatusTransitionError, OrderLimitExceededError, OrderNotFoundError } from './types.js';
import type { ManufacturingOrder, ManufacturingOrderItem, NewOrderItem, OrderStatus } from './types.js';

function mapItemRow(row: Record<string, unknown>): ManufacturingOrderItem {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    itemName: String(row.item_name),
    quantity: Number(row.quantity),
    priorityStat: String(row.priority_stat),
    note: row.note != null ? String(row.note) : null,
    sortOrder: Number(row.sort_order),
  };
}

function mapOrderRow(row: Record<string, unknown>, items: ManufacturingOrderItem[]): ManufacturingOrder {
  return {
    id: Number(row.id),
    discordUserId: String(row.discord_user_id),
    discordUsername: String(row.discord_username),
    forumThreadId: row.forum_thread_id != null ? String(row.forum_thread_id) : null,
    status: String(row.status) as OrderStatus,
    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | number | Date).toISOString(),
    items,
  };
}

export async function create(
  discordUserId: string,
  discordUsername: string,
  items: NewOrderItem[],
  orderLimit: number,
): Promise<ManufacturingOrder> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Serialize concurrent submits per user with a pg advisory lock so the
      // count check and insert are atomic (same pattern as nominations).
      await client.query(
        `SELECT pg_advisory_xact_lock(
          ('x' || left(md5('manufacturing_order:' || $1), 16))::bit(64)::bigint
        )`,
        [discordUserId],
      );

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS active_count
         FROM manufacturing_orders
         WHERE discord_user_id = $1
           AND status NOT IN ('complete', 'cancelled')`,
        [discordUserId],
      );
      if (Number((countResult.rows[0] as Record<string, unknown>).active_count) >= orderLimit) {
        throw new OrderLimitExceededError(orderLimit);
      }

      const orderResult = await client.query(
        `INSERT INTO manufacturing_orders (discord_user_id, discord_username)
         VALUES ($1, $2)
         RETURNING *`,
        [discordUserId, discordUsername],
      );
      const orderRow = orderResult.rows[0] as Record<string, unknown>;

      for (const item of items) {
        await client.query(
          `INSERT INTO manufacturing_order_items
             (order_id, item_name, quantity, priority_stat, note, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderRow.id, item.itemName, item.quantity, item.priorityStat, item.note ?? null, item.sortOrder],
        );
      }

      const itemsResult = await client.query(
        `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
        [orderRow.id],
      );

      const mapped = mapOrderRow(
        orderRow,
        (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
      );
      await client.query('COMMIT');
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function findById(id: number): Promise<ManufacturingOrder | null> {
  return withClient(async (client) => {
    const orderResult = await client.query(
      `SELECT * FROM manufacturing_orders WHERE id = $1`,
      [id],
    );

    if (orderResult.rows.length === 0) return null;

    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
      [id],
    );

    return mapOrderRow(
      orderResult.rows[0] as Record<string, unknown>,
      (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
    );
  });
}

export async function findByUserId(userId: string): Promise<ManufacturingOrder[]> {
  return withClient(async (client) => {
    const ordersResult = await client.query(
      `SELECT * FROM manufacturing_orders WHERE discord_user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );

    if (ordersResult.rows.length === 0) return [];

    const orderIds = (ordersResult.rows as Record<string, unknown>[]).map((row) => Number(row.id));
    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items
       WHERE order_id = ANY($1::int[])
       ORDER BY order_id, sort_order`,
      [orderIds],
    );

    const itemsByOrderId = new Map<number, ManufacturingOrderItem[]>();
    for (const row of itemsResult.rows as Record<string, unknown>[]) {
      const orderId = Number(row.order_id);
      const list = itemsByOrderId.get(orderId) ?? [];
      list.push(mapItemRow(row));
      itemsByOrderId.set(orderId, list);
    }

    return (ordersResult.rows as Record<string, unknown>[]).map((row) =>
      mapOrderRow(row, itemsByOrderId.get(Number(row.id)) ?? []),
    );
  });
}

export async function countActiveByUserId(userId: string): Promise<number> {
  const result = await withClient((client) =>
    client.query(
      `SELECT COUNT(*)::int AS active_count
       FROM manufacturing_orders
       WHERE discord_user_id = $1
         AND status NOT IN ('complete', 'cancelled')`,
      [userId],
    ),
  );
  return Number((result.rows[0] as Record<string, unknown>).active_count);
}

export async function updateStatus(id: number, status: OrderStatus): Promise<ManufacturingOrder> {
  return withClient(async (client) => {
    const orderResult = await client.query(
      `UPDATE manufacturing_orders
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );

    if (orderResult.rows.length === 0) throw new OrderNotFoundError(id);

    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
      [id],
    );

    return mapOrderRow(
      orderResult.rows[0] as Record<string, unknown>,
      (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
    );
  });
}

export async function transitionStatus(
  id: number,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
): Promise<ManufacturingOrder> {
  return withClient(async (client) => {
    const orderResult = await client.query(
      `UPDATE manufacturing_orders
       SET status = $3, updated_at = NOW()
       WHERE id = $1 AND status = $2
       RETURNING *`,
      [id, fromStatus, toStatus],
    );

    if (orderResult.rows.length === 0) {
      const existsResult = await client.query(
        `SELECT status FROM manufacturing_orders WHERE id = $1`,
        [id],
      );
      if (existsResult.rows.length === 0) throw new OrderNotFoundError(id);
      const currentStatus = String((existsResult.rows[0] as Record<string, unknown>).status) as OrderStatus;
      throw new InvalidStatusTransitionError(currentStatus, toStatus);
    }

    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
      [id],
    );

    return mapOrderRow(
      orderResult.rows[0] as Record<string, unknown>,
      (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
    );
  });
}

export async function updateForumThreadId(id: number, threadId: string): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query(
      `UPDATE manufacturing_orders
       SET forum_thread_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, threadId],
    );
    if ((result.rowCount ?? 0) === 0) throw new OrderNotFoundError(id);
  });
}

export async function cancelOrder(
  id: number,
  allowedFromStatuses: readonly OrderStatus[],
): Promise<ManufacturingOrder> {
  return withClient(async (client) => {
    const orderResult = await client.query(
      `UPDATE manufacturing_orders
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = ANY($2::text[])
       RETURNING *`,
      [id, allowedFromStatuses],
    );

    if (orderResult.rows.length === 0) {
      const existsResult = await client.query(
        `SELECT status FROM manufacturing_orders WHERE id = $1`,
        [id],
      );
      if (existsResult.rows.length === 0) throw new OrderNotFoundError(id);
      const currentStatus = String((existsResult.rows[0] as Record<string, unknown>).status) as OrderStatus;
      throw new InvalidStatusTransitionError(currentStatus, 'cancelled');
    }

    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
      [id],
    );

    return mapOrderRow(
      orderResult.rows[0] as Record<string, unknown>,
      (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
    );
  });
}

export async function findByForumThreadId(threadId: string): Promise<ManufacturingOrder | null> {
  return withClient(async (client) => {
    const orderResult = await client.query(
      `SELECT * FROM manufacturing_orders WHERE forum_thread_id = $1`,
      [threadId],
    );

    if (orderResult.rows.length === 0) return null;

    const orderId = Number((orderResult.rows[0] as Record<string, unknown>).id);
    const itemsResult = await client.query(
      `SELECT * FROM manufacturing_order_items WHERE order_id = $1 ORDER BY sort_order`,
      [orderId],
    );

    return mapOrderRow(
      orderResult.rows[0] as Record<string, unknown>,
      (itemsResult.rows as Record<string, unknown>[]).map(mapItemRow),
    );
  });
}
