import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function makeDbMock(queryResult: { rows: unknown[] } = { rows: [] }) {
  const query = jest.fn(async () => queryResult);
  return {
    withClient: jest.fn(async (cb: (client: { query: typeof query }) => Promise<unknown>) =>
      cb({ query }),
    ),
    isDatabaseConfigured: jest.fn(() => true),
    ensureNominationsSchema: jest.fn(async () => undefined),
    query,
  };
}

describe('tryClaimReminder', () => {
  it('returns true when the insert produces a row', async () => {
    const db = makeDbMock({ rows: [{ id: 1 }] });
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { tryClaimReminder } = await import('../event-reminders.repository.js');
    const claimed = await tryClaimReminder('guild-1', 'event-1', '24h', 'channel-1');

    expect(claimed).toBe(true);
    const args = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(args[0]).toContain('INSERT INTO event_reminders');
    expect(args[0]).toContain('ON CONFLICT (event_id, reminder_key) DO NOTHING');
    expect(args[1]).toEqual(['guild-1', 'event-1', '24h', 'channel-1']);
  });

  it('returns false when the row already exists (no rows returned)', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { tryClaimReminder } = await import('../event-reminders.repository.js');
    const claimed = await tryClaimReminder('guild-1', 'event-1', '24h', 'channel-1');

    expect(claimed).toBe(false);
  });
});

describe('releaseReminderClaim', () => {
  it('deletes the matching row by event_id and reminder_key', async () => {
    const db = makeDbMock();
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { releaseReminderClaim } = await import('../event-reminders.repository.js');
    await releaseReminderClaim('event-1', '6h');

    const args = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(args[0]).toContain('DELETE FROM event_reminders');
    expect(args[1]).toEqual(['event-1', '6h']);
  });
});

describe('getEventState', () => {
  it('returns null when no row exists', async () => {
    const db = makeDbMock({ rows: [] });
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { getEventState } = await import('../event-reminders.repository.js');
    const state = await getEventState('event-1');
    expect(state).toBeNull();
  });

  it('maps the row to camelCase fields with ISO start time', async () => {
    const startIso = '2026-05-25T12:00:00.000Z';
    const db = makeDbMock({
      rows: [{ event_id: 'event-1', guild_id: 'guild-1', last_known_start_time: startIso }],
    });
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { getEventState } = await import('../event-reminders.repository.js');
    const state = await getEventState('event-1');

    expect(state).toEqual({
      eventId: 'event-1',
      guildId: 'guild-1',
      lastKnownStartTime: startIso,
    });
  });
});

describe('upsertEventState', () => {
  it('inserts/updates the row with start time and guild id', async () => {
    const db = makeDbMock();
    jest.unstable_mockModule('../../nominations/db.js', () => ({
      withClient: db.withClient,
      isDatabaseConfigured: db.isDatabaseConfigured,
      ensureNominationsSchema: db.ensureNominationsSchema,
    }));

    const { upsertEventState } = await import('../event-reminders.repository.js');
    const start = new Date('2026-05-25T18:00:00.000Z');
    await upsertEventState('event-1', 'guild-1', start);

    const args = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(args[0]).toContain('INSERT INTO event_state');
    expect(args[0]).toContain('ON CONFLICT (event_id) DO UPDATE');
    expect(args[1]).toEqual(['event-1', 'guild-1', start.toISOString()]);
  });
});
