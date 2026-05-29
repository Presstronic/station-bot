import {
  ensureExecHangarStateRow,
  getExecHangarState,
  updateExecHangarState,
  type ExecHangarChangeType,
  type ExecHangarState,
  type ExecHangarStateName,
} from '../../domain/exec-hangar/exec-hangar.repository.js';
import { fetchExecHangarSyncAnchor } from './exec-hangar-sync-source.js';

export interface ExecHangarDerivedStatus {
  initialized: boolean;
  currentState: ExecHangarStateName | null;
  nextChangeType: ExecHangarChangeType | null;
  minutesUntilNextChange: number | null;
  nextChangeAt: string | null;
  lastSyncedAt: string | null;
  syncSource: string | null;
  confidence: 'good' | 'stale';
  warningKey: 'startupStale' | null;
}

let hasSuccessfulSyncSinceStartup = false;

function getOppositeState(state: ExecHangarStateName): ExecHangarStateName {
  return state === 'OPEN' ? 'CLOSED' : 'OPEN';
}

function getChangeTypeForState(state: ExecHangarStateName): ExecHangarChangeType {
  return state === 'OPEN' ? 'OPEN' : 'CLOSE';
}

function getStateForChangeType(changeType: ExecHangarChangeType): ExecHangarStateName {
  return changeType === 'OPEN' ? 'OPEN' : 'CLOSED';
}

function getPreviousStateForChangeType(changeType: ExecHangarChangeType): ExecHangarStateName {
  return getOppositeState(getStateForChangeType(changeType));
}

function getEffectiveDurationsMs(state: ExecHangarState): {
  openMs: number;
  closedMs: number;
  totalMs: number;
} {
  const baseOpenMs = state.openDurationMinutes * 60_000;
  const baseClosedMs = state.closedDurationMinutes * 60_000;
  const baseTotalMs = baseOpenMs + baseClosedMs;
  const adjustedTotalMs = baseTotalMs + state.cycleOffsetMs;
  const openMs = Math.round((adjustedTotalMs * baseOpenMs) / baseTotalMs);
  const closedMs = adjustedTotalMs - openMs;

  return {
    openMs,
    closedMs,
    totalMs: adjustedTotalMs,
  };
}

function durationForStateMs(state: ExecHangarState, currentState: ExecHangarStateName): number {
  const durations = getEffectiveDurationsMs(state);
  return currentState === 'OPEN' ? durations.openMs : durations.closedMs;
}

function computeMinutesUntil(nextChangeAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((nextChangeAtMs - nowMs) / 60_000));
}

export function deriveExecHangarStatus(
  state: ExecHangarState,
  now = new Date(),
): ExecHangarDerivedStatus {
  if (!state.currentState || !state.nextChangeAt || !state.nextChangeType) {
    return {
      initialized: false,
      currentState: null,
      nextChangeType: null,
      minutesUntilNextChange: null,
      nextChangeAt: null,
      lastSyncedAt: state.lastSyncedAt,
      syncSource: state.syncSource,
      confidence: hasSuccessfulSyncSinceStartup ? 'good' : 'stale',
      warningKey: hasSuccessfulSyncSinceStartup ? null : 'startupStale',
    };
  }

  const nowMs = now.getTime();
  const storedNextChangeAtMs = new Date(state.nextChangeAt).getTime();

  if (nowMs < storedNextChangeAtMs) {
    return {
      initialized: true,
      currentState: state.currentState,
      nextChangeType: state.nextChangeType,
      minutesUntilNextChange: computeMinutesUntil(storedNextChangeAtMs, nowMs),
      nextChangeAt: new Date(storedNextChangeAtMs).toISOString(),
      lastSyncedAt: state.lastSyncedAt,
      syncSource: state.syncSource,
      confidence: hasSuccessfulSyncSinceStartup ? 'good' : 'stale',
      warningKey: hasSuccessfulSyncSinceStartup ? null : 'startupStale',
    };
  }

  const firstState = getStateForChangeType(state.nextChangeType);
  const secondState = getOppositeState(firstState);
  const firstDurationMs = durationForStateMs(state, firstState);
  const secondDurationMs = durationForStateMs(state, secondState);
  const elapsedSinceTransitionMs = nowMs - storedNextChangeAtMs;

  if (elapsedSinceTransitionMs < firstDurationMs) {
    const nextChangeAtMs = storedNextChangeAtMs + firstDurationMs;
    return {
      initialized: true,
      currentState: firstState,
      nextChangeType: getChangeTypeForState(secondState),
      minutesUntilNextChange: computeMinutesUntil(nextChangeAtMs, nowMs),
      nextChangeAt: new Date(nextChangeAtMs).toISOString(),
      lastSyncedAt: state.lastSyncedAt,
      syncSource: state.syncSource,
      confidence: hasSuccessfulSyncSinceStartup ? 'good' : 'stale',
      warningKey: hasSuccessfulSyncSinceStartup ? null : 'startupStale',
    };
  }

  const elapsedAfterFirstStateMs = elapsedSinceTransitionMs - firstDurationMs;
  const fullCycleMs = firstDurationMs + secondDurationMs;
  const cycleOffsetMs = elapsedAfterFirstStateMs % fullCycleMs;
  const cycleBaseMs = storedNextChangeAtMs + firstDurationMs + (elapsedAfterFirstStateMs - cycleOffsetMs);

  if (cycleOffsetMs < secondDurationMs) {
    const nextChangeAtMs = cycleBaseMs + secondDurationMs;
    return {
      initialized: true,
      currentState: secondState,
      nextChangeType: getChangeTypeForState(firstState),
      minutesUntilNextChange: computeMinutesUntil(nextChangeAtMs, nowMs),
      nextChangeAt: new Date(nextChangeAtMs).toISOString(),
      lastSyncedAt: state.lastSyncedAt,
      syncSource: state.syncSource,
      confidence: hasSuccessfulSyncSinceStartup ? 'good' : 'stale',
      warningKey: hasSuccessfulSyncSinceStartup ? null : 'startupStale',
    };
  }

  const nextChangeAtMs = cycleBaseMs + secondDurationMs + firstDurationMs;
  return {
    initialized: true,
    currentState: firstState,
    nextChangeType: getChangeTypeForState(secondState),
    minutesUntilNextChange: computeMinutesUntil(nextChangeAtMs, nowMs),
    nextChangeAt: new Date(nextChangeAtMs).toISOString(),
    lastSyncedAt: state.lastSyncedAt,
    syncSource: state.syncSource,
    confidence: hasSuccessfulSyncSinceStartup ? 'good' : 'stale',
    warningKey: hasSuccessfulSyncSinceStartup ? null : 'startupStale',
  };
}

export async function getExecHangarStatus(now = new Date()): Promise<ExecHangarDerivedStatus> {
  const state = (await getExecHangarState()) ?? (await ensureExecHangarStateRow());
  return deriveExecHangarStatus(state, now);
}

export async function updateExecHangarConfig(input: {
  openDurationMinutes: number;
  closedDurationMinutes: number;
  cycleOffsetMs: number;
}): Promise<ExecHangarState> {
  return updateExecHangarState({
    openDurationMinutes: input.openDurationMinutes,
    closedDurationMinutes: input.closedDurationMinutes,
    cycleOffsetMs: input.cycleOffsetMs,
  });
}

export async function manualSyncExecHangar(
  nextChangeType: ExecHangarChangeType,
  minutesUntilNextChange: number,
  now = new Date(),
): Promise<ExecHangarState> {
  const nextChangeAt = new Date(now.getTime() + minutesUntilNextChange * 60_000).toISOString();
  const currentState = getPreviousStateForChangeType(nextChangeType);
  const updated = await updateExecHangarState({
    currentState,
    nextChangeAt,
    nextChangeType,
    lastSyncedAt: now.toISOString(),
    syncSource: 'manual-admin',
  });
  hasSuccessfulSyncSinceStartup = true;
  return updated;
}

export async function resyncExecHangarFromExternalSource(now = new Date()): Promise<ExecHangarState> {
  const anchor = await fetchExecHangarSyncAnchor(now);
  const nextState = getOppositeState(anchor.currentState);
  const updated = await updateExecHangarState({
    currentState: anchor.currentState,
    nextChangeAt: new Date(now.getTime() + anchor.remainingMs).toISOString(),
    nextChangeType: getChangeTypeForState(nextState),
    lastSyncedAt: now.toISOString(),
    syncSource: anchor.source,
  });
  hasSuccessfulSyncSinceStartup = true;
  return updated;
}

export async function performExecHangarStartupSync(now = new Date()): Promise<{
  success: boolean;
  state: ExecHangarState;
  error?: unknown;
}> {
  const existing = (await getExecHangarState()) ?? (await ensureExecHangarStateRow());

  try {
    const updated = await resyncExecHangarFromExternalSource(now);
    return { success: true, state: updated };
  } catch (error) {
    return { success: false, state: existing, error };
  }
}

export function markExecHangarSyncSucceededForTests(): void {
  hasSuccessfulSyncSinceStartup = true;
}

export function resetExecHangarServiceForTests(): void {
  hasSuccessfulSyncSinceStartup = false;
}
