import './bootstrap.ts'; // Loads dotenv and any shared setup

import { Client, IntentsBitField } from 'discord.js';
import { registerNominationCommands } from './commands/register-nomination-commands.ts';
import { handleInteraction } from './interactions/interactionRouter.ts';
import { scheduleTemporaryMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.ts';
import { addMissingDefaultRoles } from './services/role.services.ts';
import { getLogger } from './utils/logger.ts';
import { isReadOnlyMode } from './config/runtime-flags.ts';
import { ensureNominationsSchema, isDatabaseConfigured } from './services/nominations/db.ts';

const logger = getLogger();
const readOnlyMode = isReadOnlyMode();

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}`, reason);
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_BOT_TOKEN) {
  logger.error('Bot token is missing. Please set DISCORD_BOT_TOKEN in your .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
  ],
});

client.once('ready', async () => {
  logger.info(`Bot logged in as ${client.user?.tag}`);
  logger.info(`Length of guilds list: ${client.guilds.cache.size}`);
  logger.info(`BOT_READ_ONLY_MODE=${readOnlyMode}`);
  if (isDatabaseConfigured()) {
    try {
      await ensureNominationsSchema();
    } catch (error) {
      logger.error(`Failed to initialize nominations database schema: ${String(error)}`);
    }
  }

  const nominationRegistration = await registerNominationCommands();
  if (nominationRegistration.failed.length > 0) {
    logger.warn(
      `Some nomination commands failed registration: ${nominationRegistration.failed.join(', ')}`
    );
  }
  if (readOnlyMode) {
    logger.warn('Read-only mode is enabled. Commands remain registered but non-maintenance behavior is disabled.');
  }

  if (!readOnlyMode) {
    await Promise.all(
      [...client.guilds.cache.values()].map(async (guild) => {
        try {
          await addMissingDefaultRoles(guild, client);
        } catch (error) {
          logger.error(`Failed to add missing roles in guild ${guild.id} (${guild.name}):`, error);
        }
      })
    );
    scheduleTemporaryMemberCleanup(client);
    schedulePotentialApplicantCleanup(client);
    logger.info('Scheduled member cleanup jobs.');
  } else {
    logger.warn('Read-only mode is enabled. Skipping default role creation and cleanup job scheduling.');
  }

  logger.info('Startup tasks completed.');
});

client.on('guildCreate', async (guild) => {
  logger.info(`[guildCreate] Bot joined guild: ${guild.name} (${guild.id})`);

  if (readOnlyMode) {
    logger.warn(`[${guild.name}] Read-only mode enabled; skipping role setup on guild join.`);
    return;
  }

  try {
    await addMissingDefaultRoles(guild, client);
    logger.info(`[${guild.name}] Successfully ensured required roles.`);
  } catch (error) {
    logger.error(
      `[${guild.name} (${guild.id})] Error ensuring required roles on guild join:`,
      error
    );
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction, client);
  } catch (error) {
    logger.error('Error handling interaction:', error);
  }
});

client.login(DISCORD_BOT_TOKEN);
