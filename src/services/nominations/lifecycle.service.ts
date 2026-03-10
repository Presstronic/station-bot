import type { NominationLifecycleState, OrgCheckResultCode } from './types.ts';

const VALID_TRANSITIONS: Record<NominationLifecycleState, readonly NominationLifecycleState[]> = {
  new: ['checked', 'qualified', 'disqualified_in_org', 'processed'],
  checked: ['checked', 'qualified', 'disqualified_in_org', 'processed'],
  qualified: ['checked', 'qualified', 'disqualified_in_org', 'processed'],
  disqualified_in_org: ['checked', 'qualified', 'disqualified_in_org', 'processed'],
  processed: [],
};

export function assertValidTransition(
  from: NominationLifecycleState,
  to: NominationLifecycleState
): void {
  if (!(VALID_TRANSITIONS[from] as readonly string[]).includes(to)) {
    throw new Error(`Invalid lifecycle transition: ${from} -> ${to}`);
  }
}

export function deriveLifecycleStateFromOrgCheck(
  code: OrgCheckResultCode
): Exclude<NominationLifecycleState, 'new' | 'processed'> {
  if (code === 'in_org') return 'disqualified_in_org';
  if (code === 'not_in_org') return 'qualified';
  return 'checked';
}
