import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = 'en';

// Create the command builder using the default locale.
const kickCommandBuilder = new SlashCommandBuilder()
  .setName(i18n.__({ phrase: 'commands.kick.name', locale: defaultLocale }))
  .setDescription(i18n.__({ phrase: 'commands.kick.description', locale: defaultLocale }));

// Add the "target" user option.
kickCommandBuilder.addUserOption((option) => {
  return option
    .setName(i18n.__({ phrase: 'commands.kick.option.target.name', locale: defaultLocale }))
    .setDescription(i18n.__({ phrase: 'commands.kick.option.target.description', locale: defaultLocale }))
    .setRequired(true);
});

// Add the "reason" string option.
kickCommandBuilder.addStringOption((option) => {
  return option
    .setName(i18n.__({ phrase: 'commands.kick.option.reason.name', locale: defaultLocale }))
    .setDescription(i18n.__({ phrase: 'commands.kick.option.reason.description', locale: defaultLocale }))
    .setRequired(false);
});

kickCommandBuilder
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .setDMPermission(false);

export const kickCommand = {
  data: kickCommandBuilder,
  async execute(interaction: ChatInputCommandInteraction) {
    // Retrieve the locale for runtime responses from the guild's preferred locale.
    // Discord returns a value like "en-US", so we take the first two letters.
    const locale = interaction.guild
      ? interaction.guild.preferredLocale.substring(0, 2)
      : defaultLocale;

    if (!interaction.inGuild()) {
      logger.error('Kick command used outside a guild.');
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.kick.errorNotInGuild', locale }),
        ephemeral: true,
      });
      return;
    }

    // Retrieve the target user and the optional reason.
    const targetUser = interaction.options.getUser(
      i18n.__({ phrase: 'commands.kick.option.target.name', locale: defaultLocale }),
      true
    );
    const reason =
      interaction.options.getString(
        i18n.__({ phrase: 'commands.kick.option.reason.name', locale: defaultLocale })
      ) || i18n.__({ phrase: 'commands.kick.defaultReason', locale });

    // Fetch the member from the guild.
    const targetMember = await interaction.guild!.members
      .fetch(targetUser.id)
      .catch(() => null);
    if (!targetMember) {
      logger.error(`Kick command: User ${targetUser.tag} not found in the guild.`);
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.kick.errorNotFound', locale }),
        ephemeral: true,
      });
      return;
    }

    if (!targetMember.kickable) {
      logger.error(`Kick command: Cannot kick ${targetUser.tag}; insufficient permissions.`);
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.kick.errorNotKickable', locale }),
        ephemeral: true,
      });
      return;
    }

    try {
      await targetMember.kick(reason);
      logger.info(
        `Kick command: Successfully kicked ${targetUser.tag} from guild ${interaction.guild?.name}. Reason: ${reason}`
      );
      await interaction.reply({
        content: i18n.__mf({ phrase: 'commands.kick.success', locale }, { user: targetUser.tag, reason }),
      });
    } catch (error) {
      logger.error(`Kick command: Error kicking ${targetUser.tag}:`, error);
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.kick.errorKick', locale }),
        ephemeral: true,
      });
    }
  },
};

