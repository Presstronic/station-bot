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
} from 'discord.js';
import { getManufacturingConfig, isManufacturingEnabled } from '../config/manufacturing.config.js';
import { submitOrder } from '../domain/manufacturing/manufacturing.service.js';
import {
  countActiveByUserId,
  updateForumThreadId,
} from '../domain/manufacturing/manufacturing.repository.js';
import {
  buildForumPostComponents,
  ensureForumTags,
  formatOrderPost,
} from '../domain/manufacturing/manufacturing.forum.js';
import { OrderLimitExceededError, type NewOrderItem } from '../domain/manufacturing/types.js';
import { hasOrganizationMemberOrHigher } from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

export const ORDER_COMMAND_NAME = 'order';
const ORDER_SUBMIT_SUBCOMMAND = 'submit';

export const ITEM_MODAL_PREFIX = 'mfg-item-modal';
export const ADD_ITEM_BUTTON_PREFIX = 'mfg-add-item';
export const SUBMIT_ORDER_BUTTON_PREFIX = 'mfg-submit-order';

// Sessions expire after 15 minutes to prevent abandoned flows from leaking memory.
const SESSION_TTL_MS = 15 * 60 * 1000;

interface Session {
  items: NewOrderItem[];
  expiresAt: number;
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

function getSessionItems(sessionId: string): NewOrderItem[] | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }
  return session.items;
}

export const orderCommandBuilder = new SlashCommandBuilder()
  .setName(ORDER_COMMAND_NAME)
  .setDescription('Manufacturing order commands')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName(ORDER_SUBMIT_SUBCOMMAND)
      .setDescription('Submit a new manufacturing order'),
  );

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
        .setRequired(true),
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
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export async function handleOrderCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.options.getSubcommand() !== ORDER_SUBMIT_SUBCOMMAND) return;

  if (!isManufacturingEnabled()) {
    await interaction.reply({
      content: 'Manufacturing orders are not currently available.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
  const { orderLimit } = getManufacturingConfig();
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
}

export async function handleOrderItemModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const sessionId = interaction.customId.slice(ITEM_MODAL_PREFIX.length + 1);
  const items = getSessionItems(sessionId);

  if (!items) {
    await interaction.reply({
      content: 'Your order session has expired. Please use `/order submit` to start a new order.',
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
  if (!Number.isInteger(quantity) || quantity <= 0) {
    await interaction.reply({
      content: 'Quantity must be a positive whole number (e.g. 5).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  items.push({ itemName, quantity, priorityStat, note, sortOrder: items.length });

  await interaction.reply({
    content: `Item added (${items.length} / ${maxItemsPerOrder}). Add another item or submit your order.`,
    components: buildItemCollectionComponents(sessionId, items.length, maxItemsPerOrder),
    flags: MessageFlags.Ephemeral,
  });
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
      content: 'Your order session has expired. Please use `/order submit` to start a new order.',
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

  // Delete the session before any awaits — single-threaded atomicity prevents
  // a second click racing past the `if (!items)` guard above.
  const submittedItems = items;
  sessions.delete(sessionId);

  await interaction.deferUpdate();

  try {
    const order = await submitOrder(
      interaction.user.id,
      interaction.user.username,
      submittedItems,
    );

    const { forumChannelId } = getManufacturingConfig();
    const channel = await interaction.client.channels.fetch(forumChannelId);

    if (!channel || channel.type !== ChannelType.GuildForum) {
      logger.error(
        `[manufacturing] Channel ${forumChannelId} is missing or not a forum channel`,
      );
      await interaction.editReply({
        content:
          'Your order was saved but the forum post could not be created. Please contact staff.',
        components: [],
      });
      return;
    }

    const forumChannel = channel as unknown as ForumChannel;

    let tagIds: Map<string, string> | undefined;
    try {
      tagIds = await ensureForumTags(forumChannel);
    } catch (error) {
      logger.error('[manufacturing] Failed to ensure forum tags during order submission', { error });
    }
    const newTagId = tagIds?.get('New');

    const thread = await forumChannel.threads.create({
      name: `Order #${order.id} — ${interaction.user.username}`,
      message: {
        content: formatOrderPost(order),
        components: buildForumPostComponents(order.id),
        allowedMentions: { users: [order.discordUserId] },
      },
      appliedTags: newTagId ? [newTagId] : [],
    });

    await updateForumThreadId(order.id, thread.id);

    await interaction.editReply({
      content: `✅ Order #${order.id} submitted! See your order in <#${thread.id}>.`,
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
