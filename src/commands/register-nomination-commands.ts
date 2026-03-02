import { Routes } from 'discord-api-types/v10';
import { discordRestClient } from '../utils/discord-rest-client.ts';
import { getLogger } from '../utils/logger.ts';
import { nominatePlayerCommandBuilder } from './nominate-player.command.ts';
import { reviewNominationsCommandBuilder } from './review-nominations.command.ts';
import { processNominationCommandBuilder } from './process-nomination.command.ts';

const logger = getLogger();

const nominationCommands = [
  nominatePlayerCommandBuilder,
  reviewNominationsCommandBuilder,
  processNominationCommandBuilder,
];

export async function registerNominationCommands() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    logger.error('Missing CLIENT_ID in environment');
    return;
  }

  try {
    logger.info('Registering nomination slash commands...');
    for (const command of nominationCommands) {
      await discordRestClient.post(Routes.applicationCommands(clientId), {
        body: command.toJSON(),
      });
    }
    logger.info('Successfully registered nomination slash commands.');
  } catch (error) {
    logger.error('Error registering nomination slash commands:', error);
  }
}
