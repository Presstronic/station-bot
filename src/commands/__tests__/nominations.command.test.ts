import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalOrganizationRoleId = process.env.ORGANIZATION_MEMBER_ROLE_ID;

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  if (originalOrganizationRoleId === undefined) {
    delete process.env.ORGANIZATION_MEMBER_ROLE_ID;
  } else {
    process.env.ORGANIZATION_MEMBER_ROLE_ID = originalOrganizationRoleId;
  }
});

function createNominationInteraction(overrides: Record<string, unknown> = {}) {
  const reply = jest.fn(async () => undefined);
  return {
    inGuild: () => true,
    locale: 'en-US',
    user: { id: 'u1', tag: 'tester#0001' },
    memberPermissions: { has: () => false },
    guild: {
      roles: {
        fetch: async () => undefined,
        cache: {
          find: (predicate: (role: { name: string }) => boolean) => {
            const role = { name: 'Organization Member', position: 10 };
            return predicate(role) ? role : undefined;
          },
        },
      },
      members: {
        cache: {
          get: () => ({
            roles: {
              highest: {
                comparePositionTo: () => 1,
              },
              cache: new Map([['review-role-1', { id: 'review-role-1' }]]),
            },
          }),
        },
        fetch: async () => null,
      },
    },
    options: {
      getString: (name: string, required?: boolean) => {
        if (name === 'rsi-handle') return 'PilotNominee';
        if (name === 'reason') return 'Helpful in chat';
        if (required) return '';
        return null;
      },
    },
    reply,
    ...overrides,
  } as any;
}

describe('nominations commands', () => {
  it('creates nomination when role check passes', async () => {
    const recordNomination = jest.fn(async () => ({
      displayHandle: 'PilotNominee',
      nominationCount: 1,
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction();
    await handleNominatePlayerCommand(interaction);

    expect(recordNomination).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Nomination recorded'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
    );
  });

  it('rejects blank RSI handles before persistence', async () => {
    const recordNomination = jest.fn(async () => ({
      displayHandle: 'PilotNominee',
      nominationCount: 1,
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction({
      options: {
        getString: (name: string, required?: boolean) => {
          if (name === 'rsi-handle') return '   ';
          if (name === 'reason') return 'Helpful in chat';
          if (required) return '';
          return null;
        },
      },
    });

    await handleNominatePlayerCommand(interaction);

    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please provide a valid RSI handle.'),
        ephemeral: true,
      })
    );
  });

  it('returns configuration guidance when nomination persistence is misconfigured', async () => {
    const recordNomination = jest.fn(async () => {
      throw new Error('DATABASE_URL is required for nomination persistence');
    });
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction();
    await handleNominatePlayerCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
        ephemeral: true,
      })
    );
  });

  it('rejects nomination when role check fails', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction({
      guild: {
        roles: {
          fetch: async () => undefined,
          cache: { find: () => ({ name: 'Organization Member', position: 10 }) },
        },
        members: {
          cache: {
            get: () => ({
              roles: {
                highest: {
                  comparePositionTo: () => -1,
                },
              },
            }),
          },
          fetch: async () => null,
        },
      },
    });

    await handleNominatePlayerCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('must have the role'),
      })
    );
  });

  it('processes all nominations when admin runs process command without handle', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 1);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
    }));

    const { handleProcessNominationCommand } = await import('../process-nomination.command.ts');
    const processReply = jest.fn(async () => undefined);
    const processInteraction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      reply: processReply,
    } as any;

    await handleProcessNominationCommand(processInteraction);

    expect(markAllNominationsProcessed).toHaveBeenCalledWith('admin-1');
    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Marked 1 nomination(s) as processed.'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
    );
  });

  it('allows configured non-admin role to run process command', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 1);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
    }));
    jest.unstable_mockModule('../../services/nominations/access-control.repository.ts', () => ({
      getReviewProcessRoleIds: jest.fn(async () => ['review-role-1']),
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleProcessNominationCommand } = await import('../process-nomination.command.ts');
    const processReply = jest.fn(async () => undefined);
    const processInteraction = createNominationInteraction({
      user: { id: 'role-user' },
      memberPermissions: { has: () => false },
      options: { getString: () => null },
      reply: processReply,
    });

    await handleProcessNominationCommand(processInteraction);

    expect(markAllNominationsProcessed).toHaveBeenCalledWith('role-user');
    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Marked 1 nomination(s) as processed.'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
    );
  });

  it('returns configuration guidance for process command when database is misconfigured', async () => {
    const markAllNominationsProcessed = jest.fn(async () => {
      throw new Error('DATABASE_URL is required for nomination persistence');
    });
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
    }));

    const { handleProcessNominationCommand } = await import('../process-nomination.command.ts');
    const processReply = jest.fn(async () => undefined);
    const processInteraction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      reply: processReply,
    } as any;

    await handleProcessNominationCommand(processInteraction);

    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
        ephemeral: true,
      })
    );
  });

  it('returns configuration guidance when delegated access check cannot read role config', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed: jest.fn(async () => 1),
    }));
    jest.unstable_mockModule('../../services/nominations/access-control.repository.ts', () => ({
      getReviewProcessRoleIds: jest.fn(async () => {
        throw new Error('Missing nomination schema objects');
      }),
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleProcessNominationCommand } = await import('../process-nomination.command.ts');
    const processReply = jest.fn(async () => undefined);
    const processInteraction = createNominationInteraction({
      user: { id: 'role-user' },
      memberPermissions: { has: () => false },
      options: { getString: () => null },
      reply: processReply,
    });

    await handleProcessNominationCommand(processInteraction);

    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
        ephemeral: true,
      })
    );
  });

  it('does not fetch guild roles when configured organization role id is already cached', async () => {
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-role-id';
    const rolesFetch = jest.fn(async () => undefined);
    const recordNomination = jest.fn(async () => ({
      displayHandle: 'PilotNominee',
      nominationCount: 1,
    }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction({
      guild: {
        roles: {
          fetch: rolesFetch,
          cache: {
            find: () => undefined,
            get: (roleId: string) =>
              roleId === 'org-role-id' ? { id: 'org-role-id', name: 'Organization Member', position: 10 } : undefined,
          },
        },
        members: {
          cache: {
            get: () => ({
              roles: {
                highest: {
                  comparePositionTo: () => 1,
                },
                cache: new Map(),
              },
            }),
          },
          fetch: async () => null,
        },
      },
    });

    await handleNominatePlayerCommand(interaction);

    expect(rolesFetch).not.toHaveBeenCalled();
  });

  it('reviews nominations using persisted status without outbound org checks', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 2,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: 'not_in_org',
        lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
        events: [
          {
            nominatorUserId: 'u1',
            nominatorUserTag: 'tester#0001',
            reason: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    const updateOrgCheckResult = jest.fn();
    const checkHasAnyOrgMembership = jest.fn(async () => 'in_org');

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleReviewNominationsCommand } = await import('../review-nominations.command.ts');
    const deferReply = jest.fn(async () => undefined);
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply,
      editReply,
    } as any;

    await handleReviewNominationsCommand(interaction);

    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(getUnprocessedNominations).toHaveBeenCalledTimes(1);
    expect(checkHasAnyOrgMembership).not.toHaveBeenCalled();
    expect(updateOrgCheckResult).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Tip: run /refresh-nomination-org-status'),
      })
    );
  });

  it('reports unknown and never-checked counts without double-counting unset status', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'unknownpilot',
        displayHandle: 'UnknownPilot',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: 'unknown',
        lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
        events: [
          {
            nominatorUserId: 'u1',
            nominatorUserTag: 'tester#0001',
            reason: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      {
        normalizedHandle: 'neverchecked',
        displayHandle: 'NeverChecked',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [
          {
            nominatorUserId: 'u2',
            nominatorUserTag: 'tester2#0002',
            reason: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership: jest.fn(async () => 'in_org'),
    }));

    const { handleReviewNominationsCommand } = await import('../review-nominations.command.ts');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
    } as any;

    await handleReviewNominationsCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content).toContain('HTTP error: 1');
    expect(content).toContain('Unclassified legacy: 1');
    expect(content).toContain('Never checked: 1');
  });

  it('refreshes org status for unprocessed nominations via dedicated command', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
      {
        normalizedHandle: 'secondpilot',
        displayHandle: 'SecondPilot',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
    ]);
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest
      .fn<() => Promise<{ code: 'in_org'; status: 'in_org'; checkedAt: string }>>()
      .mockImplementationOnce(async () => ({
        code: 'in_org',
        status: 'in_org',
        checkedAt: '2026-01-03T00:00:00.000Z',
      }))
      .mockImplementationOnce(async () => {
        throw new Error('transient');
      });

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const deferReply = jest.fn(async () => undefined);
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply,
      editReply,
      options: { getString: () => null },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(2);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Refresh complete.'),
      })
    );
  });

  it('continues refresh batch when a status update write fails', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
      {
        normalizedHandle: 'secondpilot',
        displayHandle: 'SecondPilot',
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
    ]);
    const updateOrgCheckResult = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('db write failed');
      });
    const checkHasAnyOrgMembership = jest
      .fn<
        () => Promise<{ code: 'in_org'; status: 'in_org'; checkedAt: string } | { code: 'not_in_org'; status: 'not_in_org'; checkedAt: string }>
      >()
      .mockImplementationOnce(async () => ({
        code: 'in_org',
        status: 'in_org',
        checkedAt: '2026-01-03T00:00:00.000Z',
      }))
      .mockImplementationOnce(async () => ({
        code: 'not_in_org',
        status: 'not_in_org',
        checkedAt: '2026-01-03T00:01:00.000Z',
      }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(2);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(2);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Errors: 1'),
      })
    );
  });

  it('refreshes a single handle without loading all nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => ({
      normalizedHandle: 'pilotnominee',
      displayHandle: 'PilotNominee',
      nominationCount: 1,
      isProcessed: false,
      processedByUserId: null,
      processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    }));
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => ({
      code: 'not_in_org',
      status: 'not_in_org',
      checkedAt: '2026-01-03T00:00:00.000Z',
    }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply: jest.fn(async () => undefined),
      options: { getString: () => 'PilotNominee' },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    expect(getUnprocessedNominationByHandle).toHaveBeenCalledWith('PilotNominee');
    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(1);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(1);
  });

  it('sanitizes handle text in single-not-found refresh response', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => null);
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => 'not_in_org');

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => 'Bad\n|`Handle' },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content).toContain("Bad /'Handle");
    expect(content).not.toContain('\n|`');
    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(checkHasAnyOrgMembership).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only handle for refresh command instead of refreshing all nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => null);
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => 'not_in_org');

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => '   ' },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(getUnprocessedNominationByHandle).not.toHaveBeenCalled();
    expect(checkHasAnyOrgMembership).not.toHaveBeenCalled();
    expect(updateOrgCheckResult).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please provide a valid RSI handle.'),
      })
    );
  });

  it('truncates refresh summary error handles to stay within discord limits', async () => {
    const getUnprocessedNominations = jest.fn(async () =>
      Array.from({ length: 15 }, (_, index) => ({
        normalizedHandle: `pilot${index}`,
        displayHandle: `Pilot${index.toString().padStart(3, '0')}${'X'.repeat(180)}`,
        nominationCount: 1,
        isProcessed: false,
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      }))
    );
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const checkHasAnyOrgMembership = jest.fn(async () => {
      throw new Error('transient');
    });

    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleRefreshNominationOrgStatusCommand } = await import(
      '../refresh-nomination-org-status.command.ts'
    );
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null },
    } as any;

    await handleRefreshNominationOrgStatusCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content.length).toBeLessThanOrEqual(1800);
    expect(content).toContain('Error handles:');
    expect(content).toMatch(/\(\+\d+ more\)|too many to display/);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(0);
  });
});
