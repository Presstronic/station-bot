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

  const shouldCheckTargetCap = policy.targetMaxPerDay > 0;
  const shouldCheckUserCap = policy.userMaxPerDay > 0;

  if (shouldCheckTargetCap || shouldCheckUserCap) {
    // These independent daily-cap reads run in parallel to remove one round-trip
    // from the post-cooldown path. A shared-client variant is tracked separately
    // because reducing pool pressure is a distinct concern from preserving the
    // current repository helper surface here.
    const targetCountPromise = shouldCheckTargetCap
      ? countNominationsForTargetInWindow(normalizedHandle, SECONDS_PER_DAY)
      : Promise.resolve(0);
    const userCountPromise = shouldCheckUserCap
      ? countNominationsByUserInWindow(userId, SECONDS_PER_DAY)
      : Promise.resolve(0);
    void userCountPromise.catch(() => undefined);
    let targetCount: number;
    targetCount = await targetCountPromise;

    if (shouldCheckTargetCap && targetCount >= policy.targetMaxPerDay) {
      return { kind: 'targetDailyLimit', displayHandle };
    }

    const userCount = await userCountPromise;
    if (shouldCheckUserCap && userCount >= policy.userMaxPerDay) {
      const secondsUntilReset = await getSecondsUntilUserWindowResets(userId, SECONDS_PER_DAY, policy.userMaxPerDay);
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
