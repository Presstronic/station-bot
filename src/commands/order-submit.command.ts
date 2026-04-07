import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ForumChannel,
  type ThreadChannel,
} from 'discord.js';
import { getManufacturingConfig, isManufacturingEnabled } from '../config/manufacturing.config.js';
import { submitOrder } from '../domain/manufacturing/manufacturing.service.js';
import {
  countActiveByUserId,
  updateForumThreadId,
  updateStaffThreadId,
} from '../domain/manufacturing/manufacturing.repository.js';
import {
  buildForumPostComponents,
  ensureForumTags,
  formatOrderPost,
} from '../domain/manufacturing/manufacturing.forum.js';
import { OrderLimitExceededError, type NewOrderItem } from '../domain/manufacturing/types.js';
import { hasOrganizationMemberOrHigher } from './nomination.helpers.js';
import { isDatabaseConfigured } from '../services/nominations/db.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

export const ORDER_COMMAND_NAME = 'order';

export const ITEM_MODAL_PREFIX = 'mfg-item-modal';
export const ADD_ITEM_BUTTON_PREFIX = 'mfg-add-item';
export const SUBMIT_ORDER_BUTTON_PREFIX = 'mfg-submit-order';

// Sessions expire after 15 minutes to prevent abandoned flows from leaking memory.
const SESSION_TTL_MS = 15 * 60 * 1000;

interface Session {
  items: NewOrderItem[];
  expiresAt: number;
  replyInteraction?: ModalSubmitInteraction;
}

const sessions = new Map<string, Session>();

// Periodically prune sessions that were never completed.
const sessionCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
}, SESSION_TTL_MS);
sessionCleanupInterval.unref();

// IN-PROCESS STORE — not persisted across restarts and not shared across instances.
// Rate-limit windows reset on bot restart; multi-instance deployments require a shared store — see #317.
interface RateLimitEntry { ts: number; id: string }
const orderSubmitTimestamps = new Map<string, RateLimitEntry[]>();

const orderSubmitCleanupInterval = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [userId, entries] of orderSubmitTimestamps) {
    if (entries.length === 0 || entries[entries.length - 1].ts <= cutoff) {
      orderSubmitTimestamps.delete(userId);
    }
  }
}, 60 * 60 * 1000);
orderSubmitCleanupInterval.unref();

/** Clears module-level intervals. Call in afterEach to prevent open handle warnings in tests. */
export function teardownOrderSubmitCommandForTests(): void {
  clearInterval(sessionCleanupInterval);
  clearInterval(orderSubmitCleanupInterval);
}

function getSession(sessionId: string): Session | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }
  return session;
}

function getSessionItems(sessionId: string): NewOrderItem[] | undefined {
  return getSession(sessionId)?.items;
}

export const orderCommandBuilder = new SlashCommandBuilder()
  .setName(ORDER_COMMAND_NAME)
  .setDescription('Submit a new manufacturing order')
  .setDMPermission(false);

function buildItemModal(customId: string, itemNumber: number): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(`Add Item ${itemNumber}`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('item-name')
        .setLabel('Item Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(255),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Quantity')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('priority-stat')
        .setLabel('Priority Stat')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(255)
        .setPlaceholder('e.g. Ballistic resistance, Thermal protection, Stamina regen...'),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(255),
    ),
  );

  return modal;
}

function buildItemCollectionComponents(
  sessionId: string,
  itemCount: number,
  maxItems: number,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ADD_ITEM_BUTTON_PREFIX}:${sessionId}`)
        .setLabel('＋ Add Item')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(itemCount >= maxItems),
      new ButtonBuilder()
        .setCustomId(`${SUBMIT_ORDER_BUTTON_PREFIX}:${sessionId}`)
        .setLabel('✓ Submit Order')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(itemCount === 0),
    ),
  ];
}

/**
 * Shared entry point for starting the order creation modal flow. Applies rate
 * limiting, eligibility checks, and session setup for both the `/order` slash
 * command and the 📋 Create Order button — neither path bypasses these checks.
 */
export async function triggerOrderModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  if (!isManufacturingEnabled()) {
    await interaction.reply({
      content: 'Manufacturing orders are not currently available.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  const { orderRateLimitPer5Min, orderRateLimitPerHour, orderLimit } = getManufacturingConfig();

  const submitEntries = (orderSubmitTimestamps.get(userId) ?? []).filter(e => e.ts > oneHourAgo);
  if (submitEntries.length > 0) {
    orderSubmitTimestamps.set(userId, submitEntries);
  } else {
    orderSubmitTimestamps.delete(userId);
  }

  const recentSubmits = submitEntries.filter(e => e.ts > fiveMinutesAgo);
  if (recentSubmits.length >= orderRateLimitPer5Min) {
    const limitingTs = recentSubmits[recentSubmits.length - orderRateLimitPer5Min].ts;
    const secondsRemaining = Math.ceil((limitingTs + 5 * 60 * 1000 - now) / 1000);
    await interaction.reply({
      content: `You're submitting orders too quickly. Please wait ${secondsRemaining} second(s) before trying again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (submitEntries.length >= orderRateLimitPerHour) {
    const limitingTs = submitEntries[submitEntries.length - orderRateLimitPerHour].ts;
    const minutesRemaining = Math.ceil((limitingTs + 60 * 60 * 1000 - now) / (60 * 1000));
    await interaction.reply({
      content: `You've reached the hourly order submission limit. Please try again in ${minutesRemaining} minute(s).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Run cheap sync guards before reserving the rate-limit slot. Because these
  // checks never yield to the event loop they cannot create a window where a
  // concurrent invocation sees a pending reservation that later rolls back and
  // produces a false-positive rate-limit rejection for an ineligible attempt.
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDatabaseConfigured()) {
    await interaction.reply({
      content: 'Manufacturing orders are currently unavailable due to a configuration issue. Please contact staff.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Reserve the slot before any awaits. Node.js is single-threaded so this
  // push is atomic with respect to other synchronous code; no other invocation
  // can interleave until the next await. Reserving here prevents two concurrent
  // invocations from both passing the rate-limit check before either records.
  // The entry carries interaction.id (unique per Discord interaction) so that
  // releaseSlot() can remove exactly this reservation even if two invocations
  // for the same user arrive within the same millisecond.
  const interactionId = interaction.id;
  submitEntries.push({ ts: now, id: interactionId });
  orderSubmitTimestamps.set(userId, submitEntries);

  // Rolls back the reserved slot. Re-reads the current map entry so a
  // concurrent invocation that replaced the map value is not overwritten.
  const releaseSlot = () => {
    const current = orderSubmitTimestamps.get(userId);
    if (!current) return;
    const idx = current.findIndex(e => e.id === interactionId);
    if (idx !== -1) current.splice(idx, 1);
    if (current.length === 0) {
      orderSubmitTimestamps.delete(userId);
    }
  };

  // Use try/finally so the slot is released on any exit that does not
  // successfully show the modal — explicit eligibility rejections, unexpected
  // throws from async calls, and showModal failures all release the reservation.
  // Note: the async guards (hasRole, countActiveByUserId) still have a narrow
  // concurrent false-positive window; a per-user mutex would close it fully
  // but is deferred until a shared store is in place (see #317).
  let slotCommitted = false;
  try {
    const hasRole = await hasOrganizationMemberOrHigher(interaction);
    if (!hasRole) {
      await interaction.reply({
        content: 'You must be an Organization Member to submit manufacturing orders.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Eager limit check — gives the user an early error with their current count
    // before they start the item flow. The authoritative check still happens in
    // the repository (with advisory lock) at submit time.
    const activeCount = await countActiveByUserId(interaction.user.id);
    if (activeCount >= orderLimit) {
      await interaction.reply({
        content: `You have ${activeCount} active order${activeCount === 1 ? '' : 's'} (limit: ${orderLimit}). Please wait for one to complete before submitting a new one.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    sessions.set(interaction.id, {
      items: [],
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    await interaction.showModal(buildItemModal(`${ITEM_MODAL_PREFIX}:${interaction.id}`, 1));
    slotCommitted = true;
  } finally {
    if (!slotCommitted) releaseSlot();
  }
}

export async function handleOrderCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  return triggerOrderModal(interaction);
}

export async function handleOrderItemModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const sessionId = interaction.customId.slice(ITEM_MODAL_PREFIX.length + 1);
  const items = getSessionItems(sessionId);

  if (!items) {
    await interaction.reply({
      content: 'Your order session has expired. Please use `/order` to start a new order.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { maxItemsPerOrder } = getManufacturingConfig();
  if (items.length >= maxItemsPerOrder) {
    await interaction.reply({
      content: `You can only add up to ${maxItemsPerOrder} items to an order.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const itemName = interaction.fields.getTextInputValue('item-name').trim();
  const quantityStr = interaction.fields.getTextInputValue('quantity').trim();
  const priorityStat = interaction.fields.getTextInputValue('priority-stat').trim();
  const noteRaw = interaction.fields.getTextInputValue('notes').trim();
  const note = noteRaw.length > 0 ? noteRaw : null;

  if (itemName.length === 0 || priorityStat.length === 0) {
    await interaction.reply({
      content: 'Item name and priority stat are required and cannot be empty.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quantity = parseInt(quantityStr, 10);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99999) {
    await interaction.reply({
      content: 'Quantity must be a positive whole number between 1 and 99,999.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  items.push({ itemName, quantity, priorityStat, note, sortOrder: items.length });

  const session = getSession(sessionId)!;
  const itemCollectionContent = `Item added (${items.length} / ${maxItemsPerOrder}). Add another item or submit your order.`;
  const itemCollectionComponents = buildItemCollectionComponents(sessionId, items.length, maxItemsPerOrder);

  if (!session.replyInteraction) {
    // First item — create the ephemeral message and store the interaction for future edits.
    await interaction.reply({
      content: itemCollectionContent,
      components: itemCollectionComponents,
      flags: MessageFlags.Ephemeral,
    });
    session.replyInteraction = interaction;
  } else {
    // Subsequent items — edit the existing ephemeral message in place so only one UI is visible.
    await session.replyInteraction.editReply({
      content: itemCollectionContent,
      components: itemCollectionComponents,
    });
    // Silently acknowledge the new modal interaction without creating a visible message.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.deleteReply();
  }
}

export async function handleOrderButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const colonIdx = interaction.customId.indexOf(':');
  const prefix = interaction.customId.slice(0, colonIdx);
  const sessionId = interaction.customId.slice(colonIdx + 1);
  const items = getSessionItems(sessionId);

  if (!items) {
    await interaction.update({
      content: 'Your order session has expired. Please use `/order` to start a new order.',
      components: [],
    });
    return;
  }

  const { maxItemsPerOrder } = getManufacturingConfig();

  if (prefix === ADD_ITEM_BUTTON_PREFIX) {
    if (items.length >= maxItemsPerOrder) {
      await interaction.update({
        content: `You have reached the maximum of ${maxItemsPerOrder} items per order.`,
        components: [],
      });
      return;
    }
    await interaction.showModal(
      buildItemModal(`${ITEM_MODAL_PREFIX}:${sessionId}`, items.length + 1),
    );
    return;
  }

  if (prefix !== SUBMIT_ORDER_BUTTON_PREFIX) return;

  if (items.length === 0) {
    await interaction.update({
      content: 'Please add at least one item before submitting.',
      components: buildItemCollectionComponents(sessionId, 0, maxItemsPerOrder),
    });
    return;
  }

  // Delete the session before any awaits — single-threaded atomicity prevents
  // a second click racing past the `if (!items)` guard above.
  const submittedItems = items;
  sessions.delete(sessionId);

  await interaction.deferUpdate();

  try {
    // Validate the forum channel before persisting the order so a misconfigured
    // channel ID never produces an orphaned order that can't be managed.
    const { forumChannelId } = getManufacturingConfig();
    const channel = await interaction.client.channels.fetch(forumChannelId);

    if (!channel || channel.type !== ChannelType.GuildForum) {
      logger.error(
        `[manufacturing] Channel ${forumChannelId} is missing or not a forum channel`,
      );
      await interaction.editReply({
        content:
          'Manufacturing is not configured correctly (forum channel unavailable). Please contact staff.',
        components: [],
      });
      return;
    }

    const forumChannel = channel as unknown as ForumChannel;

    const order = await submitOrder(
      interaction.user.id,
      interaction.user.username,
      submittedItems,
    );

    let tagIds: Map<string, string> | undefined;
    try {
      tagIds = await ensureForumTags(forumChannel);
    } catch (error) {
      logger.error('[manufacturing] Failed to ensure forum tags during order submission', { error });
    }
    const newTagId = tagIds?.get('New');

    const postContent = formatOrderPost(order);
    const DISCORD_MESSAGE_LIMIT = 2000;
    if (postContent.length > DISCORD_MESSAGE_LIMIT) {
      logger.error('[manufacturing] Order post content exceeds Discord message limit', {
        orderId: order.id,
        contentLength: postContent.length,
      });
      await interaction.editReply({
        content:
          'Your order was saved but the forum post could not be created because it was too long. Please contact staff.',
        components: [],
      });
      return;
    }

    let thread: ThreadChannel;
    try {
      thread = await forumChannel.threads.create({
        name: `Order #${order.id} — ${interaction.user.username}`,
        message: {
          content: postContent,
          components: buildForumPostComponents(order.id, order.status, 'member'),
          allowedMentions: { parse: [], users: [order.discordUserId], roles: [] },
        },
        appliedTags: newTagId ? [newTagId] : [],
      });
    } catch (error) {
      logger.error('[manufacturing] Failed to create forum thread for order', {
        orderId: order.id,
        error,
      });
      await interaction.editReply({
        content:
          'Your order was saved but the forum post could not be created. Please contact staff.',
        components: [],
      });
      return;
    }

    let forumLinkFailed = false;
    try {
      await updateForumThreadId(order.id, thread.id);
    } catch (error) {
      forumLinkFailed = true;
      logger.error('[manufacturing] Failed to link order to forum thread', {
        orderId: order.id,
        threadId: thread.id,
        error,
      });
    }

    const { manufacturingRoleId, staffChannelId } = getManufacturingConfig();
    if (manufacturingRoleId) {
      try {
        await thread.send({
          content: `<@&${manufacturingRoleId}> New order submitted.`,
          allowedMentions: { roles: [manufacturingRoleId] },
        });
      } catch (error) {
        logger.warn('[manufacturing] Failed to send role ping in order thread', {
          orderId: order.id,
          threadId: thread.id,
          error,
        });
      }
    }

    // Create the mirrored staff thread in the background — truly non-blocking so the
    // member's success reply is never delayed by staff channel issues.
    if (staffChannelId) {
      void (async () => { try {
        const staffCh = await interaction.client.channels.fetch(staffChannelId);
        if (!staffCh || staffCh.type !== ChannelType.GuildForum) {
          logger.error(
            '[manufacturing] Staff channel is missing or not a forum channel; skipping staff thread creation',
            { orderId: order.id, staffChannelId },
          );
        } else {
          const staffForumChannel = staffCh as unknown as ForumChannel;
          let staffTagIds: Map<string, string> | undefined;
          try {
            staffTagIds = await ensureForumTags(staffForumChannel);
          } catch (tagErr) {
            logger.error(
              '[manufacturing] Failed to ensure staff forum tags during order submission',
              { orderId: order.id, staffChannelId, error: tagErr },
            );
          }
          const staffNewTagId = staffTagIds?.get('New');
          const staffThread = await staffForumChannel.threads.create({
            name: `Order #${order.id} — ${interaction.user.username}`,
            message: {
              content: postContent,
              components: buildForumPostComponents(order.id, order.status, 'staff'),
              allowedMentions: { parse: [], users: [] },
            },
            appliedTags: staffNewTagId ? [staffNewTagId] : [],
          });
          try {
            await updateStaffThreadId(order.id, staffThread.id);
          } catch (linkErr) {
            logger.error('[manufacturing] Staff thread created but failed to persist staff thread ID for order', {
              orderId: order.id,
              staffThreadId: staffThread.id,
              error: linkErr,
            });
          }
        }
      } catch (error) {
        logger.error('[manufacturing] Failed to create staff thread for order', {
          orderId: order.id,
          error,
        });
      } })();
    }

    const linkWarning = forumLinkFailed
      ? '\n\nFailed to link your order to the forum thread internally. Please contact staff.'
      : '';

    await interaction.editReply({
      content: `✅ Order #${order.id} submitted! See your order in <#${thread.id}>.${linkWarning}`,
      components: [],
    });
  } catch (error) {
    if (error instanceof OrderLimitExceededError) {
      await interaction.editReply({
        content: `You have reached the active order limit of ${error.limit}. Please wait for an existing order to complete before submitting a new one.`,
        components: [],
      });
      return;
    }
    throw error;
  }
}
