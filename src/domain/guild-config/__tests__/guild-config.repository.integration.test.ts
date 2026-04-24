/**
 * Integration tests for guild-config.repository.
 *
 * Requires a real Postgres instance with DATABASE_URL set and migrations applied.
 * Run via: DATABASE_URL=... npm run test:integration -- --testPathPattern=guild-config.repository.integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { getDbPool, endDbPoolIfInitialized } from '../../../services/nominations/db.js';
import { upsertGuildConfig, getGuildConfig, getAllGuildConfigs } from '../guild-config.repository.js';

const TEST_GUILD_ID = 'integration-test-guild';

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to run integration tests');
  }
});

beforeEach(async () => {
  await getDbPool().query(`DELETE FROM guild_configs WHERE guild_id = $1`, [TEST_GUILD_ID]);
});

afterAll(async () => {
  await getDbPool().query(`DELETE FROM guild_configs WHERE guild_id = $1`, [TEST_GUILD_ID]);
  await endDbPoolIfInitialized();
});

describe('upsertGuildConfig — partial patch (integration)', () => {
  it('inserts a row with all DB defaults when patch is empty', async () => {
    const result = await upsertGuildConfig(TEST_GUILD_ID, {});

    expect(result.guildId).toBe(TEST_GUILD_ID);
    expect(result.verificationEnabled).toBe(true);
    expect(result.verifiedRoleName).toBe('Verified');
    expect(result.nominationDigestEnabled).toBe(false);
    expect(result.manufacturingOrderLimit).toBe(5);
    expect(result.tempMemberHoursToExpire).toBe(48);
    expect(result.birthdayEnabled).toBe(false);
  });

  it('inserts only patched columns and preserves defaults for the rest', async () => {
    const result = await upsertGuildConfig(TEST_GUILD_ID, {
      nominationDigestEnabled: true,
      nominationDigestChannelId: 'chan-integration',
    });

    expect(result.nominationDigestEnabled).toBe(true);
    expect(result.nominationDigestChannelId).toBe('chan-integration');
    // Defaults must be preserved for unpatched columns
    expect(result.verifiedRoleName).toBe('Verified');
    expect(result.manufacturingOrderLimit).toBe(5);
    expect(result.tempMemberHoursToExpire).toBe(48);
  });

  it('updates only the patched columns on a second upsert, leaving others unchanged', async () => {
    await upsertGuildConfig(TEST_GUILD_ID, {
      nominationDigestEnabled: true,
      nominationDigestChannelId: 'chan-integration',
    });

    const updated = await upsertGuildConfig(TEST_GUILD_ID, {
      verifiedRoleName: 'Full Member',
    });

    // Patched column updated
    expect(updated.verifiedRoleName).toBe('Full Member');
    // Previously set column must be untouched
    expect(updated.nominationDigestEnabled).toBe(true);
    expect(updated.nominationDigestChannelId).toBe('chan-integration');
    // Default column must remain at its default
    expect(updated.manufacturingOrderLimit).toBe(5);
  });

  it('getGuildConfig returns the row after upsert', async () => {
    await upsertGuildConfig(TEST_GUILD_ID, { purgeJobsEnabled: true });
    const fetched = await getGuildConfig(TEST_GUILD_ID);

    expect(fetched).not.toBeNull();
    expect(fetched!.purgeJobsEnabled).toBe(true);
  });

  it('getAllGuildConfigs includes the upserted row', async () => {
    await upsertGuildConfig(TEST_GUILD_ID, {});
    const all = await getAllGuildConfigs();

    const found = all.find((c) => c.guildId === TEST_GUILD_ID);
    expect(found).toBeDefined();
  });
});
