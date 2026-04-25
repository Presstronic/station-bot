import cron from 'node-cron';
import { Client } from 'discord.js';
import { getGuildConfigOrNull, type GuildConfig } from '../../domain/guild-config/guild-config.service.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

const activeTasks = new Map<string, cron.ScheduledTask>();

function createTaskForGuild(client: Client, guildId: string, cronSchedule: string): cron.ScheduledTask {
  const task = cron.schedule(
    cronSchedule,
    async () => {
      try {
        const guildConfig = await getGuildConfigOrNull(guildId);

        if (!guildConfig?.manufacturingEnabled) {
          logger.warn('[manufacturing] Keep-alive: manufacturing disabled for guild at tick time; skipping', { guildId });
          return;
        }

        const createOrderThreadId = guildConfig.manufacturingCreateOrderThreadId;

        if (!createOrderThreadId) {
          logger.warn('[manufacturing] Keep-alive: no createOrderThreadId configured for guild', { guildId });
          return;
        }

        const thread = await client.channels.fetch(createOrderThreadId).catch((error: unknown) => {
          logger.warn('[manufacturing] Keep-alive: failed to fetch Create Order thread', { createOrderThreadId, error });
          return null;
        });

        if (!thread) {
          logger.warn('[manufacturing] Keep-alive: Create Order thread was not found or is not accessible', {
            createOrderThreadId,
          });
          return;
        }

        if (!thread.isThread()) {
          logger.warn('[manufacturing] Keep-alive: channel is not a thread', { createOrderThreadId });
          return;
        }

        if (thread.archived) {
          try {
            await thread.setArchived(false);
            logger.info('[manufacturing] Keep-alive: unarchived Create Order thread', { threadId: thread.id });
          } catch (error) {
            logger.warn('[manufacturing] Keep-alive: failed to unarchive Create Order thread', {
              threadId: thread.id,
              error,
            });
          }
        } else {
          logger.debug('[manufacturing] Keep-alive: Create Order thread is active, no action needed');
        }
      } catch (error) {
        logger.warn('[manufacturing] Keep-alive: unhandled error in tick', { guildId, error });
      }
    },
    { timezone: 'UTC' },
  );
  activeTasks.set(guildId, task);
  return task;
}

export function scheduleManufacturingKeepalives(
  client: Client,
  guildConfigs: GuildConfig[],
): Map<string, cron.ScheduledTask> {
  for (const config of guildConfigs) {
    const { guildId, manufacturingKeepaliveCronSchedule } = config;

    if (!config.manufacturingEnabled) {
      activeTasks.get(guildId)?.stop();
      activeTasks.delete(guildId);
      continue;
    }

    if (!cron.validate(manufacturingKeepaliveCronSchedule)) {
      logger.error('[manufacturing] Keep-alive: invalid cron schedule — job will not run', {
        guildId,
        manufacturingKeepaliveCronSchedule,
      });
      activeTasks.get(guildId)?.stop();
      activeTasks.delete(guildId);
      continue;
    }

    activeTasks.get(guildId)?.stop();
    createTaskForGuild(client, guildId, manufacturingKeepaliveCronSchedule);
  }

  return activeTasks;
}

export function rescheduleGuildKeepalive(
  client: Client,
  guildId: string,
  guildConfig: GuildConfig,
): cron.ScheduledTask | null {
  const existing = activeTasks.get(guildId);
  if (existing) {
    existing.stop();
    activeTasks.delete(guildId);
  }

  const { manufacturingKeepaliveCronSchedule } = guildConfig;

  if (!cron.validate(manufacturingKeepaliveCronSchedule)) {
    logger.error('[manufacturing] Keep-alive: invalid cron schedule for reschedule', {
      guildId,
      manufacturingKeepaliveCronSchedule,
    });
    return null;
  }

  return createTaskForGuild(client, guildId, manufacturingKeepaliveCronSchedule);
}
