import { describe, expect, it } from '@jest/globals';
import {
  assertValidTransition,
  deriveLifecycleStateFromOrgCheck,
} from '../lifecycle.service.ts';
import type { NominationLifecycleState, OrgCheckResultCode } from '../types.ts';

describe('assertValidTransition', () => {
  const validCases: Array<[NominationLifecycleState, NominationLifecycleState]> = [
    ['new', 'checked'],
    ['new', 'qualified'],
    ['new', 'disqualified_in_org'],
    ['new', 'processed'],
    ['checked', 'checked'],
    ['checked', 'qualified'],
    ['checked', 'disqualified_in_org'],
    ['checked', 'processed'],
    ['qualified', 'checked'],
    ['qualified', 'qualified'],
    ['qualified', 'disqualified_in_org'],
    ['qualified', 'processed'],
    ['disqualified_in_org', 'checked'],
    ['disqualified_in_org', 'qualified'],
    ['disqualified_in_org', 'disqualified_in_org'],
    ['disqualified_in_org', 'processed'],
  ];

  for (const [from, to] of validCases) {
    it(`allows transition ${from} -> ${to}`, () => {
      expect(() => assertValidTransition(from, to)).not.toThrow();
    });
  }

  const invalidFromProcessed: NominationLifecycleState[] = [
    'new',
    'checked',
    'qualified',
    'disqualified_in_org',
    'processed',
  ];

  for (const to of invalidFromProcessed) {
    it(`throws for transition processed -> ${to}`, () => {
      expect(() => assertValidTransition('processed', to)).toThrow(
        `Invalid lifecycle transition: processed -> ${to}`
      );
    });
  }
});

describe('deriveLifecycleStateFromOrgCheck', () => {
  const cases: Array<[OrgCheckResultCode, NominationLifecycleState]> = [
    ['in_org', 'disqualified_in_org'],
    ['not_in_org', 'qualified'],
    ['not_found', 'checked'],
    ['http_timeout', 'checked'],
    ['rate_limited', 'checked'],
    ['parse_failed', 'checked'],
    ['http_error', 'checked'],
  ];

  for (const [code, expectedState] of cases) {
    it(`maps ${code} -> ${expectedState}`, () => {
      expect(deriveLifecycleStateFromOrgCheck(code)).toBe(expectedState);
    });
  }
});
