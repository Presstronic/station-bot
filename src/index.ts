
import dotenv from 'dotenv';
dotenv.config();

import { Client, IntentsBitField } from 'discord.js';
import { registerCommands } from './commands/citizen.js';
import { handleInteraction } from './interactions/verifyButton.js';
import { getLogger } from './utils/logger.js';
import { scheduleTempMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.js'

const logger = getLogger();

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`, error);
  process.exit(1); // Exit after logging
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  logger.error('Bot token is missing. Please set DISCORD_BOT_TOKEN in your .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
});

client.once('ready', async () => {
  if (!client.user || !client.application) {
    return;
  }

  await registerCommands(client);

  scheduleTempMemberCleanup(client);

  schedulePotentialApplicantCleanup(client);
});

client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction, client);
});

client.login(DISCORD_BOT_TOKEN);

logger.info('Bot started successfully');
logger.debug("WHYYYY DEBUG");
logger.error('Failed to load application configuration');