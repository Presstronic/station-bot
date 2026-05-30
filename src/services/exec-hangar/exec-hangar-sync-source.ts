import axios from 'axios';
import { rsiHttpTimeoutMs } from '../../config/runtime-flags.js';
import type { ExecHangarStateName } from '../../domain/exec-hangar/exec-hangar.repository.js';

export interface ExecHangarSyncAnchor {
  currentState: ExecHangarStateName;
  remainingMs: number;
  observedAt: string;
  source: 'exec.xyxyll.com';
  openDurationMinutes: number;
  closedDurationMinutes: number;
  cycleOffsetMs: number;
}

interface ParsedSourceConfig {
  initialOpenTime: Date;
  openDurationMinutes: number;
  closedDurationMinutes: number;
  cycleDriftMs: number;
}

const SOURCE_URL = 'https://exec.xyxyll.com/';
const SOURCE_SCRIPT_URL = 'https://exec.xyxyll.com/app.js';

function parseRequiredNumber(script: string, pattern: RegExp, fieldName: string): number {
  const match = script.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not parse ${fieldName} from exec hangar source`);
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName} value from exec hangar source`);
  }
  return parsed;
}

function parseRequiredString(script: string, pattern: RegExp, fieldName: string): string {
  const match = script.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not parse ${fieldName} from exec hangar source`);
  }
  return match[1];
}

export function parseExecHangarSourceScript(script: string): ParsedSourceConfig {
  const cycleDriftMs = parseRequiredNumber(script, /const CYCLE_DRIFT_MS = (-?\d+);/, 'cycle drift');
  const openDurationMinutes = parseRequiredNumber(script, /const DESIGN_ONLINE_MIN\s*=\s*(\d+);/, 'open duration');
  const closedDurationMinutes = parseRequiredNumber(script, /const DESIGN_OFFLINE_MIN\s*=\s*(\d+);/, 'closed duration');
  const initialOpenTimeRaw = parseRequiredString(
    script,
    /const INITIAL_OPEN_TIME = new Date\('([^']+)'\);/,
    'initial open time',
  );
  const initialOpenTime = new Date(initialOpenTimeRaw);

  if (Number.isNaN(initialOpenTime.getTime())) {
    throw new Error('Invalid initial open time in exec hangar source');
  }

  return {
    initialOpenTime,
    openDurationMinutes,
    closedDurationMinutes,
    cycleDriftMs,
  };
}

function computeEffectiveDurationsMs(
  openDurationMinutes: number,
  closedDurationMinutes: number,
  cycleOffsetMs: number,
): { openMs: number; closedMs: number; totalMs: number } {
  const baseOpenMs = openDurationMinutes * 60_000;
  const baseClosedMs = closedDurationMinutes * 60_000;
  const baseTotalMs = baseOpenMs + baseClosedMs;
  const adjustedTotalMs = baseTotalMs + cycleOffsetMs;
  const openMs = Math.round((adjustedTotalMs * baseOpenMs) / baseTotalMs);
  const closedMs = adjustedTotalMs - openMs;

  return {
    openMs,
    closedMs,
    totalMs: adjustedTotalMs,
  };
}

export function deriveAnchorFromSourceConfig(
  parsed: ParsedSourceConfig,
  now = new Date(),
): ExecHangarSyncAnchor {
  const { openMs, closedMs, totalMs } = computeEffectiveDurationsMs(
    parsed.openDurationMinutes,
    parsed.closedDurationMinutes,
    parsed.cycleDriftMs,
  );

  const elapsedMs = now.getTime() - parsed.initialOpenTime.getTime();
  const normalizedMs = ((elapsedMs % totalMs) + totalMs) % totalMs;

  if (normalizedMs < openMs) {
    return {
      currentState: 'OPEN',
      remainingMs: Math.max(0, openMs - normalizedMs),
      observedAt: now.toISOString(),
      source: 'exec.xyxyll.com',
      openDurationMinutes: parsed.openDurationMinutes,
      closedDurationMinutes: parsed.closedDurationMinutes,
      cycleOffsetMs: parsed.cycleDriftMs,
    };
  }

  const closeElapsedMs = normalizedMs - openMs;
  return {
    currentState: 'CLOSED',
    remainingMs: Math.max(0, closedMs - closeElapsedMs),
    observedAt: now.toISOString(),
    source: 'exec.xyxyll.com',
    openDurationMinutes: parsed.openDurationMinutes,
    closedDurationMinutes: parsed.closedDurationMinutes,
    cycleOffsetMs: parsed.cycleDriftMs,
  };
}

export async function fetchExecHangarSyncAnchor(now = new Date()): Promise<ExecHangarSyncAnchor> {
  const response = await axios.get<string>(SOURCE_SCRIPT_URL, {
    timeout: rsiHttpTimeoutMs(),
    headers: {
      Accept: 'application/javascript, text/javascript, */*;q=0.1',
      Referer: SOURCE_URL,
    },
  });

  const parsed = parseExecHangarSourceScript(response.data);
  return deriveAnchorFromSourceConfig(parsed, now);
}
