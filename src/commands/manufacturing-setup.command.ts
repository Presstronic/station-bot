import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ForumChannel,
} from 'discord.js';
import { getManufacturingConfig, isManufacturingEnabled } from '../config/manufacturing.config.js';
import { MFG_CREATE_ORDER_PREFIX } from '../domain/manufacturing/manufacturing.forum.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

export const MANUFACTURING_SETUP_COMMAND_NAME = 'manufacturing';

export const manufacturingCommandBuilder = new SlashCommandBuilder()
  .setName(MANUFACTURING_SETUP_COMMAND_NAME)
  .setDescription('Manufacturing administration')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Post the Create Order button in the manufacturing channel'),
  );

const CREATE_ORDER_THREAD_NAME = '📋 Create Order';

export async function handleManufacturingSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.options.getSubcommand() !== 'setup') return;

  if (!isManufacturingEnabled()) {
    await interaction.reply({
      content: 'Manufacturing is not currently enabled.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { forumChannelId } = getManufacturingConfig();
  if (!forumChannelId) {
    await interaction.reply({
      content: 'Manufacturing forum channel is not configured. Please set `MANUFACTURING_FORUM_CHANNEL_ID`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let channel;
  try {
    channel = await interaction.client.channels.fetch(forumChannelId);
  } catch (error) {
    logger.error('[manufacturing] Failed to fetch forum channel during setup', { error });
    await interaction.reply({
      content: 'Failed to fetch the manufacturing channel. Please check the configuration.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!channel || channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: 'The configured manufacturing channel is not a valid forum channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const forumChannel = channel as unknown as ForumChannel;

  // Guard: check whether a Create Order thread already exists so setup is
  // idempotent and does not spam the channel on repeated invocations.
  try {
    const active = await forumChannel.threads.fetchActive();
    const alreadySetUp = active.threads.some((t) => t.name === CREATE_ORDER_THREAD_NAME);
    if (alreadySetUp) {
      await interaction.reply({
        content: 'Manufacturing channel is already set up.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    logger.warn('[manufacturing] Could not fetch active threads during setup duplicate check', { error });
    // Non-fatal — proceed and post; worst case is a duplicate thread.
  }

  const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(MFG_CREATE_ORDER_PREFIX)
      .setLabel('📋 Create Order')
      .setStyle(ButtonStyle.Primary),
  );

  try {
    await forumChannel.threads.create({
      name: CREATE_ORDER_THREAD_NAME,
      message: {
        content: 'Click the button below to submit a new manufacturing order.',
        components: [button],
      },
    });
  } catch (error) {
    logger.error('[manufacturing] Failed to create Create Order thread', { error });
    await interaction.reply({
      content: 'Failed to post the setup message to the manufacturing channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: '✅ Manufacturing channel set up.',
    flags: MessageFlags.Ephemeral,
  });
}
