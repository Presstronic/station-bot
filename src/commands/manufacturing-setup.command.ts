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

export async function handleManufacturingSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // getSubcommand(false) returns null rather than throwing when no subcommand
  // is present, which can happen with out-of-sync or partial command payloads.
  if (interaction.options.getSubcommand(false) !== 'setup') return;

  // Fast sync guards — no defer needed, reply directly.
  if (!isManufacturingEnabled()) {
    await interaction.reply({
      content: 'Manufacturing is not currently enabled.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { forumChannelId, createOrderPostTitle, createOrderPostMessage } = getManufacturingConfig();
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

  // Defense-in-depth admin check. setDefaultMemberPermissions is a default
  // that server admins can override in Discord's integrations settings, so we
  // verify the permission at runtime to prevent accidental exposure.
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.editReply({
      content: 'This command requires Administrator permissions and must be used in a server.',
    });
    return;
  }

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
  // Note: the duplicate check matches on thread name (createOrderPostTitle). If the
  // title is changed via env after the thread has been created, or the thread is
  // renamed manually, this guard will not detect the existing thread and a duplicate
  // will be created. In that case, delete the old thread before re-running setup.
  try {
    const [active, archived] = await Promise.all([
      forumChannel.threads.fetchActive(),
      forumChannel.threads.fetchArchived(),
    ]);
    const alreadySetUp =
      active.threads.some((t) => t.name === createOrderPostTitle) ||
      archived.threads.some((t) => t.name === createOrderPostTitle);
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
      name: createOrderPostTitle,
      message: {
        content: createOrderPostMessage,
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
