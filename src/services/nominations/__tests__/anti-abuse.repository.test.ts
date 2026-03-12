import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('getSecondsSinceLastNominationByUser', () => {
  it('returns null when database is not configured', async () => {
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => false,
      ensureNominationsSchema: jest.fn(),
      withClient: jest.fn(),
    }));

    const { getSecondsSinceLastNominationByUser } = await import('../nominations.repository.ts');
    expect(await getSecondsSinceLastNominationByUser('user-1')).toBeNull();
  });

  it('returns null when user has no prior nomination events', async () => {
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) =>
      fn({ query: jest.fn(async () => ({ rows: [] })) })
    );
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getSecondsSinceLastNominationByUser } = await import('../nominations.repository.ts');
    expect(await getSecondsSinceLastNominationByUser('user-1')).toBeNull();
  });

  it('returns seconds elapsed when a prior event exists', async () => {
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) =>
      fn({ query: jest.fn(async () => ({ rows: [{ seconds_ago: 45 }] })) })
    );
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getSecondsSinceLastNominationByUser } = await import('../nominations.repository.ts');
    expect(await getSecondsSinceLastNominationByUser('user-1')).toBe(45);
  });

  it('passes userId as the query parameter', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { getSecondsSinceLastNominationByUser } = await import('../nominations.repository.ts');
    await getSecondsSinceLastNominationByUser('user-42');

    expect(query).toHaveBeenCalledWith(expect.any(String), ['user-42']);
  });
});

describe('countNominationsForTargetInWindow', () => {
  it('returns 0 when database is not configured', async () => {
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => false,
      ensureNominationsSchema: jest.fn(),
      withClient: jest.fn(),
    }));

    const { countNominationsForTargetInWindow } = await import('../nominations.repository.ts');
    expect(await countNominationsForTargetInWindow('pilotnominee', 86400)).toBe(0);
  });

  it('returns count from query result', async () => {
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) =>
      fn({ query: jest.fn(async () => ({ rows: [{ event_count: 3 }] })) })
    );
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countNominationsForTargetInWindow } = await import('../nominations.repository.ts');
    expect(await countNominationsForTargetInWindow('pilotnominee', 86400)).toBe(3);
  });

  it('passes normalizedHandle and windowSeconds as query parameters', async () => {
    const query = jest.fn(async () => ({ rows: [{ event_count: 0 }] }));
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countNominationsForTargetInWindow } = await import('../nominations.repository.ts');
    await countNominationsForTargetInWindow('pilotnominee', 86400);

    expect(query).toHaveBeenCalledWith(expect.any(String), ['pilotnominee', 86400]);
  });
});

describe('countNominationsByUserInWindow', () => {
  it('returns 0 when database is not configured', async () => {
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => false,
      ensureNominationsSchema: jest.fn(),
      withClient: jest.fn(),
    }));

    const { countNominationsByUserInWindow } = await import('../nominations.repository.ts');
    expect(await countNominationsByUserInWindow('user-1', 86400)).toBe(0);
  });

  it('returns count from query result', async () => {
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) =>
      fn({ query: jest.fn(async () => ({ rows: [{ event_count: 7 }] })) })
    );
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countNominationsByUserInWindow } = await import('../nominations.repository.ts');
    expect(await countNominationsByUserInWindow('user-1', 86400)).toBe(7);
  });

  it('passes userId and windowSeconds as query parameters', async () => {
    const query = jest.fn(async () => ({ rows: [{ event_count: 0 }] }));
    const withClient = jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query }));
    jest.unstable_mockModule('../db.ts', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { countNominationsByUserInWindow } = await import('../nominations.repository.ts');
    await countNominationsByUserInWindow('user-99', 86400);

    expect(query).toHaveBeenCalledWith(expect.any(String), ['user-99', 86400]);
  });
});
