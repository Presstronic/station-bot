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

  // Fast sync guards — no defer needed, reply directly.
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

  // Defer before any async Discord API work so we don't risk timing out the
  // 3-second interaction window while fetching channels and threads.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let channel;
  try {
    channel = await interaction.client.channels.fetch(forumChannelId);
  } catch (error) {
    logger.error('[manufacturing] Failed to fetch forum channel during setup', { error });
    await interaction.editReply({
      content: 'Failed to fetch the manufacturing channel. Please check the configuration.',
    });
    return;
  }

  if (!channel || channel.type !== ChannelType.GuildForum) {
    await interaction.editReply({
      content: 'The configured manufacturing channel is not a valid forum channel.',
    });
    return;
  }

  const forumChannel = channel as unknown as ForumChannel;

  // Guard: check both active and archived threads so that an auto-archived
  // setup thread does not cause a duplicate on repeated invocations.
  try {
    const [active, archived] = await Promise.all([
      forumChannel.threads.fetchActive(),
      forumChannel.threads.fetchArchived(),
    ]);
    const alreadySetUp =
      active.threads.some((t) => t.name === CREATE_ORDER_THREAD_NAME) ||
      archived.threads.some((t) => t.name === CREATE_ORDER_THREAD_NAME);
    if (alreadySetUp) {
      await interaction.editReply({
        content: 'Manufacturing channel is already set up.',
      });
      return;
    }
  } catch (error) {
    logger.warn('[manufacturing] Could not fetch threads during setup duplicate check', { error });
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
    await interaction.editReply({
      content: 'Failed to post the setup message to the manufacturing channel.',
    });
    return;
  }

  await interaction.editReply({
    content: '✅ Manufacturing channel set up.',
  });
}
