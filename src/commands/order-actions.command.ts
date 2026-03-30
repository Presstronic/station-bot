import {
  ButtonInteraction,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMemberRoleManager,
  type ThreadChannel,
} from 'discord.js';
import { getManufacturingConfig } from '../config/manufacturing.config.js';
import {
  findById,
  transitionStatus,
} from '../domain/manufacturing/manufacturing.repository.js';
import {
  buildForumPostComponents,
  ensureForumTags,
  formatOrderPost,
  formatTransitionReply,
  STATUS_LABEL,
  STATUS_TO_TAG,
  MFG_ACCEPT_ORDER_PREFIX,
  MFG_START_PROCESSING_PREFIX,
  MFG_READY_FOR_PICKUP_PREFIX,
  MFG_MARK_COMPLETE_PREFIX,
} from '../domain/manufacturing/manufacturing.forum.js';
import { VALID_TRANSITIONS, TERMINAL_STATUSES, InvalidStatusTransitionError, type ManufacturingOrder, type OrderStatus } from '../domain/manufacturing/types.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

function parseOrderId(customId: string): number | null {
  const colonIdx = customId.indexOf(':');
  if (colonIdx === -1) return null;
  const id = parseInt(customId.slice(colonIdx + 1), 10);
  return isNaN(id) ? null : id;
}

function hasMfgStaffRole(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const { manufacturingRoleId } = getManufacturingConfig();
  if (!manufacturingRoleId) return false;
  const member = interaction.member;
  if (!member) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roles.includes(manufacturingRoleId);
  return (roles as GuildMemberRoleManager).cache.has(manufacturingRoleId);
}

async function applyPostTransition(
  interaction: ButtonInteraction,
  updatedOrder: ManufacturingOrder,
  toStatus: OrderStatus,
): Promise<void> {
  const thread = interaction.channel as ThreadChannel;

  // Update forum post content and buttons
  try {
    await interaction.editReply({
      content: formatOrderPost(updatedOrder),
      components: buildForumPostComponents(updatedOrder.id, updatedOrder.status),
      allowedMentions: { users: [updatedOrder.discordUserId] },
    });
  } catch (err) {
    logger.error('[manufacturing] Failed to edit forum post after status transition', {
      orderId: updatedOrder.id,
      toStatus,
      error: err,
    });
    await interaction
      .followUp({
        content: 'Status updated in the database, but the forum post could not be refreshed. Please contact staff.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }

  // Swap forum thread tag — non-fatal if it fails
  try {
    const parent = thread.parent;
    if (parent && parent.type === ChannelType.GuildForum) {
      const tagMap = await ensureForumTags(parent as any);
      const tagId = tagMap.get(STATUS_TO_TAG[toStatus]);
      await thread.setAppliedTags(tagId ? [tagId] : []);
    }
  } catch (err) {
    logger.error('[manufacturing] Failed to update forum thread tag after status transition', {
      orderId: updatedOrder.id,
      toStatus,
      error: err,
    });
  }

  // Post thread reply — non-fatal if it fails
  try {
    await thread.send({
      content: formatTransitionReply(toStatus, interaction.user.id),
      allowedMentions: { users: [updatedOrder.discordUserId, interaction.user.id] },
    });
  } catch (err) {
    logger.error('[manufacturing] Failed to post thread reply after status transition', {
      orderId: updatedOrder.id,
      toStatus,
      error: err,
    });
  }
}

async function applyTransition(
  interaction: ButtonInteraction,
  orderId: number,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
): Promise<void> {
  try {
    const updatedOrder = await transitionStatus(orderId, fromStatus, toStatus);
    await applyPostTransition(interaction, updatedOrder, toStatus);
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      await interaction
        .followUp({
          content: 'This order was already updated by another action. Please refresh to see the current status.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
    logger.error('[manufacturing] Failed to apply status transition', {
      orderId,
      toStatus,
      error: err,
    });
    await interaction
      .followUp({
        content: 'An error occurred while updating the order status. Please contact staff.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// handleMfgCancelOrder — member "🚫 Cancel Order" button (ISSUE-243)
// ---------------------------------------------------------------------------

export async function handleMfgCancelOrder(interaction: ButtonInteraction): Promise<void> {
  const orderId = parseOrderId(interaction.customId);
  if (orderId === null) {
    await interaction.reply({ content: 'Invalid order reference.', flags: MessageFlags.Ephemeral });
    return;
  }

  const order = await findById(orderId);
  if (!order) {
    await interaction.reply({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (TERMINAL_STATUSES.includes(order.status)) {
    await interaction.reply({
      content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isStaff = hasMfgStaffRole(interaction);
  const isOwner = order.discordUserId === interaction.user.id;

  if (!isOwner && !isStaff) {
    await interaction.reply({
      content: 'You do not have permission to cancel this order.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isOwner && !isStaff && (order.status === 'processing' || order.status === 'ready_for_pickup')) {
    await interaction.reply({
      content: 'This order can no longer be cancelled. Please contact the manufacturing team.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  await applyTransition(interaction, orderId, order.status, 'cancelled');
}

// ---------------------------------------------------------------------------
// handleMfgStaffCancel — staff "🚫 Cancel" button (ISSUE-242/243)
// ---------------------------------------------------------------------------

export async function handleMfgStaffCancel(interaction: ButtonInteraction): Promise<void> {
  const orderId = parseOrderId(interaction.customId);
  if (orderId === null) {
    await interaction.reply({ content: 'Invalid order reference.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!hasMfgStaffRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const order = await findById(orderId);
  if (!order) {
    await interaction.reply({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (TERMINAL_STATUSES.includes(order.status)) {
    await interaction.reply({
      content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  await applyTransition(interaction, orderId, order.status, 'cancelled');
}

// ---------------------------------------------------------------------------
// handleMfgAdvance — staff status-advance buttons (ISSUE-242)
// ---------------------------------------------------------------------------

const ADVANCE_TARGET: Record<string, OrderStatus> = {
  [MFG_ACCEPT_ORDER_PREFIX]: 'accepted',
  [MFG_START_PROCESSING_PREFIX]: 'processing',
  [MFG_READY_FOR_PICKUP_PREFIX]: 'ready_for_pickup',
  [MFG_MARK_COMPLETE_PREFIX]: 'complete',
};

export async function handleMfgAdvance(interaction: ButtonInteraction): Promise<void> {
  const colonIdx = interaction.customId.indexOf(':');

  if (colonIdx === -1) {
    logger.debug(`[manufacturing] Malformed advance customId (no colon): ${interaction.customId}`);
    await interaction.reply({ content: 'Invalid action.', flags: MessageFlags.Ephemeral });
    return;
  }

  const prefix = interaction.customId.slice(0, colonIdx);
  const toStatus = ADVANCE_TARGET[prefix];

  if (!toStatus) {
    logger.debug(`[manufacturing] Unrecognised advance prefix: ${prefix}`);
    await interaction.reply({ content: 'Invalid action.', flags: MessageFlags.Ephemeral });
    return;
  }

  const orderId = parseOrderId(interaction.customId);
  if (orderId === null) {
    await interaction.reply({ content: 'Invalid order reference.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!hasMfgStaffRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const order = await findById(orderId);
  if (!order) {
    await interaction.reply({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (TERMINAL_STATUSES.includes(order.status)) {
    await interaction.reply({
      content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!VALID_TRANSITIONS[order.status].includes(toStatus)) {
    await interaction.reply({
      content: `This order is in **${STATUS_LABEL[order.status]}** status and cannot be moved to **${STATUS_LABEL[toStatus]}** from here.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  let updatedOrder;
  try {
    updatedOrder = await transitionStatus(orderId, order.status, toStatus);
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      await interaction
        .followUp({
          content: 'This order was already updated by another action. Please refresh to see the current status.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
    logger.error('[manufacturing] Failed to transition order status after deferUpdate', {
      orderId,
      fromStatus: order.status,
      toStatus,
      error: err,
    });
    await interaction
      .followUp({
        content: 'An unexpected error occurred while updating this order. Please try again or contact staff.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await applyPostTransition(interaction, updatedOrder, toStatus);
}

