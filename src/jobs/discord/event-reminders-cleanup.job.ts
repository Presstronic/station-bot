import cron from 'node-cron';
import {
  deleteOldReminderClaims,
  deleteOldEventState,
} from '../../services/event-reminders/event-reminders.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

let activeTask: cron.ScheduledTask | null = null;

async function runCleanupTick(retentionDays: number): Promise<void> {
  try {
    const [reminderRows, stateRows] = await Promise.all([
      deleteOldReminderClaims(retentionDays),
      deleteOldEventState(retentionDays),
    ]);
    if (reminderRows > 0 || stateRows > 0) {
      logger.info('[event-reminders-cleanup] Removed stale rows', {
        retentionDays,
        reminderRows,
        stateRows,
      });
    }
  } catch (error) {
    logger.warn('[event-reminders-cleanup] Cleanup tick failed', { retentionDays, error });
  }
}

export function scheduleEventRemindersCleanup(
  cronSchedule: string,
  retentionDays: number,
): cron.ScheduledTask | null {
  activeTask?.stop();
  activeTask = null;

  if (!cron.validate(cronSchedule)) {
    logger.error('[event-reminders-cleanup] Invalid cron schedule; cleanup not scheduled', { cronSchedule });
    return null;
  }

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    logger.error('[event-reminders-cleanup] Invalid retentionDays; cleanup not scheduled', { retentionDays });
    return null;
  }

  activeTask = cron.schedule(
    cronSchedule,
    () => runCleanupTick(retentionDays),
    { timezone: 'UTC' },
  );
  logger.info('[event-reminders-cleanup] Scheduled cleanup job', { cronSchedule, retentionDays });
  return activeTask;
}

// Exposed for tests so module state can be reset without relying on
// jest.resetModules() side-effects.
export function resetEventRemindersCleanupForTests(): void {
  activeTask?.stop();
  activeTask = null;
}
