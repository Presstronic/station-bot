import { Pool, type PoolClient } from 'pg';
import { getLogger } from '../../utils/logger.ts';

const logger = getLogger();

let poolInstance: Pool | null = null;
let schemaEnsured = false;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
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
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000),
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

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS nominations (
        normalized_handle TEXT PRIMARY KEY,
        display_handle TEXT NOT NULL,
        nomination_count INTEGER NOT NULL DEFAULT 0,
        is_processed BOOLEAN NOT NULL DEFAULT FALSE,
        processed_by_user_id TEXT NULL,
        processed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_org_check_status TEXT NULL,
        last_org_check_at TIMESTAMPTZ NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS nomination_events (
        id BIGSERIAL PRIMARY KEY,
        normalized_handle TEXT NOT NULL REFERENCES nominations(normalized_handle) ON DELETE CASCADE,
        nominator_user_id TEXT NOT NULL,
        nominator_user_tag TEXT NOT NULL,
        reason TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nomination_events_handle_created_at
      ON nomination_events(normalized_handle, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS nomination_access_roles (
        role_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  schemaEnsured = true;
  logger.info('Nomination schema ensured.');
}
