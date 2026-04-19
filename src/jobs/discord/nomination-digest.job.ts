import cron from 'node-cron';
import type { Client } from 'discord.js';
import { getNominationDigestConfig } from '../../config/nomination-digest.config.js';
import { countUnprocessedNominations } from '../../services/nominations/nominations.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

function buildDigestMessage(roleId: string, count: number): string {
  if (count === 0) {
    return `<@&${roleId}> Daily nomination digest: there are currently no unprocessed nominations in the queue.`;
  }

  return `<@&${roleId}> Daily nomination digest: **${count}** unprocessed nomination(s) are currently in the queue.`;
}

export function scheduleNominationDigest(client: Client): cron.ScheduledTask | null {
  const { cronSchedule } = getNominationDigestConfig();

  if (!cron.validate(cronSchedule)) {
    logger.error('[nomination-digest] Invalid NOMINATION_DIGEST_CRON_SCHEDULE — job will not run', {
      cronSchedule,
    });
    return null;
  }

  return cron.schedule(
    cronSchedule,
    async () => {
      const { channelId, roleId } = getNominationDigestConfig();

      const channel = await client.channels.fetch(channelId).catch((error: unknown) => {
        logger.warn('[nomination-digest] Failed to fetch digest channel', { channelId, error });
        return null;
      });

      if (!channel) {
        return;
      }

      if (!channel.isTextBased() || !('send' in channel)) {
        logger.warn('[nomination-digest] Configured digest channel is not text-based', { channelId });
        return;
      }

      try {
        const count = await countUnprocessedNominations();
        await channel.send({
          content: buildDigestMessage(roleId, count),
          allowedMentions: { roles: [roleId] },
        });
      } catch (error) {
        logger.warn('[nomination-digest] Failed to send daily nomination digest', { channelId, error });
      }
    },
    { timezone: 'UTC' },
  );
}
