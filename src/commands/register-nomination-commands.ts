import { Routes } from 'discord-api-types/v10';
import { discordRestClient } from '../utils/discord-rest-client.ts';
import { getLogger } from '../utils/logger.ts';
import { nominatePlayerCommandBuilder } from './nominate-player.command.ts';
import { reviewNominationsCommandBuilder } from './review-nominations.command.ts';
import { processNominationCommandBuilder } from './process-nomination.command.ts';
import { nominationAccessCommandBuilder } from './nomination-access.command.ts';
import { verifyCommandBuilder, healthcheckCommandBuilder } from './verify.ts';

const logger = getLogger();

const allCommands = [
  verifyCommandBuilder,
  healthcheckCommandBuilder,
  nominatePlayerCommandBuilder,
  reviewNominationsCommandBuilder,
  processNominationCommandBuilder,
  nominationAccessCommandBuilder,
];

export async function registerNominationCommands() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    logger.error('Missing CLIENT_ID in environment');
    return { passed: [], failed: ['missing-client-id'] };
  }

  const commandNames = allCommands.map((command) => command.toJSON().name);
  logger.info('Registering global slash commands atomically...');
  try {
    await discordRestClient.put(Routes.applicationCommands(clientId), {
      body: allCommands.map((command) => command.toJSON()),
    });
    logger.info(`Global slash command registration complete. Registered: [${commandNames.join(', ')}]`);
    return { passed: commandNames, failed: [] };
  } catch (error) {
    logger.error(`Failed to register global slash commands atomically: ${String(error)}`);
    return { passed: [], failed: commandNames };
  }
}
