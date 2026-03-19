import './bootstrap.js'; // Loads dotenv and any shared setup

import { Client, IntentsBitField } from 'discord.js';
import { registerAllCommands } from './commands/register-commands.js';
import { handleInteraction } from './interactions/interactionRouter.js';
import { scheduleTemporaryMemberCleanup, schedulePotentialApplicantCleanup } from './jobs/discord/purge-member.job.js';
import { addMissingDefaultRoles } from './services/role.services.js';
import { getLogger } from './utils/logger.js';
import { isReadOnlyMode, isVerificationEnabled, isPurgeJobsEnabled } from './config/runtime-flags.js';
import { ensureNominationsSchema, getDbPool, isDatabaseConfigured } from './services/nominations/db.js';
import { startNominationCheckWorkerLoop } from './services/nominations/job-worker.service.js';

const logger = getLogger();
const readOnlyMode = isReadOnlyMode();
const verificationEnabled = isVerificationEnabled();
const purgeJobsEnabled = isPurgeJobsEnabled();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

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

// Declared at module scope so the shutdown handler can clear it regardless of
// when the signal arrives (before or after ready, worker enabled or not).
let workerHandle: NodeJS.Timeout | null = null;

const shutdown = () => {
  logger.info('Graceful shutdown initiated.');
  process.exitCode = 0;
  if (workerHandle !== null) {
    clearInterval(workerHandle);
  }
  client.destroy();
  if (isDatabaseConfigured()) {
    getDbPool().end().catch((err: unknown) => {
      logger.error(`Error closing PG pool during shutdown: ${String(err)}`);
    });
  }
  // Force-exit after 10 s as a last-resort safety net in case any remaining
  // handle keeps the event loop alive after cleanup.
  const forceExit = setTimeout(() => process.exit(0), 10_000);
  forceExit.unref();
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

client.once('ready', async () => {
  logger.info(`Bot logged in as ${client.user?.tag}`);
  logger.info(`Length of guilds list: ${client.guilds.cache.size}`);
  logger.info(`BOT_READ_ONLY_MODE=${readOnlyMode}`);
  if (isDatabaseConfigured()) {
    try {
      await ensureNominationsSchema();
    } catch (error) {
      logger.error('Failed to initialize nominations database schema', error);
      logger.error('DATABASE_URL is set but schema is not healthy. Aborting startup.');
      process.exit(1);
      return;
    }
  }

  const commandRegistration = await registerAllCommands();
  if (commandRegistration.failed.length > 0) {
    logger.warn(
      `Some slash commands failed registration: ${commandRegistration.failed.join(', ')}`
    );
  }
  if (readOnlyMode) {
    logger.warn('Read-only mode is enabled. Commands remain registered but non-maintenance behavior is disabled.');
  }

  if (!readOnlyMode) {
    if (verificationEnabled) {
      await Promise.all(
        [...client.guilds.cache.values()].map(async (guild) => {
          try {
            await addMissingDefaultRoles(guild, client);
          } catch (error) {
            logger.error(`Failed to add missing roles in guild ${guild.id} (${guild.name}):`, error);
          }
        })
      );
      logger.info('Verification enabled — role setup complete.');
    } else {
      logger.info('VERIFICATION_ENABLED=false — skipping role setup.');
    }

    if (purgeJobsEnabled) {
      scheduleTemporaryMemberCleanup(client);
      schedulePotentialApplicantCleanup(client);
      logger.info('Scheduled member purge jobs.');
    } else {
      logger.info('PURGE_JOBS_ENABLED=false — member purge jobs will not run.');
    }
    if (isDatabaseConfigured()) {
      workerHandle = startNominationCheckWorkerLoop();
      if (workerHandle) {
        logger.info('Started nomination check worker loop.');
      }
    }
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

  if (!verificationEnabled) {
    logger.info(`[${guild.name}] VERIFICATION_ENABLED=false — skipping role setup on guild join.`);
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
    if (error instanceof Error) {
      const stackText = error.stack ? `\n${error.stack}` : '';
      logger.error(`Unhandled interaction error in index handler: ${error.message}${stackText}`);
    } else {
      logger.error(`Unhandled interaction error in index handler: ${String(error)}`);
    }
    if (!interaction.isRepliable()) {
      return;
    }
    if (interaction.replied) {
      return;
    }
    if (interaction.deferred) {
      await interaction.editReply({
        content: 'An unexpected error occurred while processing your request.',
        allowedMentions: { parse: [] },
      }).catch(() => {
        logger.debug(`Failed to send fallback interaction error editReply (locale=${defaultLocale}).`);
      });
      return;
    }
    await interaction
      .reply({
        content: 'An unexpected error occurred while processing your request.',
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
      .catch(() => {
        logger.debug(`Failed to send fallback interaction error reply (locale=${defaultLocale}).`);
      });
  }
});

client.login(DISCORD_BOT_TOKEN);
