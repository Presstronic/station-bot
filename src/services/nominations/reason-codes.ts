import type { OrgCheckResultCode, OrgCheckStatus } from './types.ts';

export const reasonCodeMetadata = {
  in_org: { technical: false, expectedStatus: 'in_org' },
  not_in_org: { technical: false, expectedStatus: 'not_in_org' },
  not_found: { technical: false, expectedStatus: 'unknown' },
  http_timeout: { technical: true, expectedStatus: 'unknown' },
  rate_limited: { technical: true, expectedStatus: 'unknown' },
  parse_failed: { technical: true, expectedStatus: 'unknown' },
  http_error: { technical: true, expectedStatus: 'unknown' },
} satisfies Record<OrgCheckResultCode, { technical: boolean; expectedStatus: OrgCheckStatus }>;

export const technicalResultCodes: OrgCheckResultCode[] = (
  Object.keys(reasonCodeMetadata) as OrgCheckResultCode[]
).filter((code) => reasonCodeMetadata[code].technical);

export function createEmptyReasonCounts(): Record<OrgCheckResultCode, number> {
  const counts = {} as Record<OrgCheckResultCode, number>;
  (Object.keys(reasonCodeMetadata) as OrgCheckResultCode[]).forEach((code) => {
    counts[code] = 0;
  });
  return counts;
}
