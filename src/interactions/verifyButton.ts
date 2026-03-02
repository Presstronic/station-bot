import {
    ButtonInteraction,
    Interaction,
    Client,
  } from 'discord.js';
import { handleVerifyCommand, getUserVerificationData, handleHealthcheckCommand } from '../commands/verify.ts';
import { getLogger } from '../utils/logger.ts';
import { assignVerifiedRole, removeVerifiedRole } from '../services/role.services.ts';
import { verifyRSIProfile } from '../services/rsi.services.ts';
import i18n from '../utils/i18n-config.ts';
import { isReadOnlyMode } from '../config/runtime-flags.ts';

const logger = getLogger();
const defaultLocale = 'en';

export async function handleInteraction(
  interaction: Interaction,
  _client: Client
) {
  const readOnlyMode = isReadOnlyMode();
  const isHealthcheckCommand = interaction.isChatInputCommand() && interaction.commandName === 'healthcheck';

  if (readOnlyMode && !isHealthcheckCommand && (interaction.isChatInputCommand() || interaction.isButton())) {
    const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
    const maintenanceMessage = i18n.__({
      phrase: 'interactions.readOnly.maintenance',
      locale,
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: maintenanceMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: maintenanceMessage, ephemeral: true });
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'verify') {
      await handleVerifyCommand(interaction);
    } else if (interaction.commandName === 'healthcheck') {
      await handleHealthcheckCommand(interaction);
    }
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction as ButtonInteraction);
  }
}

async function handleButtonInteraction(
  interaction: ButtonInteraction
) {
  const userData = getUserVerificationData(interaction.user.id);
  const rsiInGameName = userData?.rsiProfileName?.split('/').pop() ?? 'Unknown';

  if (interaction.customId === 'verify') {
    const rsiProfileVerified = await verifyRSIProfile(interaction.user.id);
    const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
    logger.debug(`RSI Profile Verified: ${rsiProfileVerified}`); 

    if (rsiProfileVerified) {
      const success = await assignVerifiedRole(interaction, interaction.user.id);
      logger.debug(`Role assignment success: ${success}`);
      
      if(success) {
        logger.debug(`Role assigned successfully to user ID: ${interaction.user.id}`);
        await interaction.reply({
          content: i18n.__mf(
            { phrase: 'commands.verify.responses.success', locale },
            { rsiName: rsiInGameName, username: interaction.user.username }
          ),
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: i18n.__mf(
            { phrase: 'commands.verify.responses.assignFailed', locale },
            { rsiName: rsiInGameName, username: interaction.user.username }
          ),
          ephemeral: true,
        });
      }
    } else {
      await removeVerifiedRole(interaction, interaction.user.id);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.verify.responses.verificationFailed', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        ),
        ephemeral: true,
      });
    }    
  }
}
