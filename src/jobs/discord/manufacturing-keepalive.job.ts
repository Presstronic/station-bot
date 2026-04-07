import cron from 'node-cron';
import { Client } from 'discord.js';
import { getManufacturingConfig } from '../../config/manufacturing.config.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

export function scheduleCreateOrderKeepAlive(client: Client): cron.ScheduledTask {
  const { keepAliveCronSchedule } = getManufacturingConfig();

  return cron.schedule(
    keepAliveCronSchedule,
    async () => {
      const { createOrderThreadId } = getManufacturingConfig();

      if (!createOrderThreadId) {
        logger.warn('[manufacturing] Keep-alive: MANUFACTURING_CREATE_ORDER_THREAD_ID is not set — skipping');
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
    },
    { timezone: 'UTC' },
  );
}
