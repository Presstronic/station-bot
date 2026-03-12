import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function makeAuditEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    eventType: 'nomination_processed_single',
    actorUserId: 'u1',
    actorUserTag: 'admin#0001',
    targetHandle: 'PilotA',
    payloadJson: { found: true },
    result: 'success',
    createdAt: '2026-03-12T10:00:00.000Z',
    ...overrides,
  };
}

function makeInteraction(optionOverrides: {
  eventType?: string | null;
  since?: string | null;
  limit?: number | null;
} = {}) {
  const editReply = jest.fn(async () => undefined);
  return {
    inGuild: () => true,
    locale: 'en-US',
    user: { id: 'u1', tag: 'admin#0001' },
    memberPermissions: { has: () => true },
    replied: false,
    deferred: true,
    options: {
      getString: (name: string) => {
        if (name === 'event-type') return optionOverrides.eventType ?? null;
        if (name === 'since') return optionOverrides.since ?? null;
        return null;
      },
      getInteger: (name: string) => {
        if (name === 'limit') return optionOverrides.limit ?? null;
        return null;
      },
    },
    deferReply: jest.fn(async () => undefined),
    editReply,
    reply: jest.fn(async () => undefined),
  } as any;
}

describe('parseSinceOption', () => {
  it('parses ISO timestamp', async () => {
    const { parseSinceOption } = await import('../nomination-audit.command.ts');
    const result = parseSinceOption('2026-01-01T00:00:00Z');
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('parses shorthand hours (e.g. 24h)', async () => {
    const before = Date.now();
    const { parseSinceOption } = await import('../nomination-audit.command.ts');
    const result = parseSinceOption('24h');
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(before - 86_400_000);
    expect(result!.getTime()).toBeLessThanOrEqual(after - 86_400_000 + 100);
  });

  it('parses shorthand days (e.g. 7d)', async () => {
    const before = Date.now();
    const { parseSinceOption } = await import('../nomination-audit.command.ts');
    const result = parseSinceOption('7d');
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
    expect(result!.getTime()).toBeLessThanOrEqual(after - 7 * 86_400_000 + 100);
  });

  it('returns null for invalid input', async () => {
    const { parseSinceOption } = await import('../nomination-audit.command.ts');
    expect(parseSinceOption('not-a-date')).toBeNull();
    expect(parseSinceOption('abc')).toBeNull();
  });
});

describe('handleNominationAuditCommand', () => {
  it('replies with none message when no events found', async () => {
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => []),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No audit events found'),
      })
    );
  });

  it('passes event-type, since, and limit options to getAuditEvents', async () => {
    const getAuditEvents = jest.fn(async () => [makeAuditEvent()]);
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents,
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction({
      eventType: 'nomination_processed_bulk',
      since: '2026-01-01T00:00:00Z',
      limit: 10,
    });

    await handleNominationAuditCommand(interaction);

    expect(getAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'nomination_processed_bulk',
        limit: 11,
      })
    );
    const callArg = (getAuditEvents.mock.calls[0] as unknown as [{ since?: Date }])[0];
    expect(callArg.since).toBeInstanceOf(Date);
    expect(callArg.since!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults to limit=25 when no limit provided', async () => {
    const getAuditEvents = jest.fn(async () => [makeAuditEvent()]);
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents,
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    expect(getAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 26 })
    );
  });

  it('inline reply includes event table', async () => {
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => [makeAuditEvent()]),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('nomination_processed_single'),
      })
    );
  });

  it('appends truncated hint when result count equals limit', async () => {
    const events = Array.from({ length: 26 }, (_, i) => makeAuditEvent({ id: i }));
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => events),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('truncated'),
      })
    );
  });

  it('does not append truncated hint when result count is below limit', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeAuditEvent({ id: i }));
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => events),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    const replyContent = (interaction.editReply.mock.calls[0] as [{ content: string }])[0].content;
    expect(replyContent).not.toContain('truncated');
  });

  it('replies with invalidSince message for bad since value', async () => {
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => []),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction({ since: 'not-a-date' });

    await handleNominationAuditCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Invalid 'since' value"),
      })
    );
  });

  it('uses file attachment when inline content exceeds 1800 chars', async () => {
    const longHandle = 'x'.repeat(200);
    const events = Array.from({ length: 10 }, (_, i) =>
      makeAuditEvent({ id: i, targetHandle: longHandle, payloadJson: { data: 'x'.repeat(100) } })
    );
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => events),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    const call = (interaction.editReply.mock.calls[0] as [{ files?: unknown[] }])[0];
    expect(call.files).toBeDefined();
    expect(call.files!.length).toBeGreaterThan(0);
  });

  it('replies with configuration error when getAuditEvents throws config error', async () => {
    jest.unstable_mockModule('../../services/nominations/audit.repository.ts', () => ({
      getAuditEvents: jest.fn(async () => {
        throw new Error('DATABASE_URL is required for audit persistence');
      }),
    }));

    const { handleNominationAuditCommand } = await import('../nomination-audit.command.ts');
    const interaction = makeInteraction();

    await handleNominationAuditCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
      })
    );
  });
});
