import 'reflect-metadata';

import { Client, IntentsBitField } from 'discord.js';
import dotenv from 'dotenv';
import { verifyCommands } from './commands/verify';
import { hangarCommands } from './commands/hangar'
import { handleInteraction } from './interactions/verifyButton';
import { logger } from './utils/logger';

import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';


dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const allCommands = [...verifyCommands, ...hangarCommands]


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

  logger.info("Registering Commands");
  await registerCommands(client);

});

export async function registerCommands(client: Client) {
  // TODO: Prob not here, but somewhere I need to have the bot create the station-bot-verified role (or allow for a custom role override)
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

  if (!CLIENT_ID || !GUILD_ID || !DISCORD_BOT_TOKEN) {
    logger.error('Missing CLIENT_ID, GUILD_ID, or DISCORD_BOT_TOKEN in .env');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

  try {
    logger.info('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: allCommands.map((command) => command.toJSON()),
    });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Error registering commands:', error);
  }
}

client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction, client);
});

client.login(DISCORD_BOT_TOKEN);
