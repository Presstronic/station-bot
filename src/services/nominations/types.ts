export const SECONDS_PER_DAY = 86400;

export type OrgCheckStatus = 'in_org' | 'not_in_org' | 'unknown';

export type OrgCheckResultCode =
  | 'in_org'
  | 'not_in_org'
  | 'not_found'
  | 'http_timeout'
  | 'rate_limited'
  | 'parse_failed'
  | 'http_error';

export interface OrgCheckResult {
  code: OrgCheckResultCode;
  status: OrgCheckStatus;
  message?: string;
  checkedAt: string;
}

export type NominationEvent = {
  nominatorUserId: string;
  nominatorUserTag: string;
  reason: string | null;
  createdAt: string;
};

export type NominationLifecycleState =
  | 'new'
  | 'checked'
  | 'qualified'
  | 'disqualified_in_org'
  | 'processed';

export type NominationRecord = {
  normalizedHandle: string;
  displayHandle: string;
  nominationCount: number;
  lifecycleState: NominationLifecycleState;
  processedByUserId: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOrgCheckStatus: OrgCheckStatus | null;
  lastOrgCheckResultCode: OrgCheckResultCode | null;
  lastOrgCheckResultMessage: string | null;
  lastOrgCheckResultAt: string | null;
  lastOrgCheckAt: string | null;
  events: NominationEvent[];
};

export type NominationsStore = {
  nominations: NominationRecord[];
};

export interface NominationRatePolicy {
  userCooldownSeconds: number;
  targetMaxPerDay: number;
  userMaxPerDay: number;
}

export type AntiAbuseViolation =
  | { kind: 'cooldown'; secondsRemaining: number }
  | { kind: 'targetDailyLimit'; displayHandle: string }
  | { kind: 'userDailyLimit'; secondsUntilReset: number };

export class NominationTargetCapExceededError extends Error {
  readonly displayHandle: string;
  constructor(displayHandle: string) {
    super(`Target daily nomination cap exceeded for ${displayHandle}`);
    this.name = 'NominationTargetCapExceededError';
    this.displayHandle = displayHandle;
  }
}
