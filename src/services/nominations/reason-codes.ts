import type { OrgCheckResultCode } from './types.ts';

export const reasonCodeMetadata = {
  in_org: { technical: false },
  not_in_org: { technical: false },
  not_found: { technical: false },
  http_timeout: { technical: true },
  rate_limited: { technical: true },
  parse_failed: { technical: true },
  http_error: { technical: true },
} satisfies Record<OrgCheckResultCode, { technical: boolean }>;

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
