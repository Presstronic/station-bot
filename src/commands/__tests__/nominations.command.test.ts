import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
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
      updateOrgCheckStatus: jest.fn(),
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
      })
    );
  });

  it('rejects nomination when role check fails', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      updateOrgCheckStatus: jest.fn(),
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
      updateOrgCheckStatus: jest.fn(),
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
      })
    );
  });

  it('allows configured non-admin role to run process command', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 1);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.ts', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      updateOrgCheckStatus: jest.fn(),
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
      })
    );
  });
});
