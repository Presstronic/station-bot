import './bootstrap.js'; // Loads dotenv and any shared setup

import { Client, IntentsBitField } from 'discord.js';
import { registerCommands } from './commands/verify.js';
import { handleInteraction } from './interactions/verifyButton.js';
import { scheduleTempMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.js';
import { addMissingDefaultRoles } from './services/role.services.js';
import { getLogger } from './utils/logger.js';
import i18n from './utils/i18n-config.js';

const logger = getLogger();

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
  logger.info(`Length of guilds list: ${client.guilds.cache.size}`)
  await Promise.all([
    registerCommands(),
    // TODO: initializeDatabase(),
    // TODO: initializeTelemetry(),
    Promise.all(
      [...client.guilds.cache.values()].map((guild) =>
        addMissingDefaultRoles(guild, client)
      )
    ),
  ]);

  scheduleTempMemberCleanup(client);
  schedulePotentialApplicantCleanup(client);

  logger.info('Startup tasks complete.');
});

client.on('guildCreate', async (guild) => {
  logger.info(`[guildCreate] Bot joined guild: ${guild.name} (${guild.id})`);

  try {
    await addMissingDefaultRoles(guild, client);
  } catch (error) {
    logger.error(`[${guild.name}] Error ensuring required roles:`, error);
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
