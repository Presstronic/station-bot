export type OrgCheckStatus = 'in_org' | 'not_in_org' | 'unknown';

export type NominationEvent = {
  nominatorUserId: string;
  nominatorUserTag: string;
  reason: string | null;
  createdAt: string;
};

export type NominationRecord = {
  normalizedHandle: string;
  displayHandle: string;
  nominationCount: number;
  isProcessed: boolean;
  processedByUserId: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOrgCheckStatus: OrgCheckStatus | null;
  lastOrgCheckAt: string | null;
  events: NominationEvent[];
};

export type NominationsStore = {
  nominations: NominationRecord[];
};
