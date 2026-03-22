import { Routes } from 'discord-api-types/v10';
import { discordRestClient } from '../utils/discord-rest-client.js';
import { getLogger } from '../utils/logger.js';
import { nominationSubmitCommandBuilder } from './nomination-submit.command.js';
import { nominationReviewCommandBuilder } from './nomination-review.command.js';
import { nominationRefreshCommandBuilder } from './nomination-refresh.command.js';
import { nominationProcessCommandBuilder } from './nomination-process.command.js';
import { nominationAccessCommandBuilder } from './nomination-access.command.js';
import { nominationAuditCommandBuilder } from './nomination-audit.command.js';
import { nominationJobStatusCommandBuilder } from './nomination-job-status.command.js';
import { verifyCommandBuilder, healthcheckCommandBuilder } from './verify.js';
import { setRegisteredCommandNames } from './registration-state.js';

const logger = getLogger();

const allCommands = [
  verifyCommandBuilder,
  healthcheckCommandBuilder,
  nominationSubmitCommandBuilder,
  nominationReviewCommandBuilder,
  nominationRefreshCommandBuilder,
  nominationJobStatusCommandBuilder,
  nominationProcessCommandBuilder,
  nominationAccessCommandBuilder,
  nominationAuditCommandBuilder,
];

export async function registerAllCommands() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    logger.error('Missing CLIENT_ID in environment');
    setRegisteredCommandNames([]);
    return { passed: [], failed: ['missing-client-id'] };
  }

  const commandNames = allCommands.map((command) => command.toJSON().name);
  logger.info('Registering global slash commands atomically...');
  try {
    await discordRestClient.put(Routes.applicationCommands(clientId), {
      body: allCommands.map((command) => command.toJSON()),
    });
    setRegisteredCommandNames(commandNames);
    logger.info(`Global slash command registration complete. Registered: [${commandNames.join(', ')}]`);
    return { passed: commandNames, failed: [] };
  } catch (error) {
    setRegisteredCommandNames([]);
    logger.error(`Failed to register global slash commands atomically: ${String(error)}`);
    return { passed: [], failed: commandNames };
  }
}
