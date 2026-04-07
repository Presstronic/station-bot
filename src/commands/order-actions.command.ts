import {
  ButtonInteraction,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ForumChannel,
  type GuildMemberRoleManager,
  type ThreadChannel,
} from 'discord.js';
import { getManufacturingConfig, isManufacturingEnabled } from '../config/manufacturing.config.js';
import {
  cancelOrder,
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
  const { staffChannelId } = getManufacturingConfig();

  // Determine whether the button was clicked from the staff thread or the public thread.
  // Advance/cancel buttons live in the staff thread, so interactions normally originate there.
  //
  // staffThreadId persistence is non-fatal, so we can't rely on it alone — the thread may
  // exist but staffThreadId may still be null.  Priority of checks:
  //   1. Live context: thread.parentId matches the configured staff forum channel
  //   2. Persisted match: channelId matches the stored staffThreadId
  //   3. Tiebreaker: interaction is not in the known public thread (treat as staff)
  const isThreadChannel =
    interaction.channel?.type === ChannelType.PublicThread ||
    interaction.channel?.type === ChannelType.PrivateThread;
  const isInConfiguredStaffForumThread =
    isThreadChannel && staffChannelId !== null && thread.parentId === staffChannelId;
  const isInPersistedStaffThread =
    updatedOrder.staffThreadId !== null && interaction.channelId === updatedOrder.staffThreadId;
  const isInPersistedMemberThread = interaction.channelId === updatedOrder.forumThreadId;
  const isInStaffThread =
    isInConfiguredStaffForumThread || isInPersistedStaffThread || !isInPersistedMemberThread;

  const interactionTarget: 'member' | 'staff' = isInStaffThread ? 'staff' : 'member';
  const counterpartThreadId = isInStaffThread ? updatedOrder.forumThreadId : updatedOrder.staffThreadId;
  const counterpartTarget: 'member' | 'staff' = isInStaffThread ? 'member' : 'staff';

  // Update the post in the interaction's own thread
  try {
    await interaction.editReply({
      content: formatOrderPost(updatedOrder),
      components: buildForumPostComponents(updatedOrder.id, updatedOrder.status, interactionTarget),
      allowedMentions: { users: isInStaffThread ? [] : [updatedOrder.discordUserId] },
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

  // Swap forum thread tag on the interaction's thread — non-fatal if it fails
  try {
    const parent = thread.parent;
    if (parent && parent.type === ChannelType.GuildForum) {
      const tagMap = await ensureForumTags(parent as ForumChannel);
      const tagId = tagMap.get(STATUS_TO_TAG[toStatus]);
      if (!tagId) {
        logger.warn('[manufacturing] Status tag not found; skipping forum thread tag update', {
          orderId: updatedOrder.id,
          toStatus,
        });
      } else {
        await thread.setAppliedTags([tagId]);
      }
    }
  } catch (err) {
    logger.error('[manufacturing] Failed to update forum thread tag after status transition', {
      orderId: updatedOrder.id,
      toStatus,
      error: err,
    });
  }

  // Post thread reply — non-fatal if it fails
  // Suppress the member ping when replying from the staff thread (they don't have access).
  try {
    await thread.send({
      content: formatTransitionReply(toStatus, interaction.user.id),
      allowedMentions: {
        parse: [],
        users: isInStaffThread ? [interaction.user.id] : [...new Set([updatedOrder.discordUserId, interaction.user.id])],
      },
    });
  } catch (err) {
    logger.error('[manufacturing] Failed to post thread reply after status transition', {
      orderId: updatedOrder.id,
      toStatus,
      error: err,
    });
  }

  // Sync the counterpart thread — non-fatal if it fails
  if (counterpartThreadId) {
    try {
      const counterpartThread = await interaction.client.channels.fetch(counterpartThreadId) as ThreadChannel | null;
      if (counterpartThread?.isThread()) {
        const starterMessage = await counterpartThread.fetchStarterMessage();
        if (starterMessage) {
          await starterMessage.edit({
            content: formatOrderPost(updatedOrder),
            components: buildForumPostComponents(updatedOrder.id, updatedOrder.status, counterpartTarget),
            allowedMentions: { parse: [], users: counterpartTarget === 'staff' ? [] : [updatedOrder.discordUserId] },
          });
        }
        const counterpartParent = counterpartThread.parent;
        if (counterpartParent && counterpartParent.type === ChannelType.GuildForum) {
          const counterpartTagMap = await ensureForumTags(counterpartParent as ForumChannel);
          const counterpartTagId = counterpartTagMap.get(STATUS_TO_TAG[toStatus]);
          if (counterpartTagId) await counterpartThread.setAppliedTags([counterpartTagId]);
        }
      }
    } catch (err) {
      logger.error('[manufacturing] Failed to sync counterpart thread after status transition', {
        orderId: updatedOrder.id,
        toStatus,
        error: err,
      });
    }
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
      const content = TERMINAL_STATUSES.includes(err.from)
        ? `This order is already ${err.from === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`
        : 'This order was already updated by another action. Please refresh to see the current status.';
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
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

async function applyCancellation(
  interaction: ButtonInteraction,
  orderId: number,
  allowedFromStatuses: readonly OrderStatus[],
): Promise<void> {
  try {
    const updatedOrder = await cancelOrder(orderId, allowedFromStatuses);
    await applyPostTransition(interaction, updatedOrder, 'cancelled');
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      const content = TERMINAL_STATUSES.includes(err.from)
        ? `This order is already ${err.from === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`
        : !allowedFromStatuses.includes(err.from)
          ? 'This order can no longer be cancelled. Please contact the manufacturing team.'
          : 'This order was already updated by another action. Please refresh to see the current status.';
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    logger.error('[manufacturing] Failed to apply cancellation', {
      orderId,
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
  if (!isManufacturingEnabled()) {
    await interaction.reply({ content: 'Manufacturing is not currently enabled.', flags: MessageFlags.Ephemeral });
    return;
  }

  const orderId = parseOrderId(interaction.customId);
  if (orderId === null) {
    await interaction.reply({ content: 'Invalid order reference.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const order = await findById(orderId);
  if (!order) {
    await interaction.followUp({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  const isStaff = hasMfgStaffRole(interaction);
  const isOwner = order.discordUserId === interaction.user.id;

  if (!isOwner && !isStaff) {
    await interaction.followUp({
      content: 'You do not have permission to cancel this order.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isOwner && !isStaff) {
    // Non-staff members may only cancel orders that haven't entered production
    if (order.status !== 'new' && order.status !== 'accepted') {
      await interaction.followUp({
        content: 'This order can no longer be cancelled. Please contact the manufacturing team.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    // Staff may only cancel non-terminal orders
    if (TERMINAL_STATUSES.includes(order.status)) {
      await interaction.followUp({
        content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const allowedFromStatuses: readonly OrderStatus[] = isStaff
    ? ['new', 'accepted', 'processing', 'ready_for_pickup']
    : ['new', 'accepted'];
  await applyCancellation(interaction, orderId, allowedFromStatuses);
}

// ---------------------------------------------------------------------------
// handleMfgStaffCancel — staff "🚫 Cancel" button (ISSUE-242/243)
// ---------------------------------------------------------------------------

export async function handleMfgStaffCancel(interaction: ButtonInteraction): Promise<void> {
  if (!isManufacturingEnabled()) {
    await interaction.reply({ content: 'Manufacturing is not currently enabled.', flags: MessageFlags.Ephemeral });
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

  await interaction.deferUpdate();

  const order = await findById(orderId);
  if (!order) {
    await interaction.followUp({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (TERMINAL_STATUSES.includes(order.status)) {
    await interaction.followUp({
      content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await applyCancellation(interaction, orderId, ['new', 'accepted', 'processing', 'ready_for_pickup']);
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
  if (!isManufacturingEnabled()) {
    await interaction.reply({ content: 'Manufacturing is not currently enabled.', flags: MessageFlags.Ephemeral });
    return;
  }

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

  await interaction.deferUpdate();

  const order = await findById(orderId);
  if (!order) {
    await interaction.followUp({ content: 'This order could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (TERMINAL_STATUSES.includes(order.status)) {
    await interaction.followUp({
      content: `This order is already ${order.status === 'cancelled' ? 'cancelled' : 'complete'} and cannot be updated.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!VALID_TRANSITIONS[order.status].includes(toStatus)) {
    await interaction.followUp({
      content: `This order is in **${STATUS_LABEL[order.status]}** status and cannot be moved to **${STATUS_LABEL[toStatus]}** from here.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await applyTransition(interaction, orderId, order.status, toStatus);
}

