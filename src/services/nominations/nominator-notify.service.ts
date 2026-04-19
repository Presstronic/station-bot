import type { Client } from 'discord.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

const NOMINATOR_NOTIFICATION_MESSAGE =
  'A player you nominated has been reviewed by our recruitment team. Thank you for your contribution to the org.';

export async function notifyNominators(
  client: Client,
  nominatorUserIds: string[],
): Promise<void> {
  const uniqueUserIds = [...new Set(nominatorUserIds)];

  for (const userId of uniqueUserIds) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(NOMINATOR_NOTIFICATION_MESSAGE);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to notify nominator ${userId}: ${errorMessage}`);
    }
  }
}
