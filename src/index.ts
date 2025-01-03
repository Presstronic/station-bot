
// src/index.ts

import { Client, IntentsBitField } from 'discord.js';
import dotenv from 'dotenv';
import { registerCommands } from './commands/citizen';
import { handleInteraction } from './interactions/verifyButton';
import { logger } from './utils/logger';
import { scheduleTempMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job'
import { cli } from 'winston/lib/winston/config';

dotenv.config();

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
