// scheduler.ts
import schedule from 'node-schedule';
import { syncUexCorpData } from './uexcorp.jobs';

export function scheduleJobs() {
  // 1) Run on startup:
  syncUexCorpData();

  // 2) Schedule a nightly job at midnight (00:00)
  // CRON format => second (optional), minute, hour, day-of-month, month, day-of-week
  // "0 0 * * *" means run at minute 0, hour 0, daily
  schedule.scheduleJob('0 0 * * *', () => {
    console.log('[scheduler] Running nightly sync job...');
    syncDataJob();
  });
}
