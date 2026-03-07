export type NominationCheckJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type NominationCheckJobScope = 'all' | 'single';
export type NominationCheckJobItemStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NominationCheckJob {
  id: number;
  createdByUserId: string;
  status: NominationCheckJobStatus;
  requestedScope: NominationCheckJobScope;
  requestedHandle: string | null;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  runningCount: number;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface NominationCheckJobItem {
  id: number;
  jobId: number;
  normalizedHandle: string;
  status: NominationCheckJobItemStatus;
  attemptCount: number;
  lastError: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueNominationCheckJobResult {
  job: NominationCheckJob;
  reused: boolean;
}
