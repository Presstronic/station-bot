import { isDatabaseConfigured, withClient } from '../../services/nominations/db.js';
import { generateUuidV7 } from '../../utils/uuidv7.js';

export type ExecHangarStateName = 'OPEN' | 'CLOSED';
export type ExecHangarChangeType = 'OPEN' | 'CLOSE';

export interface ExecHangarState {
  id: string;
  singletonKey: 'global';
  currentState: ExecHangarStateName | null;
  nextChangeAt: string | null;
  nextChangeType: ExecHangarChangeType | null;
  lastSyncedAt: string | null;
  syncSource: string | null;
  openDurationMinutes: number;
  closedDurationMinutes: number;
  cycleOffsetMs: number;
  createdAt: string;
  updatedAt: string;
}

export type ExecHangarStatePatch = Partial<
  Pick<
    ExecHangarState,
    | 'currentState'
    | 'nextChangeAt'
    | 'nextChangeType'
    | 'lastSyncedAt'
    | 'syncSource'
    | 'openDurationMinutes'
    | 'closedDurationMinutes'
    | 'cycleOffsetMs'
  >
>;

const SINGLETON_KEY = 'global' as const;

const PATCH_COLUMN_MAP: Record<keyof ExecHangarStatePatch, string> = {
  currentState: 'current_state',
  nextChangeAt: 'next_change_at',
  nextChangeType: 'next_change_type',
  lastSyncedAt: 'last_synced_at',
  syncSource: 'sync_source',
  openDurationMinutes: 'open_duration_minutes',
  closedDurationMinutes: 'closed_duration_minutes',
  cycleOffsetMs: 'cycle_offset_ms',
};

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for exec hangar state');
  }
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value as string | number | Date).toISOString();
}

function mapExecHangarRow(row: Record<string, unknown>): ExecHangarState {
  return {
    id: String(row.id),
    singletonKey: SINGLETON_KEY,
    currentState:
      row.current_state === 'OPEN' || row.current_state === 'CLOSED'
        ? (row.current_state as ExecHangarStateName)
        : null,
    nextChangeAt: toIsoString(row.next_change_at),
    nextChangeType:
      row.next_change_type === 'OPEN' || row.next_change_type === 'CLOSE'
        ? (row.next_change_type as ExecHangarChangeType)
        : null,
    lastSyncedAt: toIsoString(row.last_synced_at),
    syncSource: row.sync_source != null ? String(row.sync_source) : null,
    openDurationMinutes: Number(row.open_duration_minutes),
    closedDurationMinutes: Number(row.closed_duration_minutes),
    cycleOffsetMs: Number(row.cycle_offset_ms),
    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | number | Date).toISOString(),
  };
}

export async function getExecHangarState(): Promise<ExecHangarState | null> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT * FROM exec_hangar_state WHERE singleton_key = $1`,
      [SINGLETON_KEY],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapExecHangarRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function ensureExecHangarStateRow(): Promise<ExecHangarState> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const result = await client.query(
      `INSERT INTO exec_hangar_state (
         id,
         singleton_key,
         open_duration_minutes,
         closed_duration_minutes,
         cycle_offset_ms
       )
       VALUES ($1, $2, 60, 120, 0)
       ON CONFLICT (singleton_key) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [generateUuidV7(), SINGLETON_KEY],
    );
    return mapExecHangarRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function updateExecHangarState(patch: ExecHangarStatePatch): Promise<ExecHangarState> {
  assertDatabaseConfigured();

  return withClient(async (client) => {
    const rawEntries = Object.entries(patch).filter(([, value]) => value !== undefined);
    for (const [key] of rawEntries) {
      if (!Object.hasOwn(PATCH_COLUMN_MAP, key)) {
        throw new Error(`updateExecHangarState: unknown patch key "${key}"`);
      }
    }

    const entries = rawEntries as [keyof ExecHangarStatePatch, unknown][];

    if (entries.length === 0) {
      const result = await client.query(
        `INSERT INTO exec_hangar_state (
           id,
           singleton_key,
           open_duration_minutes,
           closed_duration_minutes,
           cycle_offset_ms
         )
         VALUES ($1, $2, 60, 120, 0)
         ON CONFLICT (singleton_key) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [generateUuidV7(), SINGLETON_KEY],
      );
      return mapExecHangarRow(result.rows[0] as Record<string, unknown>);
    }

    const columns = entries.map(([key]) => PATCH_COLUMN_MAP[key]);
    const values = entries.map(([, value]) => value);
    const insertColumns = ['id', 'singleton_key', ...columns].join(', ');
    const insertPlaceholders = ['$1', '$2', ...columns.map((_, index) => `$${index + 3}`)].join(', ');
    const updateAssignments = columns.map((column, index) => `${column} = $${index + 3}`).join(', ');

    const result = await client.query(
      `INSERT INTO exec_hangar_state (${insertColumns})
       VALUES (${insertPlaceholders})
       ON CONFLICT (singleton_key) DO UPDATE SET
         ${updateAssignments},
         updated_at = NOW()
       RETURNING *`,
      [generateUuidV7(), SINGLETON_KEY, ...values],
    );
    return mapExecHangarRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function ensureExecHangarSchema(): Promise<void> {
  assertDatabaseConfigured();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'exec_hangar_state'
      `,
    ),
  );

  const requiredColumns = new Set([
    'id',
    'singleton_key',
    'current_state',
    'next_change_at',
    'next_change_type',
    'last_synced_at',
    'sync_source',
    'open_duration_minutes',
    'closed_duration_minutes',
    'cycle_offset_ms',
    'created_at',
    'updated_at',
  ]);
  const presentColumns = new Set(result.rows.map((row) => String(row.column_name)));
  const missingColumns = [...requiredColumns].filter((column) => !presentColumns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing exec_hangar_state columns (${missingColumns.join(', ')}). Run database migrations before starting the bot.`,
    );
  }
}
