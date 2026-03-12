import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function makeDbMock(queryResult: { rows: unknown[] }) {
  const query = jest.fn(async () => queryResult);
  return {
    withClient: jest.fn(async (cb: (client: { query: typeof query }) => Promise<unknown>) =>
      cb({ query })
    ),
    isDatabaseConfigured: jest.fn(() => true),
    ensureNominationsSchema: jest.fn(async () => undefined),
    query,
  };
}

function mockRequestContext(correlationId: string | undefined) {
  jest.unstable_mockModule('../../../utils/request-context.ts', () => ({
    getCorrelationId: jest.fn(() => correlationId),
    runWithCorrelationId: jest.fn(),
  }));
}

describe('recordAuditEvent', () => {
  it('inserts an audit row with all fields', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { recordAuditEvent } = await import('../audit.repository.ts');

    await recordAuditEvent({
      eventType: 'nomination_processed_single',
      actorUserId: 'u1',
      actorUserTag: 'user#0001',
      targetHandle: 'PilotA',
      payloadJson: { found: true },
      result: 'success',
    });

    expect(db.withClient).toHaveBeenCalledTimes(1);
    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[1]).toEqual([
      'nomination_processed_single',
      'u1',
      'user#0001',
      'PilotA',
      null,
      JSON.stringify({ found: true }),
      'success',
      null,
      null,
    ]);
  });

  it('captures correlation_id from request context when available', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext('corr-abc-123');

    const { recordAuditEvent } = await import('../audit.repository.ts');

    await recordAuditEvent({
      eventType: 'nomination_processed_bulk',
      actorUserId: 'u1',
      actorUserTag: 'user#0001',
      result: 'success',
      payloadJson: { processedCount: 5 },
    });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[1][8]).toBe('corr-abc-123');
  });

  it('stores null for correlation_id when no context is active', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { recordAuditEvent } = await import('../audit.repository.ts');

    await recordAuditEvent({
      eventType: 'nomination_access_roles_reset',
      actorUserId: 'u1',
      actorUserTag: 'user#0001',
      result: 'success',
    });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[1][8]).toBeNull();
  });

  it('inserts a failure audit row with error message', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { recordAuditEvent } = await import('../audit.repository.ts');

    await recordAuditEvent({
      eventType: 'nomination_access_role_added',
      actorUserId: 'u2',
      actorUserTag: 'admin#0001',
      targetRoleId: 'role-42',
      result: 'failure',
      errorMessage: 'DB connection lost',
    });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[1]).toEqual([
      'nomination_access_role_added',
      'u2',
      'admin#0001',
      null,
      'role-42',
      null,
      'failure',
      'DB connection lost',
      null,
    ]);
  });

  it('throws when database is not configured', async () => {
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: jest.fn(),
      isDatabaseConfigured: jest.fn(() => false),
      ensureNominationsSchema: jest.fn(async () => undefined),
    }));
    mockRequestContext(undefined);

    const { recordAuditEvent } = await import('../audit.repository.ts');

    await expect(
      recordAuditEvent({
        eventType: 'nomination_processed_bulk',
        actorUserId: 'u1',
        actorUserTag: 'user#0001',
        result: 'success',
      })
    ).rejects.toThrow('DATABASE_URL is required');
  });
});

describe('getAuditEvents', () => {
  it('returns empty array when no rows', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    const result = await getAuditEvents();
    expect(result).toEqual([]);
  });

  it('maps db rows to AuditEvent objects including correlationId', async () => {
    const now = new Date('2026-03-12T10:00:00Z');
    const db = makeDbMock({
      rows: [
        {
          id: 1,
          event_type: 'nomination_processed_single',
          actor_user_id: 'u1',
          actor_user_tag: 'user#0001',
          target_handle: 'PilotA',
          target_role_id: null,
          payload_json: { found: true },
          result: 'success',
          error_message: null,
          correlation_id: 'corr-xyz',
          created_at: now,
        },
      ],
    });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    const result = await getAuditEvents();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      eventType: 'nomination_processed_single',
      actorUserId: 'u1',
      actorUserTag: 'user#0001',
      targetHandle: 'PilotA',
      payloadJson: { found: true },
      result: 'success',
      correlationId: 'corr-xyz',
      createdAt: now.toISOString(),
    });
    expect(result[0].targetRoleId).toBeUndefined();
    expect(result[0].errorMessage).toBeUndefined();
  });

  it('maps null correlation_id to undefined', async () => {
    const now = new Date('2026-03-12T10:00:00Z');
    const db = makeDbMock({
      rows: [
        {
          id: 2,
          event_type: 'nomination_processed_bulk',
          actor_user_id: 'u1',
          actor_user_tag: 'user#0001',
          target_handle: null,
          target_role_id: null,
          payload_json: null,
          result: 'success',
          error_message: null,
          correlation_id: null,
          created_at: now,
        },
      ],
    });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    const result = await getAuditEvents();
    expect(result[0].correlationId).toBeUndefined();
  });

  it('applies eventType filter in SQL', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    await getAuditEvents({ eventType: 'nomination_processed_bulk' });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[0]).toContain('event_type =');
    expect(queryArgs[1]).toContain('nomination_processed_bulk');
  });

  it('applies since filter in SQL', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    const since = new Date('2026-01-01T00:00:00Z');
    await getAuditEvents({ since });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[0]).toContain('created_at >');
    expect(queryArgs[1]).toContain(since.toISOString());
  });

  it('applies limit in SQL', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    await getAuditEvents({ limit: 10 });

    const queryArgs = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(queryArgs[0]).toContain('LIMIT');
    expect(queryArgs[1]).toContain(10);
  });

  it('throws on invalid limit', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    await expect(getAuditEvents({ limit: 0 })).rejects.toThrow('Invalid limit');
  });

  it('throws when database is not configured', async () => {
    jest.unstable_mockModule('../db.ts', () => ({
      withClient: jest.fn(),
      isDatabaseConfigured: jest.fn(() => false),
      ensureNominationsSchema: jest.fn(async () => undefined),
    }));
    mockRequestContext(undefined);

    const { getAuditEvents } = await import('../audit.repository.ts');

    await expect(getAuditEvents()).rejects.toThrow('DATABASE_URL is required');
  });
});
