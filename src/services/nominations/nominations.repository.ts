import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { NominationRecord, NominationsStore, OrgCheckStatus } from './types.ts';

const defaultStorePath = './data/nominations.json';

function getStorePath(): string {
  return process.env.NOMINATIONS_STORE_PATH || defaultStorePath;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function readStore(): NominationsStore {
  const storePath = getStorePath();

  try {
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as NominationsStore;
    return { nominations: parsed.nominations || [] };
  } catch {
    return { nominations: [] };
  }
}

function writeStore(store: NominationsStore): void {
  const storePath = getStorePath();
  mkdirSync(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tempPath, storePath);
}

export function recordNomination(
  rsiHandle: string,
  nominatorUserId: string,
  nominatorUserTag: string,
  reason: string | null
): NominationRecord {
  const now = new Date().toISOString();
  const normalizedHandle = normalizeHandle(rsiHandle);
  const store = readStore();
  let nomination = store.nominations.find((n) => n.normalizedHandle === normalizedHandle);

  if (!nomination) {
    nomination = {
      normalizedHandle,
      displayHandle: rsiHandle.trim(),
      nominationCount: 0,
      isProcessed: false,
      processedByUserId: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    };
    store.nominations.push(nomination);
  }

  nomination.nominationCount += 1;
  nomination.updatedAt = now;
  nomination.isProcessed = false;
  nomination.processedAt = null;
  nomination.processedByUserId = null;
  nomination.events.push({
    nominatorUserId,
    nominatorUserTag,
    reason,
    createdAt: now,
  });

  writeStore(store);
  return nomination;
}

export function getUnprocessedNominations(): NominationRecord[] {
  const store = readStore();
  return store.nominations
    .filter((n) => !n.isProcessed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function updateOrgCheckStatus(normalizedHandle: string, status: OrgCheckStatus): void {
  const store = readStore();
  const nomination = store.nominations.find((n) => n.normalizedHandle === normalizedHandle);
  if (!nomination) {
    return;
  }

  nomination.lastOrgCheckStatus = status;
  nomination.lastOrgCheckAt = new Date().toISOString();
  nomination.updatedAt = nomination.lastOrgCheckAt;
  writeStore(store);
}

export function markNominationProcessedByHandle(
  rsiHandle: string,
  processedByUserId: string
): boolean {
  const normalizedHandle = normalizeHandle(rsiHandle);
  const store = readStore();
  const nomination = store.nominations.find(
    (n) => n.normalizedHandle === normalizedHandle && !n.isProcessed
  );
  if (!nomination) {
    return false;
  }

  const now = new Date().toISOString();
  nomination.isProcessed = true;
  nomination.processedByUserId = processedByUserId;
  nomination.processedAt = now;
  nomination.updatedAt = now;
  writeStore(store);
  return true;
}

export function markAllNominationsProcessed(processedByUserId: string): number {
  const store = readStore();
  const now = new Date().toISOString();
  let updated = 0;

  for (const nomination of store.nominations) {
    if (nomination.isProcessed) {
      continue;
    }
    nomination.isProcessed = true;
    nomination.processedByUserId = processedByUserId;
    nomination.processedAt = now;
    nomination.updatedAt = now;
    updated += 1;
  }

  if (updated > 0) {
    writeStore(store);
  }

  return updated;
}
