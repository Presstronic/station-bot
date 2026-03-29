import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ForumChannel,
} from 'discord.js';
import type { ManufacturingOrder } from './types.js';

export const ORDER_STATUS_TAG_NAMES = [
  'New',
  'Accepted',
  'Processing',
  'Ready for Pickup',
  'Complete',
  'Cancelled',
] as const;

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
    'Status: 🆕 New',
    `Submitted: ${submittedDate}`,
    DIV,
  ].join('\n');
}

export const MFG_CANCEL_ORDER_PREFIX = 'mfg-cancel-order';
export const MFG_ACCEPT_ORDER_PREFIX = 'mfg-accept-order';
export const MFG_STAFF_CANCEL_PREFIX = 'mfg-staff-cancel';

export function buildForumPostComponents(orderId: number): ActionRowBuilder<ButtonBuilder>[] {
  const memberRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MFG_CANCEL_ORDER_PREFIX}:${orderId}`)
      .setLabel('🚫 Cancel Order')
      .setStyle(ButtonStyle.Danger),
  );

  const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MFG_ACCEPT_ORDER_PREFIX}:${orderId}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MFG_STAFF_CANCEL_PREFIX}:${orderId}`)
      .setLabel('🚫 Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return [memberRow, staffRow];
}
