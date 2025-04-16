import '../bootstrap.js';

import { REST } from '@discordjs/rest';
import { getLogger } from './logger.js';

const logger = getLogger();

const DISCORD_API_VERSION = '10';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
                          
logger.info('*********>>>>>>> DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN);

if (!DISCORD_BOT_TOKEN) {
  logger.error('Missing DISCORD_BOT_TOKEN in environment.');
  throw new Error('DISCORD_BOT_TOKEN must be set in the environment.');
}

export const discordRestClient = new REST({ version: DISCORD_API_VERSION }).setToken(DISCORD_BOT_TOKEN);
