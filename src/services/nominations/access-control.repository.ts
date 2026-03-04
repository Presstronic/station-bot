import { ensureNominationsSchema, isDatabaseConfigured, withClient } from './db.ts';

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for nomination access control');
  }
}

export async function getReviewProcessRoleIds(): Promise<string[]> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT role_id
      FROM nomination_access_roles
      ORDER BY role_id ASC
      `
    )
  );
  return result.rows.map((row) => row.role_id as string);
}

export async function addReviewProcessRoleId(
  roleId: string
): Promise<{ added: boolean; roleIds: string[] }> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  return withClient(async (client) => {
    const result = await client.query(
      `
      INSERT INTO nomination_access_roles(role_id)
      VALUES ($1)
      ON CONFLICT (role_id) DO NOTHING
      `,
      [roleId]
    );
    const rolesResult = await client.query(
      `
      SELECT role_id
      FROM nomination_access_roles
      ORDER BY role_id ASC
      `
    );
    return {
      added: (result.rowCount ?? 0) > 0,
      roleIds: rolesResult.rows.map((row) => row.role_id as string),
    };
  });
}

export async function removeReviewProcessRoleId(
  roleId: string
): Promise<{ removed: boolean; roleIds: string[] }> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  return withClient(async (client) => {
    const result = await client.query(
      `
      DELETE FROM nomination_access_roles
      WHERE role_id = $1
      `,
      [roleId]
    );
    const rolesResult = await client.query(
      `
      SELECT role_id
      FROM nomination_access_roles
      ORDER BY role_id ASC
      `
    );
    return {
      removed: (result.rowCount ?? 0) > 0,
      roleIds: rolesResult.rows.map((row) => row.role_id as string),
    };
  });
}

export async function resetReviewProcessRoleIds(): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();
  await withClient((client) => client.query('TRUNCATE nomination_access_roles'));
}
