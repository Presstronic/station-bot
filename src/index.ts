import './bootstrap.js'; // Loads dotenv and any shared setup

import { createRequire } from 'node:module';
import { ChannelType, Client, ForumChannel, IntentsBitField } from 'discord.js';
import { registerAllCommands } from './commands/register-commands.js';
import { handleInteraction, attemptFallbackReply } from './interactions/interactionRouter.js';
import {
  scheduleTemporaryMemberCleanup,
  schedulePotentialApplicantCleanup,
} from './jobs/discord/purge-member.job.js';
import { scheduleCreateOrderKeepAlive } from './jobs/discord/manufacturing-keepalive.job.js';
import { scheduleNominationDigests } from './jobs/discord/nomination-digest.job.js';
import { addMissingDefaultRoles } from './services/role.services.js';
import { getLogger } from './utils/logger.js';
import { isReadOnlyMode, isVerificationEnabled, isPurgeJobsEnabled } from './config/runtime-flags.js';
import { isNominationDigestEnabled } from './config/nomination-digest.config.js';
import {
  validateManufacturingConfig,
  isManufacturingEnabled,
  getManufacturingConfig,
} from './config/manufacturing.config.js';
import {
  endDbPoolIfInitialized,
  ensureNominationsSchema,
  isDatabaseConfigured,
} from './services/nominations/db.js';
import { seedGuildConfigsFromEnv } from './domain/guild-config/guild-config.seeder.js';
import { getGuildConfigOrNull, getAllGuildConfigs } from './domain/guild-config/guild-config.service.js';
import { ensureForumTags } from './domain/manufacturing/manufacturing.forum.js';
import { startNominationCheckWorkerLoop } from './services/nominations/job-worker.service.js';
import { buildStartupBanner } from './utils/startup-banner.js';
import {
  startEventLoopMonitor,
  subscribeRestEvents,
  subscribeUndiciDiagnostics,
} from './utils/diagnostics.js';
import {
  checkBotPermissions,
  notifyOwnerOfMissingPermissions,
} from './utils/permission-check.js';

const _require = createRequire(import.meta.url);
const { version: appVersion } = _require('../package.json') as { version: string };

const logger = getLogger();
const readOnlyMode = isReadOnlyMode();
const verificationEnabled = isVerificationEnabled();
const purgeJobsEnabled = isPurgeJobsEnabled();
let manufacturingEnabled = isManufacturingEnabled();
const nominationDigestEnabled = isNominationDigestEnabled();

// Disables manufacturing for the rest of this process lifetime. Mutates both
// the local flag and MANUFACTURING_ENABLED so that isManufacturingEnabled()
// (used by command handlers) stays in sync with the local flag.
function disableManufacturing(): void {
  manufacturingEnabled = false;
  process.env.MANUFACTURING_ENABLED = 'false';
}

const manufacturingConfigErrors = manufacturingEnabled ? validateManufacturingConfig() : [];
if (manufacturingEnabled && manufacturingConfigErrors.length > 0) {
  for (const error of manufacturingConfigErrors) {
    logger.error(`[manufacturing] Configuration error: ${error}`);
  }
  logger.error(
    '[manufacturing] Disabling manufacturing feature due to configuration errors. Fix the above or set MANUFACTURING_ENABLED=false to keep it disabled.',
  );
  disableManufacturing();
}

// Returns the feature flags that are actually active in the current mode.
// Features are treated as disabled when readOnlyMode is true so permission
// audits do not raise false alarms for features that won't run.
function getEffectiveAuditFlags() {
  return {
    verificationEnabled: verificationEnabled && !readOnlyMode,
    purgeJobsEnabled: purgeJobsEnabled && !readOnlyMode,
    manufacturingEnabled: manufacturingEnabled && !readOnlyMode,
  };
}

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
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
});

// Declared at module scope so the shutdown handler can stop them regardless of
// when the signal arrives (before or after ready, jobs enabled or not).
let workerHandle: NodeJS.Timeout | null = null;
let loopMonitorHandle: NodeJS.Timeout | null = null;
let tempMemberCronTask: { stop: () => void } | null = null;
let potentialApplicantCronTask: { stop: () => void } | null = null;
let keepAliveCronTask: { stop: () => void } | null = null;
let nominationDigestCronTasks: Map<string, { stop: () => void }> = new Map();
let shuttingDown = false;

// Subscribe to undici TCP-level diagnostics before any HTTP activity begins.
// Only active when LOG_LEVEL=trace; no-op otherwise.
subscribeUndiciDiagnostics();

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown initiated.');
  process.exitCode = 0;
  if (workerHandle !== null) {
    clearInterval(workerHandle);
  }
  if (loopMonitorHandle !== null) {
    clearInterval(loopMonitorHandle);
  }
  tempMemberCronTask?.stop();
  potentialApplicantCronTask?.stop();
  keepAliveCronTask?.stop();
  for (const task of nominationDigestCronTasks.values()) task.stop();
  client.destroy();
  endDbPoolIfInitialized().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error closing PG pool during shutdown: ${message}`, err);
  });
  // Force-exit after 10 s as a last-resort safety net in case any remaining
  // handle keeps the event loop alive after cleanup.
  const forceExit = setTimeout(() => process.exit(0), 10_000);
  forceExit.unref();
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

client.once('clientReady', async () => {
  loopMonitorHandle = startEventLoopMonitor();
  subscribeRestEvents(client);
  logger.info(`Bot logged in as ${client.user?.tag}`);
  logger.info(`Length of guilds list: ${client.guilds.cache.size}`);
  logger.info(`BOT_READ_ONLY_MODE=${readOnlyMode}`);
  logger.info(`MANUFACTURING_ENABLED=${manufacturingEnabled}`);
  logger.info(`NOMINATION_DIGEST_ENABLED=${nominationDigestEnabled}`);
  if (isDatabaseConfigured()) {
    try {
      await ensureNominationsSchema();
    } catch (error) {
      logger.error('Failed to initialize nominations database schema', error);
      logger.error('DATABASE_URL is set but schema is not healthy. Aborting startup.');
      process.exit(1);
      return;
    }
    await seedGuildConfigsFromEnv(client);
  }

  const commandRegistration = await registerAllCommands();
  if (commandRegistration.failed.length > 0) {
    logger.warn(`Some slash commands failed registration: ${commandRegistration.failed.join(', ')}`);
  }
  if (readOnlyMode) {
    logger.warn('Read-only mode is enabled. Commands remain registered but non-maintenance behavior is disabled.');
  }

  if (!readOnlyMode && manufacturingEnabled) {
    const { forumChannelId, staffChannelId } = getManufacturingConfig();
    try {
      const [publicCh, staffCh] = await Promise.all([
        client.channels.fetch(forumChannelId),
        client.channels.fetch(staffChannelId),
      ]);
      if (!publicCh || publicCh.type !== ChannelType.GuildForum || !(publicCh instanceof ForumChannel)) {
        logger.error(`[manufacturing] forumChannelId=${forumChannelId} is missing or not a forum channel. Disabling manufacturing.`);
        disableManufacturing();
      } else if (!staffCh || staffCh.type !== ChannelType.GuildForum || !(staffCh instanceof ForumChannel)) {
        logger.error(`[manufacturing] staffChannelId=${staffChannelId} is missing or not a forum channel. Disabling manufacturing.`);
        disableManufacturing();
      } else {
        await Promise.all([ensureForumTags(publicCh), ensureForumTags(staffCh)]);
        logger.info('[manufacturing] Forum tags verified on both channels.');
      }
    } catch (error) {
      logger.error('[manufacturing] Failed to ensure forum tags on startup. Disabling manufacturing.', error);
      disableManufacturing();
    }

    if (manufacturingEnabled) {
      keepAliveCronTask = scheduleCreateOrderKeepAlive(client);
      logger.info('[manufacturing] Scheduled Create Order keep-alive job.');
    }
  }

  if (!readOnlyMode) {
    if (verificationEnabled) {
      await Promise.all(
        [...client.guilds.cache.values()].map(async (guild) => {
          try {
            const guildConfig = await getGuildConfigOrNull(guild.id);
            await addMissingDefaultRoles(guild, client, guildConfig);
          } catch (error) {
            logger.error(`Failed to add missing roles in guild ${guild.id} (${guild.name}):`, error);
          }
        }),
      );
      logger.info('Verification enabled — role setup complete.');
    } else {
      logger.info('VERIFICATION_ENABLED=false — skipping role setup.');
    }

    if (purgeJobsEnabled) {
      tempMemberCronTask = scheduleTemporaryMemberCleanup(client);
      potentialApplicantCronTask = schedulePotentialApplicantCleanup(client);
      logger.info('Scheduled member purge jobs.');
    } else {
      logger.info('PURGE_JOBS_ENABLED=false — member purge jobs will not run.');
    }
    if (nominationDigestEnabled && isDatabaseConfigured()) {
      const allGuildConfigs = await getAllGuildConfigs();
      nominationDigestCronTasks = scheduleNominationDigests(client, allGuildConfigs);
      if (nominationDigestCronTasks.size > 0) {
        logger.info('[nomination-digest] Scheduled digest jobs.', { guilds: nominationDigestCronTasks.size });
      }
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

  // Fire permission audits in the background — DM delivery is independent per
  // guild and must not gate the startup completion log.
  void Promise.allSettled(
    [...client.guilds.cache.values()].map(async (guild) => {
      const missingPerms = checkBotPermissions(guild, getEffectiveAuditFlags());
      if (missingPerms.length > 0) {
        logger.warn(`[${guild.name}] Missing permissions: ${missingPerms.join(', ')}`);
        await notifyOwnerOfMissingPermissions(guild, missingPerms);
      }
    }),
  );

  logger.info('Startup tasks completed.');
  logger.info(
    buildStartupBanner({
      version: appVersion,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV ?? 'development',
      logLevel: process.env.LOG_LEVEL || 'info',
      readOnlyMode,
      dbConfigured: isDatabaseConfigured(),
      nominationWorkerActive: workerHandle !== null,
      nominationDigestJobActive: nominationDigestCronTasks.size > 0,
      purgeJobsEnabled: !readOnlyMode && purgeJobsEnabled,
      rsiVerificationEnabled: !readOnlyMode && verificationEnabled,
      manufacturingOrdersEnabled: !readOnlyMode && manufacturingEnabled,
      guildCount: client.guilds.cache.size,
      botTag: client.user?.tag ?? 'unknown',
      startedAt: new Date().toISOString(),
    }),
  );
});

client.on('guildCreate', async (guild) => {
  logger.info(`[guildCreate] Bot joined guild: ${guild.name} (${guild.id})`);

  if (readOnlyMode) {
    logger.warn(`[${guild.name}] Read-only mode enabled; skipping role setup on guild join.`);
  } else if (!verificationEnabled) {
    logger.info(`[${guild.name}] VERIFICATION_ENABLED=false — skipping role setup on guild join.`);
  } else {
    try {
      const guildConfig = await getGuildConfigOrNull(guild.id);
      await addMissingDefaultRoles(guild, client, guildConfig);
      logger.info(`[${guild.name}] Successfully ensured required roles.`);
    } catch (error) {
      logger.error(`[${guild.name} (${guild.id})] Error ensuring required roles on guild join:`, error);
    }
  }

  if (!readOnlyMode && manufacturingEnabled) {
    const { forumChannelId, staffChannelId } = getManufacturingConfig();
    try {
      // Use guild-scoped fetch so we only act when the manufacturing channels
      // actually belong to this guild. The bot may join guilds that are not the
      // home guild; global client.channels.fetch() would resolve channels from
      // any guild and produce misleading errors / log entries on every unrelated join.
      const [publicCh, staffCh] = await Promise.all([
        guild.channels.fetch(forumChannelId).catch(() => null),
        guild.channels.fetch(staffChannelId).catch(() => null),
      ]);
      if (!publicCh && !staffCh) {
        // Neither channel belongs to this guild — not the home guild, skip silently.
      } else if (!publicCh || publicCh.type !== ChannelType.GuildForum || !(publicCh instanceof ForumChannel)) {
        logger.error(`[${guild.name}] [manufacturing] forumChannelId=${forumChannelId} is missing or not a forum channel. Skipping tag sync.`);
      } else if (!staffCh || staffCh.type !== ChannelType.GuildForum || !(staffCh instanceof ForumChannel)) {
        logger.error(`[${guild.name}] [manufacturing] staffChannelId=${staffChannelId} is missing or not a forum channel. Skipping tag sync.`);
      } else {
        await Promise.all([ensureForumTags(publicCh), ensureForumTags(staffCh)]);
        logger.info(`[${guild.name}] [manufacturing] Forum tags verified on both channels.`);
      }
    } catch (error) {
      logger.error(`[${guild.name}] [manufacturing] Failed to ensure forum tags on guild join.`, error);
    }
  }

  const missingPerms = checkBotPermissions(guild, getEffectiveAuditFlags());
  if (missingPerms.length > 0) {
    logger.warn(`[${guild.name}] Missing permissions: ${missingPerms.join(', ')}`);
    await notifyOwnerOfMissingPermissions(guild, missingPerms);
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
    await attemptFallbackReply(interaction, interaction.id);
  }
});

client.login(DISCORD_BOT_TOKEN);
