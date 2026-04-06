import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ForumChannel,
} from 'discord.js';
import type { ManufacturingOrder, OrderStatus } from './types.js';

export const STATUS_TO_TAG: Record<OrderStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  processing: 'Processing',
  ready_for_pickup: 'Ready for Pickup',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_TAG_NAMES: readonly string[] = Object.values(STATUS_TO_TAG);

export async function ensureForumTags(channel: ForumChannel): Promise<Map<string, string>> {
  const existing = new Map(channel.availableTags.map((t) => [t.name, t.id]));
  const missing = ORDER_STATUS_TAG_NAMES.filter((name) => !existing.has(name));

  if (missing.length === 0) return existing;

  const updated = await channel.setAvailableTags([
    ...channel.availableTags,
    ...missing.map((name) => ({ name })),
  ]);

  return new Map(updated.availableTags.map((t) => [t.name, t.id]));
}

const DIV = '━━━━━━━━━━━━━━━━━━';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: '🆕 New',
  accepted: '✅ Accepted',
  processing: '⚙️ Processing',
  ready_for_pickup: '📬 Ready for Pickup',
  complete: '✔️ Complete',
  cancelled: '🚫 Cancelled',
};

export function formatOrderPost(order: ManufacturingOrder): string {
  const itemLines = order.items.flatMap((item, i) => {
    const lines: string[] = [
      `${i + 1}. ${item.itemName} × ${item.quantity}`,
      `   ⭐ Priority Stat: ${item.priorityStat}`,
    ];
    if (item.note) lines.push(`   ↳ ${item.note}`);
    return lines;
  });

  const submittedDate = order.createdAt.substring(0, 10);

  return [
    `📦 Order #${order.id} — <@${order.discordUserId}>`,
    '',
    DIV,
    'ITEMS',
    DIV,
    ...itemLines,
    DIV,
    `Status: ${STATUS_LABEL[order.status]}`,
    `Submitted: ${submittedDate}`,
    DIV,
  ].join('\n');
}

export function formatTransitionReply(newStatus: OrderStatus, actorId: string): string {
  const date = new Date().toISOString().substring(0, 10);
  if (newStatus === 'cancelled') {
    return `🚫 Order cancelled by <@${actorId}> — ${date}`;
  }
  return `📋 Status updated to **${STATUS_LABEL[newStatus]}** by <@${actorId}> — ${date}`;
}

export const MFG_CREATE_ORDER_PREFIX = 'mfg-create-order';
export const MFG_CANCEL_ORDER_PREFIX = 'mfg-cancel-order';
export const MFG_ACCEPT_ORDER_PREFIX = 'mfg-accept-order';
export const MFG_STAFF_CANCEL_PREFIX = 'mfg-staff-cancel';
export const MFG_START_PROCESSING_PREFIX = 'mfg-start-processing';
export const MFG_READY_FOR_PICKUP_PREFIX = 'mfg-ready-for-pickup';
export const MFG_MARK_COMPLETE_PREFIX = 'mfg-mark-complete';

function buildAdvanceButton(orderId: number, status: OrderStatus): ButtonBuilder {
  switch (status) {
    case 'new':
      return new ButtonBuilder()
        .setCustomId(`${MFG_ACCEPT_ORDER_PREFIX}:${orderId}`)
        .setLabel('✅ Accept')
        .setStyle(ButtonStyle.Success);
    case 'accepted':
      return new ButtonBuilder()
        .setCustomId(`${MFG_START_PROCESSING_PREFIX}:${orderId}`)
        .setLabel('⚙️ Start Processing')
        .setStyle(ButtonStyle.Primary);
    case 'processing':
      return new ButtonBuilder()
        .setCustomId(`${MFG_READY_FOR_PICKUP_PREFIX}:${orderId}`)
        .setLabel('📦 Ready for Pickup')
        .setStyle(ButtonStyle.Primary);
    case 'ready_for_pickup':
      return new ButtonBuilder()
        .setCustomId(`${MFG_MARK_COMPLETE_PREFIX}:${orderId}`)
        .setLabel('✔️ Mark Complete')
        .setStyle(ButtonStyle.Success);
    default:
      throw new Error(`No advance button for terminal status: ${status}`);
  }
}

export function buildForumPostComponents(orderId: number, status: OrderStatus): ActionRowBuilder<ButtonBuilder>[] {
  if (status === 'complete' || status === 'cancelled') return [];

  const memberRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MFG_CANCEL_ORDER_PREFIX}:${orderId}`)
      .setLabel('🚫 Cancel Order')
      .setStyle(ButtonStyle.Danger),
  );

  const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildAdvanceButton(orderId, status),
    new ButtonBuilder()
      .setCustomId(`${MFG_STAFF_CANCEL_PREFIX}:${orderId}`)
      .setLabel('🚫 Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return [memberRow, staffRow];
}
