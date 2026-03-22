import type { AntiAbuseViolation, NominationRatePolicy } from './types.js';
import { SECONDS_PER_DAY } from './types.js';
import {
  countNominationsByUserInWindow,
  countNominationsForTargetInWindow,
  getSecondsSinceLastNominationByUser,
  getSecondsUntilUserWindowResets,
} from './nominations.repository.js';

export async function checkNominationAntiAbuse(
  userId: string,
  normalizedHandle: string,
  displayHandle: string,
  policy: NominationRatePolicy
): Promise<AntiAbuseViolation | null> {
  if (policy.userCooldownSeconds > 0) {
    const secondsAgo = await getSecondsSinceLastNominationByUser(userId);
    if (secondsAgo !== null && secondsAgo < policy.userCooldownSeconds) {
      return { kind: 'cooldown', secondsRemaining: policy.userCooldownSeconds - secondsAgo };
    }
  }

  if (policy.targetMaxPerDay > 0) {
    const count = await countNominationsForTargetInWindow(normalizedHandle, SECONDS_PER_DAY);
    if (count >= policy.targetMaxPerDay) {
      return { kind: 'targetDailyLimit', displayHandle };
    }
  }

  if (policy.userMaxPerDay > 0) {
    const count = await countNominationsByUserInWindow(userId, SECONDS_PER_DAY);
    if (count >= policy.userMaxPerDay) {
      const secondsUntilReset = await getSecondsUntilUserWindowResets(userId, SECONDS_PER_DAY);
      // Guard against boundary-time skew: if reset time is 0, the window may have rolled
      // over between the count query and the reset query. Re-check before blocking.
      if (!secondsUntilReset) {
        const refreshedCount = await countNominationsByUserInWindow(userId, SECONDS_PER_DAY);
        if (refreshedCount < policy.userMaxPerDay) {
          return null;
        }
      }
      return { kind: 'userDailyLimit', secondsUntilReset };
    }
  }

  return null;
}
