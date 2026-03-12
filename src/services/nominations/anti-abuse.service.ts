import type { AntiAbuseViolation, NominationRatePolicy } from './types.ts';
import {
  countNominationsByUserInWindow,
  countNominationsForTargetInWindow,
  getSecondsSinceLastNominationByUser,
} from './nominations.repository.ts';

const SECONDS_PER_DAY = 86400;

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
      return { kind: 'userDailyLimit' };
    }
  }

  return null;
}
