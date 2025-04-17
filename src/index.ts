<<<<<<< HEAD
import './bootstrap.js'; // Loads dotenv and any shared setup
=======
import './bootstrap.js';
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300

import { Client, IntentsBitField } from 'discord.js';
import { registerCommands } from './commands/verify.js';
import { handleInteraction } from './interactions/verifyButton.js';
import { scheduleTempMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.js';
import { getLogger } from './utils/logger.js';
<<<<<<< HEAD
import i18n from './utils/i18n-config.js';
=======
import { scheduleTempMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.js'
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300

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

  try {
    await registerCommands(client);
    scheduleTempMemberCleanup(client);
    schedulePotentialApplicantCleanup(client);
    logger.info('Startup tasks complete.');
  } catch (error) {
    logger.error('Error during bot initialization:', error);
    process.exit(1);
  }
<<<<<<< HEAD
=======

  await registerCommands();

  scheduleTempMemberCleanup(client);

  schedulePotentialApplicantCleanup(client);
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction, client);
  } catch (error) {
    logger.error('Error handling interaction:', error);
  }
});

client.login(DISCORD_BOT_TOKEN);
