import './bootstrap.js'; // Loads dotenv and any shared setup

import { createRequire } from 'node:module';
import { ChannelType, Client, ForumChannel, IntentsBitField } from 'discord.js';
import { registerAllCommands } from './commands/register-commands.js';
import { handleInteraction, attemptFallbackReply } from './interactions/interactionRouter.js';
import { schedulePurgeJobs } from './jobs/discord/purge-member.job.js';
import { scheduleManufacturingKeepalives } from './jobs/discord/manufacturing-keepalive.job.js';
import { scheduleNominationDigests } from './jobs/discord/nomination-digest.job.js';
import { addMissingDefaultRoles } from './services/role.services.js';
import { getLogger } from './utils/logger.js';
import { isReadOnlyMode, isVerificationEnabled } from './config/runtime-flags.js';
import { isNominationDigestEnabled } from './config/nomination-digest.config.js';
import { isManufacturingEnabled } from './config/manufacturing.config.js';
import { isExecHangarEnabled } from './config/exec-hangar.config.js';
import {
  endDbPoolIfInitialized,
  ensureNominationsSchema,
  isDatabaseConfigured,
} from './services/nominations/db.js';
import { seedGuildConfigFromEnv, seedGuildConfigsFromEnv } from './domain/guild-config/guild-config.seeder.js';
import { ensureGuildConfigsSchema, getGuildConfigOrNull, getAllGuildConfigs, type GuildConfig } from './domain/guild-config/guild-config.service.js';
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
import { ensureExecHangarSchema } from './domain/exec-hangar/exec-hangar.repository.js';
import { performExecHangarStartupSync } from './services/exec-hangar/exec-hangar-timer.service.js';

const _require = createRequire(import.meta.url);
const { version: appVersion } = _require('../package.json') as { version: string };

const logger = getLogger();
const readOnlyMode = isReadOnlyMode();
const verificationEnabled = isVerificationEnabled();
const manufacturingEnabled = isManufacturingEnabled();
const nominationDigestEnabled = isNominationDigestEnabled();
const execHangarEnabled = isExecHangarEnabled();

function getEffectiveAuditFlags(guildConfig: GuildConfig | null) {
  return {
    verificationEnabled: verificationEnabled && !readOnlyMode && guildConfig?.verificationEnabled === true,
    purgeJobsEnabled: !readOnlyMode && guildConfig?.purgeJobsEnabled === true,
    manufacturingEnabled: !readOnlyMode && manufacturingEnabled && guildConfig?.manufacturingEnabled === true,
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

let workerHandle: NodeJS.Timeout | null = null;
let loopMonitorHandle: NodeJS.Timeout | null = null;
let purgeCronTasks: Map<string, { stop: () => void }> = new Map();
let keepAliveCronTasks: Map<string, { stop: () => void }> = new Map();
let nominationDigestCronTasks: Map<string, { stop: () => void }> = new Map();
let guildConfigsById = new Map<string, GuildConfig>();
let shuttingDown = false;

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
  for (const task of purgeCronTasks.values()) task.stop();
  for (const task of keepAliveCronTasks.values()) task.stop();
  for (const task of nominationDigestCronTasks.values()) task.stop();
  client.destroy();
  endDbPoolIfInitialized().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Error closing PG pool during shutdown: ${message}`, err);
  });
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
  logger.info(`EXEC_HANGAR_ENABLED=${execHangarEnabled}`);
  if (isDatabaseConfigured()) {
    try {
      await ensureNominationsSchema();
      await ensureGuildConfigsSchema();
      if (execHangarEnabled) {
        await ensureExecHangarSchema();
      }
    } catch (error) {
      logger.error('Failed to initialize database schema', error);
      logger.error('DATABASE_URL is set but schema is not healthy. Aborting startup.');
      process.exit(1);
      return;
    }
    if (!readOnlyMode) {
      try {
        await seedGuildConfigsFromEnv(client);
      } catch (error) {
        logger.error('Failed to seed guild configs from environment', error);
        logger.error('DATABASE_URL is set but guild config seeding failed. Aborting startup.');
        process.exit(1);
        return;
      }
    } else {
      logger.info('Read-only mode enabled; skipping guild config seeding from environment.');
    }
  }

  const commandRegistration = await registerAllCommands();
  if (commandRegistration.failed.length > 0) {
    logger.warn(`Some slash commands failed registration: ${commandRegistration.failed.join(', ')}`);
  }
  if (readOnlyMode) {
    logger.warn('Read-only mode is enabled. Commands remain registered but non-maintenance behavior is disabled.');
  }

  if (!readOnlyMode) {
    if (verificationEnabled) {
      await Promise.all(
        [...client.guilds.cache.values()].map(async (guild) => {
          let guildConfig = null;
          let configLoadFailed = false;
          if (isDatabaseConfigured()) {
            try {
              guildConfig = await getGuildConfigOrNull(guild.id);
            } catch (error) {
              configLoadFailed = true;
              logger.warn(`Failed to load guild config for role setup in guild ${guild.id} (${guild.name}); skipping role setup to avoid creating unexpected roles`, error);
            }
          }
          if (!configLoadFailed) {
            try {
              await addMissingDefaultRoles(guild, client, guildConfig);
            } catch (error) {
              logger.error(`Failed to add missing roles in guild ${guild.id} (${guild.name}):`, error);
            }
          }
        }),
      );
      logger.info('Verification enabled — role setup complete.');
    } else {
      logger.info('VERIFICATION_ENABLED=false — skipping role setup.');
    }

    if (isDatabaseConfigured()) {
      let allGuildConfigs: GuildConfig[];
      try {
        allGuildConfigs = await getAllGuildConfigs();
        guildConfigsById = new Map(allGuildConfigs.map((config) => [config.guildId, config]));
      } catch (error) {
        logger.error('Failed to load guild configs for job scheduling; skipping guild-config-driven jobs.', { error });
        allGuildConfigs = [];
        guildConfigsById = new Map();
      }
      purgeCronTasks = schedulePurgeJobs(client, allGuildConfigs);
      if (purgeCronTasks.size > 0) {
        logger.info('[purge] Scheduled temporary member purge jobs.', { guilds: purgeCronTasks.size });
      }
      if (nominationDigestEnabled) {
        nominationDigestCronTasks = scheduleNominationDigests(client, allGuildConfigs);
        if (nominationDigestCronTasks.size > 0) {
          logger.info('[nomination-digest] Scheduled digest jobs.', { guilds: nominationDigestCronTasks.size });
        }
      }
      if (manufacturingEnabled) {
        keepAliveCronTasks = scheduleManufacturingKeepalives(client, allGuildConfigs);
        if (keepAliveCronTasks.size > 0) {
          logger.info('[manufacturing] Scheduled keep-alive jobs.', { guilds: keepAliveCronTasks.size });
        }
      }
      workerHandle = startNominationCheckWorkerLoop();
      if (workerHandle) {
        logger.info('Started nomination check worker loop.');
      }
    } else {
      logger.info('DATABASE_URL is not configured — guild-config-driven jobs will not run.');
    }
  } else {
    logger.warn('Read-only mode is enabled. Skipping default role creation and cleanup job scheduling.');
  }

  if (execHangarEnabled && !readOnlyMode) {
    if (!isDatabaseConfigured()) {
      logger.warn('[exec-hangar] DATABASE_URL is not configured. Feature will remain unavailable.');
    } else {
      const startupSync = await performExecHangarStartupSync();
      if (startupSync.success) {
        logger.info('[exec-hangar] Startup sync succeeded.', {
          currentState: startupSync.state.currentState,
          nextChangeAt: startupSync.state.nextChangeAt,
          nextChangeType: startupSync.state.nextChangeType,
          openDurationMinutes: startupSync.state.openDurationMinutes,
          closedDurationMinutes: startupSync.state.closedDurationMinutes,
          cycleOffsetMs: startupSync.state.cycleOffsetMs,
        });
      } else {
        logger.warn('[exec-hangar] Startup sync failed; preserving existing local state.', {
          error: startupSync.error,
          hasBaseline: Boolean(startupSync.state.currentState && startupSync.state.nextChangeAt && startupSync.state.nextChangeType),
          openDurationMinutes: startupSync.state.openDurationMinutes,
          closedDurationMinutes: startupSync.state.closedDurationMinutes,
          cycleOffsetMs: startupSync.state.cycleOffsetMs,
        });
      }
    }
  } else if (execHangarEnabled) {
    logger.info('[exec-hangar] Read-only mode enabled; skipping startup sync.');
  }

  void Promise.allSettled(
    [...client.guilds.cache.values()].map(async (guild) => {
      const missingPerms = checkBotPermissions(guild, getEffectiveAuditFlags(guildConfigsById.get(guild.id) ?? null));
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
      purgeJobsEnabled: purgeCronTasks.size > 0,
      rsiVerificationEnabled: !readOnlyMode && verificationEnabled,
      manufacturingOrdersEnabled: !readOnlyMode && manufacturingEnabled,
      execHangarEnabled: !readOnlyMode && execHangarEnabled && isDatabaseConfigured(),
      guildCount: client.guilds.cache.size,
      botTag: client.user?.tag ?? 'unknown',
      startedAt: new Date().toISOString(),
    }),
  );
});

client.on('guildCreate', async (guild) => {
  logger.info(`[guildCreate] Bot joined guild: ${guild.name} (${guild.id})`);
  let guildConfig: GuildConfig | null = null;

  if (!readOnlyMode && isDatabaseConfigured()) {
    await seedGuildConfigFromEnv(guild.id, guild.name);
    guildConfig = await getGuildConfigOrNull(guild.id).catch(() => null);
    if (guildConfig) {
      guildConfigsById.set(guild.id, guildConfig);
    }
  }

  if (readOnlyMode) {
    logger.warn(`[${guild.name}] Read-only mode enabled; skipping role setup on guild join.`);
  } else if (!verificationEnabled) {
    logger.info(`[${guild.name}] VERIFICATION_ENABLED=false — skipping role setup on guild join.`);
  } else {
    if (isDatabaseConfigured() && guildConfig === null) {
      try {
        guildConfig = await getGuildConfigOrNull(guild.id);
        if (guildConfig) {
          guildConfigsById.set(guild.id, guildConfig);
        }
      } catch (error) {
        logger.warn(`[${guild.name} (${guild.id})] Failed to load guild config on guild join; skipping role setup`, error);
      }
    }
    try {
      await addMissingDefaultRoles(guild, client, guildConfig);
      logger.info(`[${guild.name}] Successfully ensured required roles.`);
    } catch (error) {
      logger.error(`[${guild.name} (${guild.id})] Error ensuring required roles on guild join:`, error);
    }
  }

  if (!readOnlyMode && manufacturingEnabled) {
    if (guildConfig === null) {
      guildConfig = await getGuildConfigOrNull(guild.id).catch(() => null);
      if (guildConfig) {
        guildConfigsById.set(guild.id, guildConfig);
      }
    }
    const forumChannelId = guildConfig?.manufacturingForumChannelId;
    const staffChannelId = guildConfig?.manufacturingStaffChannelId;
    if (guildConfig?.manufacturingEnabled && forumChannelId && staffChannelId) {
      try {
        const [publicCh, staffCh] = await Promise.all([
          guild.channels.fetch(forumChannelId).catch(() => null),
          guild.channels.fetch(staffChannelId).catch(() => null),
        ]);
        if (!publicCh && !staffCh) {
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
  }

  const missingPerms = checkBotPermissions(guild, getEffectiveAuditFlags(guildConfig));
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
