import { Pool, type PoolClient } from 'pg';
import { getLogger } from '../../utils/logger.ts';
import { readFileSync } from 'fs';

const logger = getLogger();

let poolInstance: Pool | null = null;
let schemaEnsured = false;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function getSslConfig() {
  const sslEnabled = envFlag('PG_SSL_ENABLED', false);
  if (!sslEnabled) {
    return undefined;
  }

  const rejectUnauthorized = envFlag('PG_SSL_REJECT_UNAUTHORIZED', true);
  const caPath = process.env.PG_SSL_CA_PATH;
  if (!caPath) {
    return { rejectUnauthorized };
  }

  try {
    const ca = readFileSync(caPath, 'utf8');
    return { rejectUnauthorized, ca };
  } catch (error) {
    logger.error(`Failed reading PG_SSL_CA_PATH (${caPath}): ${String(error)}`);
    throw error;
  }
}

export function getDbPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (poolInstance) {
    return poolInstance;
  }

  poolInstance = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(1, envInt('PG_POOL_MAX', 10)),
    idleTimeoutMillis: Math.max(0, envInt('PG_IDLE_TIMEOUT_MS', 30000)),
    connectionTimeoutMillis: Math.max(0, envInt('PG_CONNECT_TIMEOUT_MS', 10000)),
    statement_timeout: Math.max(0, envInt('PG_STATEMENT_TIMEOUT_MS', 15000)),
    ssl: getSslConfig(),
  });

  poolInstance.on('error', (error) => {
    logger.error(`PostgreSQL pool error: ${String(error)}`);
  });

  return poolInstance;
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDbPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function ensureNominationsSchema(): Promise<void> {
  if (!isDatabaseConfigured() || schemaEnsured) {
    return;
  }

  const { schemaResult, nominationsColumnsResult } = await withClient(async (client) => {
    const schemaResult = await client.query(`
      SELECT
        to_regclass('public.nominations') AS nominations_table,
        to_regclass('public.nomination_events') AS nomination_events_table,
        to_regclass('public.nomination_access_roles') AS nomination_access_roles_table
    `);
    const nominationsColumnsResult = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nominations'
      `
    );
    return { schemaResult, nominationsColumnsResult };
  });

  const row = schemaResult.rows[0];
  const missing = [
    row?.nominations_table ? null : 'nominations',
    row?.nomination_events_table ? null : 'nomination_events',
    row?.nomination_access_roles_table ? null : 'nomination_access_roles',
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(
      `Missing nomination schema objects (${missing.join(', ')}). Run database migrations before starting the bot.`
    );
  }

  const nominationColumns = new Set<string>(
    nominationsColumnsResult.rows.map((row) => String(row.column_name))
  );
  const requiredNominationColumns = [
    'last_org_check_status',
    'last_org_check_result_code',
    'last_org_check_result_message',
    'last_org_check_result_at',
    'last_org_check_at',
  ];
  const missingNominationColumns = requiredNominationColumns.filter(
    (columnName) => !nominationColumns.has(columnName)
  );
  if (missingNominationColumns.length > 0) {
    throw new Error(
      `Missing nominations columns (${missingNominationColumns.join(', ')}). Run database migrations before starting the bot.`
    );
  }

  schemaEnsured = true;
  logger.info('Nomination schema check passed.');
}
