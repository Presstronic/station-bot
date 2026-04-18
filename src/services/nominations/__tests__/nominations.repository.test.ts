import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('recordNomination', () => {
  describe('target cap enforcement', () => {
    it('throws NominationTargetCapExceededError when event_count meets targetMaxPerDay', async () => {
      const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
        .mockResolvedValueOnce({ rows: [] })                          // BEGIN
        .mockResolvedValueOnce({ rows: [] })                          // pg_advisory_xact_lock
        .mockResolvedValueOnce({ rows: [{ event_count: 3 }] })        // COUNT cap check
        .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

      const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

      jest.unstable_mockModule('../db.js', () => ({
        isDatabaseConfigured: () => true,
        ensureNominationsSchema: jest.fn(async () => undefined),
        withClient,
      }));

      const { recordNomination, NominationTargetCapExceededError } = await import('../nominations.repository.js');

      await expect(recordNomination('PilotNominee', 'user-1', 'User#0001', null, 3)).rejects.toThrow(
        NominationTargetCapExceededError
      );
    });

    it('throws NominationTargetCapExceededError when event_count exceeds targetMaxPerDay', async () => {
      const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
        .mockResolvedValueOnce({ rows: [] })                          // BEGIN
        .mockResolvedValueOnce({ rows: [] })                          // pg_advisory_xact_lock
        .mockResolvedValueOnce({ rows: [{ event_count: 5 }] })        // COUNT cap check (5 > 3)
        .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

      const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

      jest.unstable_mockModule('../db.js', () => ({
        isDatabaseConfigured: () => true,
        ensureNominationsSchema: jest.fn(async () => undefined),
        withClient,
      }));

      const { recordNomination, NominationTargetCapExceededError } = await import('../nominations.repository.js');

      await expect(recordNomination('PilotNominee', 'user-1', 'User#0001', null, 3)).rejects.toThrow(
        NominationTargetCapExceededError
      );
    });

    it('does not acquire advisory lock when targetMaxPerDay is 0', async () => {
      const fakeRow = {
        normalized_handle: 'pilotnominee',
        display_handle: 'PilotNominee',
        nomination_count: '1',
        lifecycle_state: 'new',
        processed_by_user_id: null,
        processed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_org_check_status: null,
        last_org_check_result_code: null,
        last_org_check_result_message: null,
        last_org_check_result_at: null,
        last_org_check_at: null,
      };

      const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
        .mockResolvedValueOnce({ rows: [] })                          // BEGIN
        .mockResolvedValueOnce({ rows: [] })                          // SELECT lifecycle_state FOR UPDATE (no existing row)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })             // INSERT INTO nominations
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })             // INSERT INTO nomination_events
        .mockResolvedValueOnce({ rows: [fakeRow] })                   // SELECT * FROM nominations
        .mockResolvedValueOnce({ rows: [] })                          // SELECT FROM nomination_events
        .mockResolvedValueOnce({ rows: [] });                         // COMMIT

      const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

      jest.unstable_mockModule('../db.js', () => ({
        isDatabaseConfigured: () => true,
        ensureNominationsSchema: jest.fn(async () => undefined),
        withClient,
      }));

      const { recordNomination } = await import('../nominations.repository.js');
      await recordNomination('PilotNominee', 'user-1', 'User#0001', null, 0);

      const queriedSql = (query.mock.calls as unknown as [string, ...unknown[]][]).map((args) => String(args[0]));
      expect(queriedSql.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(false);
    });

    it('preserves error display handle casing', async () => {
      const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ event_count: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

      jest.unstable_mockModule('../db.js', () => ({
        isDatabaseConfigured: () => true,
        ensureNominationsSchema: jest.fn(async () => undefined),
        withClient,
      }));

      const { recordNomination, NominationTargetCapExceededError } = await import('../nominations.repository.js');

      const error = await recordNomination('PilotNominee', 'user-1', 'User#0001', null, 1)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NominationTargetCapExceededError);
      expect((error as InstanceType<typeof NominationTargetCapExceededError>).displayHandle).toBe('PilotNominee');
    });
  });
});

describe('countUnprocessedNominations', () => {
  it('returns 0 when no unprocessed nominations exist', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countUnprocessedNominations } = await import('../nominations.repository.js');

    await expect(countUnprocessedNominations()).resolves.toBe(0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)::int AS count'));
  });

  it('returns the unprocessed nomination count when rows exist', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countUnprocessedNominations } = await import('../nominations.repository.js');

    await expect(countUnprocessedNominations()).resolves.toBe(3);
  });
});

describe('getNominatorUserIdsByHandle', () => {
  it('returns an empty array when no nomination events exist for the handle', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({ rows: [] });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getNominatorUserIdsByHandle } = await import('../nominations.repository.js');

    await expect(getNominatorUserIdsByHandle('pilotnominee')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT nominator_user_id'), [['pilotnominee']]);
  });

  it('returns distinct nominator ids for the handle', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({
        rows: [
          { nominator_user_id: 'user-1' },
          { nominator_user_id: 'user-2' },
        ],
      });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getNominatorUserIdsByHandle } = await import('../nominations.repository.js');

    await expect(getNominatorUserIdsByHandle('pilotnominee')).resolves.toEqual(['user-1', 'user-2']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT nominator_user_id'), [['pilotnominee']]);
  });
});

describe('getNominatorUserIdsByHandles', () => {
  it('returns an empty array without querying when given no handles', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>();
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getNominatorUserIdsByHandles } = await import('../nominations.repository.js');

    await expect(getNominatorUserIdsByHandles([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns distinct nominator ids across all handles in one query', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({
        rows: [
          { nominator_user_id: 'user-1' },
          { nominator_user_id: 'user-2' },
        ],
      });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getNominatorUserIdsByHandles } = await import('../nominations.repository.js');

    await expect(getNominatorUserIdsByHandles(['pilot1', 'pilot2'])).resolves.toEqual(['user-1', 'user-2']);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE normalized_handle = ANY($1::text[])'),
      [['pilot1', 'pilot2']]
    );
  });
});

describe('markAllNominationsProcessedWithHandles', () => {
  it('returns only the handles updated by the bulk processing operation', async () => {
    const query = jest.fn<() => Promise<{ rows: any[]; rowCount?: number }>>()
      .mockResolvedValueOnce({
        rows: [
          { normalized_handle: 'pilot1' },
          { normalized_handle: 'pilot2' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
      });
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { markAllNominationsProcessedWithHandles, markAllNominationsProcessed } =
      await import('../nominations.repository.js');

    await expect(markAllNominationsProcessedWithHandles('admin-1')).resolves.toEqual(['pilot1', 'pilot2']);
    await expect(markAllNominationsProcessed('admin-1')).resolves.toBe(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('RETURNING normalized_handle'),
      ['admin-1']
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.not.stringContaining('RETURNING normalized_handle'),
      ['admin-1']
    );
  });
});
