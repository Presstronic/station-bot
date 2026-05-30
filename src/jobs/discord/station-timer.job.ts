import cron from 'node-cron';
import type { Client } from 'discord.js';
import { stationTimerPollCron } from '../../config/station-timer.config.js';
import { getLogger } from '../../utils/logger.js';
import { processDueStationTimers } from '../../services/station-timer/station-timer.service.js';

const logger = getLogger();

type ManagedScheduledTask = cron.ScheduledTask & {
  destroy?: () => void;
};

let activeTask: ManagedScheduledTask | null = null;

function disposeTask(task: ManagedScheduledTask | null): void {
  task?.stop();
  task?.destroy?.();
}

export function stopStationTimerWorker(): void {
  disposeTask(activeTask);
  activeTask = null;
}

export function scheduleStationTimerWorker(client: Client): cron.ScheduledTask | null {
  const schedule = stationTimerPollCron();
  if (!cron.validate(schedule)) {
    logger.error('[station-timer] Invalid poll cron; worker not started', { schedule });
    stopStationTimerWorker();
    return null;
  }

  stopStationTimerWorker();
  activeTask = cron.schedule(
    schedule,
    async () => {
      try {
        const processed = await processDueStationTimers(client);
        if (processed > 0) {
          logger.info('[station-timer] Processed due timers', { processed });
        }
      } catch (error) {
        logger.error('[station-timer] Worker tick failed', { error });
      }
    },
    { timezone: 'UTC' },
  ) as ManagedScheduledTask;

  logger.info('[station-timer] Scheduled worker', { schedule });
  return activeTask;
}
