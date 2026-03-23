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
  const interaction: Record<string, unknown> = {
    inGuild: () => true,
    locale: 'en-US',
    user: { id: 'u1', tag: 'tester#0001' },
    memberPermissions: { has: () => false },
    replied: false,
    deferred: false,
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
    // reply sets replied=true so the editReply guard routes correctly for error-path tests.
    reply: jest.fn(async () => { interaction.replied = true; }),
    // deferReply sets deferred=true; defined before ...overrides so callers can override it.
    deferReply: jest.fn(async () => { interaction.deferred = true; }),
    // editReply throws unless the interaction has been deferred or replied, catching accidental
    // usage without a prior deferReply/reply in the implementation under test.
    editReply: jest.fn(async function(this: void) {
      if (!interaction.deferred && !interaction.replied) {
        throw new Error('editReply called before deferReply/reply');
      }
    }),
    ...overrides,
  };
  return interaction as any;
}

describe('nominations commands', () => {
  it('creates nomination when role check passes', async () => {
    const recordNomination = jest.fn(async () => ({
      displayHandle: 'PilotNominee',
      nominationCount: 1,
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();
    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Your nomination for'),
        allowedMentions: { parse: [] },
      })
    );
  });

  it('rejects blank RSI handles before persistence', async () => {
    const recordNomination = jest.fn(async () => ({
      displayHandle: 'PilotNominee',
      nominationCount: 1,
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
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

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please provide a valid RSI handle.'),
      })
    );
  });

  it('returns configuration guidance when nomination persistence is misconfigured', async () => {
    const recordNomination = jest.fn(async () => {
      throw new Error('DATABASE_URL is required for nomination persistence');
    });
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();
    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
      })
    );
  });

  it('rejects nomination when role check fails', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
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

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('must have the role'),
      })
    );
  });

  it('bulk process: shows confirmation prompt with unprocessed nomination count', async () => {
    const fakePending = [{ normalizedHandle: 'pilot1' }, { normalizedHandle: 'pilot2' }];
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => fakePending),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed: jest.fn(async () => 2),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const mockResponse = { awaitMessageComponent: jest.fn(async () => { throw new Error('timeout'); }) };
    const interaction: any = {
      id: 'iid-1', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      editReply: jest.fn(async () => undefined),
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('2'),
      components: expect.any(Array),
      ephemeral: true,
    }));
  });

  it('bulk process: processes all nominations when Confirm button clicked', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 1);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [{ normalizedHandle: 'pilot1' }]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const confirmButton = {
      customId: 'confirm-bulk-iid-2',
      user: { id: 'admin-1' },
      deferUpdate: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => confirmButton) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-2', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(markAllNominationsProcessed).toHaveBeenCalledWith('admin-1');
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Marked 1 nomination(s) as processed.'),
      components: [],
    }));
  });

  it('bulk process: cancels when Cancel button clicked', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 0);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [{ normalizedHandle: 'pilot1' }]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const cancelButton = {
      customId: 'cancel-bulk-iid-3',
      user: { id: 'admin-1' },
      update: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => cancelButton) };
    const interaction: any = {
      id: 'iid-3', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      editReply: jest.fn(async () => undefined),
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(cancelButton.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('cancelled'),
      components: [],
    }));
    expect(markAllNominationsProcessed).not.toHaveBeenCalled();
  });

  it('bulk process: shows timeout message when no button clicked within 60s', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 0);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [{ normalizedHandle: 'pilot1' }]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const mockResponse = { awaitMessageComponent: jest.fn(async () => { throw new Error('Collector timeout'); }) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-4', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('timed out'),
      components: [],
    }));
    expect(markAllNominationsProcessed).not.toHaveBeenCalled();
  });

  it('bulk process: shows none-to-process when no unprocessed nominations exist', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => []),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      id: 'iid-5', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      reply, editReply: jest.fn(async () => undefined),
    } as any;

    await handleNominationProcessCommand(interaction);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('no unprocessed nominations'),
      ephemeral: true,
    }));
  });

  it('bulk process: allows configured non-admin role to run process command', async () => {
    const markAllNominationsProcessed = jest.fn(async () => 1);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [{ normalizedHandle: 'pilot1' }]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      getReviewProcessRoleIds: jest.fn(async () => ['review-role-1']),
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const confirmButton = {
      customId: 'confirm-bulk-iid-6',
      user: { id: 'role-user' },
      deferUpdate: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => confirmButton) };
    const processInteraction = createNominationInteraction({
      id: 'iid-6',
      user: { id: 'role-user', tag: 'role#0001' },
      memberPermissions: { has: () => false },
      options: { getString: () => null },
      reply: jest.fn(async () => { processInteraction.replied = true; return mockResponse; }),
    });

    await handleNominationProcessCommand(processInteraction);

    expect(markAllNominationsProcessed).toHaveBeenCalledWith('role-user');
    expect(processInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Marked 1 nomination(s) as processed.'),
    }));
  });

  it('returns configuration guidance for process command when database is misconfigured', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => {
        throw new Error('DATABASE_URL is required for nomination persistence');
      }),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const processReply = jest.fn(async () => undefined);
    const interaction = {
      id: 'iid-7', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      reply: processReply, editReply: jest.fn(async () => undefined),
    } as any;

    await handleNominationProcessCommand(interaction);

    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
        ephemeral: true,
      })
    );
  });

  it('bulk process: shows error and clears components when markAllNominationsProcessed throws after Confirm', async () => {
    const markAllNominationsProcessed = jest.fn(async () => { throw new Error('DB write failed'); });
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [{ normalizedHandle: 'pilot1' }]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const confirmButton = {
      customId: 'confirm-bulk-iid-8',
      user: { id: 'admin-1' },
      deferUpdate: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => confirmButton) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-8', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => null },
      replied: false, deferred: false,
      editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(markAllNominationsProcessed).toHaveBeenCalledWith('admin-1');
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('went wrong'),
      components: [],
    }));
    // Must not show a success message
    const content: string = (editReply.mock.calls as any[])[0]?.[0]?.content ?? '';
    expect(content).not.toContain('Marked');
  });

  it('returns configuration guidance when delegated access check cannot read role config', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(async () => false),
      markAllNominationsProcessed: jest.fn(async () => 1),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      getReviewProcessRoleIds: jest.fn(async () => {
        throw new Error('Missing nomination schema objects');
      }),
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationProcessCommand } = await import('../nomination-process.command.js');
    const processReply = jest.fn(async () => undefined);
    const processInteraction = createNominationInteraction({
      user: { id: 'role-user' },
      memberPermissions: { has: () => false },
      options: { getString: () => null },
      reply: processReply,
    });

    await handleNominationProcessCommand(processInteraction);

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

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
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

    await handleNominationSubmitCommand(interaction);

    expect(rolesFetch).not.toHaveBeenCalled();
  });

  it('nomination-submit allows submission when anti-abuse check passes', async () => {
    const recordNomination = jest.fn(async () => ({ displayHandle: 'PilotNominee', nominationCount: 1 }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => null),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Your nomination for'),
      })
    );
  });

  it('nomination-submit blocks submission and does not write when cooldown is active', async () => {
    const recordNomination = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(),
      countNominationsForTargetInWindow: jest.fn(),
      countNominationsByUserInWindow: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => ({ kind: 'cooldown', secondsRemaining: 42 })),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('42 seconds'),
      })
    );
  });

  it('nomination-submit blocks submission and does not write when target daily limit is reached', async () => {
    const recordNomination = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(),
      countNominationsForTargetInWindow: jest.fn(),
      countNominationsByUserInWindow: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => ({
        kind: 'targetDailyLimit',
        displayHandle: 'PilotNominee',
      })),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('PilotNominee'),
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('maximum number of nominations'),
      })
    );
  });

  it('nomination-submit shows target daily limit message when recordNomination throws NominationTargetCapExceededError', async () => {
    // Import the real error class from types.ts (never mocked) so that the
    // command's instanceof check and the thrown instance share the same class.
    const { NominationTargetCapExceededError } = await import('../../services/nominations/types.js');

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(async () => { throw new NominationTargetCapExceededError('PilotNominee'); }),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => null),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('PilotNominee'),
        allowedMentions: { parse: [] },
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('maximum number of nominations'),
      })
    );
  });

  it('nomination-submit blocks submission and does not write when user daily limit is reached', async () => {
    const recordNomination = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(),
      countNominationsForTargetInWindow: jest.fn(),
      countNominationsByUserInWindow: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => ({ kind: 'userDailyLimit', secondsUntilReset: 3600 })),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('resets in approximately 1 hour'),
      })
    );
  });

  it('nomination-submit rejects a concurrent submission from the same user', async () => {
    const recordNomination = jest.fn(async () => new Promise(() => {})); // never resolves
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/anti-abuse.service.js', () => ({
      checkNominationAntiAbuse: jest.fn(async () => null),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'found', canonicalHandle: 'PilotNominee' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const firstInteraction = createNominationInteraction();
    const secondEditReply = jest.fn(async () => undefined);
    const secondInteraction = createNominationInteraction({ editReply: secondEditReply });

    // Start first request but don't await — it blocks on recordNomination
    const firstRequest = handleNominationSubmitCommand(firstInteraction);

    // Second request from the same user arrives while first is in-flight
    await handleNominationSubmitCommand(secondInteraction);

    expect(secondInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(secondEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('still being processed'),
      })
    );

    // Clean up the hanging first request
    firstRequest.catch(() => {});
  });

  it('nomination-submit rejects nomination when RSI citizen is not found', async () => {
    const recordNomination = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'not_found' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("doesn't appear to belong to a valid Citizen"),
        allowedMentions: { parse: [] },
      })
    );
  });

  it('nomination-submit proceeds with nomination when RSI citizen check is unavailable', async () => {
    const recordNomination = jest.fn(async () => ({ displayHandle: 'PilotNominee', nominationCount: 1 }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination,
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkCitizenExists: jest.fn(async () => ({ status: 'unavailable' })),
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationSubmitCommand } = await import('../nomination-submit.command.js');
    const interaction = createNominationInteraction();

    await handleNominationSubmitCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(recordNomination).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Your nomination for'),
        allowedMentions: { parse: [] },
      })
    );
  });

  it('reviews nominations using persisted status without outbound org checks', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 2,
        lifecycleState: 'new',
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
    const checkHasAnyOrgMembership = jest.fn(async () => ({
      code: 'in_org',
      status: 'in_org',
      checkedAt: '2026-01-02T00:00:00.000Z',
    }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult,
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership,
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const deferReply = jest.fn(async () => undefined);
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply,
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(getUnprocessedNominations).toHaveBeenCalledTimes(1);
    expect(checkHasAnyOrgMembership).not.toHaveBeenCalled();
    expect(updateOrgCheckResult).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Tip: run /nomination-refresh'),
      })
    );
    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    // lastRefreshedAt and event date both rendered as YYYY-MM-DD
    expect(content).toContain('2026-01-02');
    expect(content).not.toContain('2026-01-02T');
    expect(content).toContain('2026-01-01');
    expect(content).not.toContain('2026-01-01T');
    // null reason renders as em-dash
    expect(content).toContain('—');
  });

  it('reports unknown and never-checked counts without double-counting unset status', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'unknownpilot',
        displayHandle: 'UnknownPilot',
        nominationCount: 1,
        lifecycleState: 'new',
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
        lifecycleState: 'new',
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

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(async () => ({
        code: 'in_org',
        status: 'in_org',
        checkedAt: '2026-01-02T00:00:00.000Z',
      })),
    }));

    const { handleNominationReviewCommand, detailOptionName } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: (name: string) => (name === detailOptionName ? true : null),
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content).toContain('HTTP error: 0');
    expect(content).toContain('Unclassified legacy: 1');
    expect(content).toContain('Never checked: 1');
  });

  it('nomination-review summary shows Needs Attention count equal to number of checked nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'checkedpilot1',
        displayHandle: 'CheckedPilot1',
        nominationCount: 1,
        lifecycleState: 'checked',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: 'unknown',
        lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
        lastOrgCheckResultCode: 'parse_failed',
        events: [{ nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
      },
      {
        normalizedHandle: 'checkedpilot2',
        displayHandle: 'CheckedPilot2',
        nominationCount: 1,
        lifecycleState: 'checked',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: 'unknown',
        lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
        lastOrgCheckResultCode: 'http_timeout',
        events: [{ nominatorUserId: 'u2', nominatorUserTag: 'tester#0002', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
      },
      {
        normalizedHandle: 'newpilot',
        displayHandle: 'NewPilot',
        nominationCount: 1,
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        lastOrgCheckResultCode: null,
        events: [{ nominatorUserId: 'u3', nominatorUserTag: 'tester#0003', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
      },
    ]);

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Needs Attention: 2');
    expect(content).not.toContain('Checked (technical)');
  });

  it('queues org-check refresh for all unprocessed nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        lifecycleState: 'new',
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
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
    ]);
    const enqueueNominationCheckJob = jest.fn(async () => ({
      reused: false,
      job: { id: 101, totalCount: 2 },
    }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob,
    }));

    const { handleNominationRefreshCommand } = await import('../nomination-refresh.command.js');
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

    await handleNominationRefreshCommand(interaction);

    expect(enqueueNominationCheckJob).toHaveBeenCalledWith(
      'admin-1',
      'all',
      ['pilotnominee', 'secondpilot'],
      null
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Refresh job queued.'),
      })
    );
  });

  it('queues a single handle without loading all nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => ({
      normalizedHandle: 'pilotnominee',
      displayHandle: 'PilotNominee',
      nominationCount: 1,
      lifecycleState: 'new',
      processedByUserId: null,
      processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    }));
    const enqueueNominationCheckJob = jest.fn(async () => ({
      reused: false,
      job: { id: 102, totalCount: 1 },
    }));

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob,
    }));

    const { handleNominationRefreshCommand } = await import('../nomination-refresh.command.js');
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply: jest.fn(async () => undefined),
      options: { getString: () => 'PilotNominee' },
    } as any;

    await handleNominationRefreshCommand(interaction);

    expect(getUnprocessedNominationByHandle).toHaveBeenCalledWith('PilotNominee');
    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(enqueueNominationCheckJob).toHaveBeenCalledWith(
      'admin-1',
      'single',
      ['pilotnominee'],
      'pilotnominee'
    );
  });

  it('sanitizes handle text in single-not-found refresh response', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => null);
    const enqueueNominationCheckJob = jest.fn();

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob,
    }));

    const { handleNominationRefreshCommand } = await import(
      '../nomination-refresh.command.js'
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

    await handleNominationRefreshCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content).toContain("Bad /'Handle");
    expect(content).not.toContain('\n|`');
    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(enqueueNominationCheckJob).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only handle for refresh command instead of refreshing all nominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    const getUnprocessedNominationByHandle = jest.fn(async () => null);
    const enqueueNominationCheckJob = jest.fn();

    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle,
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob,
    }));

    const { handleNominationRefreshCommand } = await import(
      '../nomination-refresh.command.js'
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

    await handleNominationRefreshCommand(interaction);

    expect(getUnprocessedNominations).not.toHaveBeenCalled();
    expect(getUnprocessedNominationByHandle).not.toHaveBeenCalled();
    expect(enqueueNominationCheckJob).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please provide a valid RSI handle.'),
      })
    );
  });

  it('reports reused queue jobs for duplicate requests', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [],
      },
    ]);
    const enqueueNominationCheckJob = jest.fn(async () => ({
      reused: true,
      job: { id: 150, totalCount: 1 },
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob,
    }));

    const { handleNominationRefreshCommand } = await import(
      '../nomination-refresh.command.js'
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

    await handleNominationRefreshCommand(interaction);

    const editPayload = (editReply as unknown as { mock: { calls: any[][] } }).mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = editPayload?.content ?? '';
    expect(content).toContain('Reused existing active job: yes');
    expect(content).toContain('Job ID: 150');
  });

  it('returns latest nomination check job status', async () => {
    const getLatestNominationCheckJob = jest.fn(async () => ({
      id: 77,
      status: 'running',
      requestedScope: 'all',
      requestedHandle: null,
      totalCount: 5,
      pendingCount: 1,
      runningCount: 1,
      completedCount: 3,
      failedCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:10.000Z',
      finishedAt: null,
      errorSummary: null,
    }));
    const getNominationCheckJobById = jest.fn();

    jest.unstable_mockModule('../../services/nominations/job-queue.repository.js', () => ({
      enqueueNominationCheckJob: jest.fn(),
      getLatestNominationCheckJob,
      getNominationCheckJobById,
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationJobStatusCommand } = await import('../nomination-job-status.command.js');
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

    await handleNominationJobStatusCommand(interaction);

    expect(getLatestNominationCheckJob).toHaveBeenCalledTimes(1);
    expect(getNominationCheckJobById).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Job ID: 77'),
      })
    );
    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    // createdAt and startedAt rendered as YYYY-MM-DD, null finishedAt shown as n/a
    expect(content).toContain('2026-01-01');
    expect(content).not.toContain('2026-01-01T');
    expect(content).toContain('n/a');
  });

  it('nomination-review passes status/sort/limit options to getUnprocessedNominations', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand, statusOptionName, sortOptionName, limitOptionName } = await import('../nomination-review.command.js');
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply: jest.fn(async () => undefined),
      options: {
        getString: (name: string) => {
          if (name === statusOptionName) return 'new';
          if (name === sortOptionName) return 'oldest';
          return null;
        },
        getInteger: (name: string) => {
          if (name === limitOptionName) return 10;
          return null;
        },
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    // limit is sent as limitValue + 1 to enable truncation detection without a COUNT query
    expect(getUnprocessedNominations).toHaveBeenCalledWith({ status: 'new', sort: 'oldest', limit: 11 });
  });

  it('nomination-review defaults to all/newest/25 when no options provided', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply: jest.fn(async () => undefined),
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    // No status filter when none is specified — preserves pre-existing behavior
    // limit is sent as limitValue + 1 to enable truncation detection without a COUNT query
    expect(getUnprocessedNominations).toHaveBeenCalledWith({ status: undefined, sort: 'newest', limit: 26 });
  });

  it('nomination-review empty result includes filterContext so the active filter is visible', async () => {
    const getUnprocessedNominations = jest.fn(async () => []);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand, statusOptionName, sortOptionName, limitOptionName } =
      await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: (name: string) => {
          if (name === statusOptionName) return 'qualified';
          if (name === sortOptionName) return 'oldest';
          return null;
        },
        getInteger: (name: string) => (name === limitOptionName ? 10 : null),
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Filter: status=qualified | sort=oldest | limit=10');
    expect(content).toContain('No nominations match the current filter.');
    expect(content).not.toContain('There are no unprocessed nominations.');
  });

  it('nomination-review shows truncation hint when DB returns more than the limit', async () => {
    // Simulate DB returning limitValue + 1 items (the N+1 probe result)
    const nominations = Array.from({ length: 6 }, (_, i) => ({
      normalizedHandle: `pilot${i}`,
      displayHandle: `Pilot${i}`,
      nominationCount: 1,
      lifecycleState: 'qualified',
      processedByUserId: null,
      processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => nominations),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: () => null,
        getInteger: () => 5,
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('results may be truncated');
  });

  it('nomination-review omits truncation hint when DB returns at or below the limit', async () => {
    // DB returns fewer items than limitValue + 1 — no truncation
    const nominations = Array.from({ length: 4 }, (_, i) => ({
      normalizedHandle: `pilot${i}`,
      displayHandle: `Pilot${i}`,
      nominationCount: 1,
      lifecycleState: 'qualified',
      processedByUserId: null,
      processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => nominations),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: () => null,
        getInteger: () => 5,
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).not.toContain('results may be truncated');
  });

  it('nomination-process single-handle path: qualified nomination processes immediately without dialog', async () => {
    const markNominationProcessedByHandle = jest.fn(async () => true);
    const getUnprocessedNominationByHandle = jest.fn(async () => ({
      normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
      lifecycleState: 'qualified', processedByUserId: null, processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle,
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false, reply,
    } as any;

    await handleNominationProcessCommand(interaction);

    expect(getUnprocessedNominationByHandle).toHaveBeenCalledWith('SomePilot');
    expect(markNominationProcessedByHandle).toHaveBeenCalledWith('SomePilot', 'admin-1');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('SomePilot'),
      ephemeral: true,
    }));
  });

  it('nomination-process single-handle path: not found returns singleNotFound reply', async () => {
    const markNominationProcessedByHandle = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => null),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'UnknownPilot' : null) },
      replied: false, deferred: false, reply,
    } as any;

    await handleNominationProcessCommand(interaction);

    expect(markNominationProcessedByHandle).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('UnknownPilot'),
      ephemeral: true,
    }));
  });

  it('nomination-process single-handle path: non-qualified shows warning and Process Anyway completes', async () => {
    const markNominationProcessedByHandle = jest.fn(async () => true);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => ({
        normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
        lifecycleState: 'disqualified_in_org', processedByUserId: null, processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
      })),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const processAnywayButton = {
      customId: 'process-anyway-iid-s1',
      user: { id: 'admin-1' },
      deferUpdate: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => processAnywayButton) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-s1', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false, editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(markNominationProcessedByHandle).toHaveBeenCalledWith('SomePilot', 'admin-1');
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('SomePilot'),
      components: [],
    }));
  });

  it('nomination-process single-handle path: non-qualified Cancel skips processing', async () => {
    const markNominationProcessedByHandle = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => ({
        normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
        lifecycleState: 'new', processedByUserId: null, processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
      })),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const cancelButton = {
      customId: 'cancel-single-iid-s2',
      user: { id: 'admin-1' },
      update: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => cancelButton) };
    const interaction: any = {
      id: 'iid-s2', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false,
      editReply: jest.fn(async () => undefined),
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(markNominationProcessedByHandle).not.toHaveBeenCalled();
    expect(cancelButton.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Cancelled'),
      components: [],
    }));
  });

  it('nomination-process single-handle path: qualified race — markProcessed returns false shows singleNotFound', async () => {
    const markNominationProcessedByHandle = jest.fn(async () => false); // concurrently processed
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => ({
        normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
        lifecycleState: 'qualified', processedByUserId: null, processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
      })),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false, reply,
    } as any;

    await handleNominationProcessCommand(interaction);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Could not find'),
      ephemeral: true,
    }));
  });

  it('nomination-process single-handle path: Process Anyway race — markProcessed returns false shows singleNotFound', async () => {
    const markNominationProcessedByHandle = jest.fn(async () => false); // concurrently processed
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => ({
        normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
        lifecycleState: 'disqualified_in_org', processedByUserId: null, processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
      })),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const processAnywayButton = {
      customId: 'process-anyway-iid-s4',
      user: { id: 'admin-1' },
      deferUpdate: jest.fn(async () => undefined),
    };
    const mockResponse = { awaitMessageComponent: jest.fn(async () => processAnywayButton) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-s4', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false, editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Could not find'),
      components: [],
    }));
  });

  it('nomination-process single-handle path: non-qualified timeout skips processing', async () => {
    const markNominationProcessedByHandle = jest.fn();
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(),
      getUnprocessedNominationByHandle: jest.fn(async () => ({
        normalizedHandle: 'somepilot', displayHandle: 'SomePilot', nominationCount: 1,
        lifecycleState: 'checked', processedByUserId: null, processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null, lastOrgCheckAt: null, events: [],
      })),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle,
      markAllNominationsProcessed: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationProcessCommand, rsiHandleOptionName } = await import('../nomination-process.command.js');
    const mockResponse = { awaitMessageComponent: jest.fn(async () => { throw new Error('Collector received no interactions before ending with reason: time'); }) };
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-s3', inGuild: () => true, locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: (name: string) => (name === rsiHandleOptionName ? 'SomePilot' : null) },
      replied: false, deferred: false, editReply,
    };
    interaction.reply = jest.fn(async () => { interaction.replied = true; return mockResponse; });

    await handleNominationProcessCommand(interaction);

    expect(markNominationProcessedByHandle).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('timed out'),
      components: [],
    }));
  });

  it('nomination-review response includes filter context reflecting the active filter values', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [
        {
          normalizedHandle: 'pilotnominee',
          displayHandle: 'PilotNominee',
          nominationCount: 1,
          lifecycleState: 'qualified',
          processedByUserId: null,
          processedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOrgCheckStatus: null,
          lastOrgCheckAt: null,
          events: [],
        },
      ]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand, statusOptionName, sortOptionName, limitOptionName } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: (name: string) => {
          if (name === statusOptionName) return 'qualified';
          if (name === sortOptionName) return 'oldest';
          return null;
        },
        getInteger: (name: string) => (name === limitOptionName ? 10 : null),
        getBoolean: () => null,
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('status=qualified');
    expect(content).toContain('sort=oldest');
    expect(content).toContain('limit=10');
  });

  it('nomination-review totalCount reflects the sliced display set, not the N+1 probe array', async () => {
    // DB returns limitValue + 1 = 6 items; totalCount in the reply should be 5, not 6
    const nominations = Array.from({ length: 6 }, (_, i) => ({
      normalizedHandle: `pilot${i}`,
      displayHandle: `Pilot${i}`,
      nominationCount: 1,
      lifecycleState: 'qualified',
      processedByUserId: null,
      processedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOrgCheckStatus: null,
      lastOrgCheckAt: null,
      events: [],
    }));
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => nominations),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => 5, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Total: 5');
    expect(content).not.toContain('Total: 6');
  });

  it('nomination-review shows "never" for lastRefreshedAt when no nominations have been org-checked', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [
          { nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: null, createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    ]);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('never');
    expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('nomination-review shows reason text in table when reason is provided', async () => {
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [
          { nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: 'Great pilot, helped us in ops', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    ]);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Great pilot, helped us in ops');
  });

  it('nomination-review truncates reason to 120 characters in table', async () => {
    const longReason = 'A'.repeat(130);
    const getUnprocessedNominations = jest.fn(async () => [
      {
        normalizedHandle: 'pilotnominee',
        displayHandle: 'PilotNominee',
        nominationCount: 1,
        lifecycleState: 'new',
        processedByUserId: null,
        processedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOrgCheckStatus: null,
        lastOrgCheckAt: null,
        events: [
          { nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: longReason, createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    ]);
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations,
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
    }));
    jest.unstable_mockModule('../../services/nominations/org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).not.toContain(longReason);
    expect(content).toContain('...');
    expect(content).toContain('A'.repeat(117));
  });

  it('nomination-review default view shows only business-relevant counts without technical breakdown', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [
        {
          normalizedHandle: 'qualifiedpilot',
          displayHandle: 'QualifiedPilot',
          nominationCount: 2,
          lifecycleState: 'qualified',
          processedByUserId: null,
          processedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOrgCheckStatus: 'not_in_org',
          lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
          lastOrgCheckResultCode: 'not_in_org',
          events: [{ nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
        },
        {
          normalizedHandle: 'checkedpilot',
          displayHandle: 'CheckedPilot',
          nominationCount: 1,
          lifecycleState: 'checked',
          processedByUserId: null,
          processedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOrgCheckStatus: 'unknown',
          lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
          lastOrgCheckResultCode: 'http_timeout',
          events: [{ nominatorUserId: 'u2', nominatorUserTag: 'tester#0002', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
        },
      ]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationReviewCommand } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Qualified: 1');
    expect(content).toContain('Needs Attention: 1');
    expect(content).toContain('Total: 2');
    // Technical fields must not appear in default view
    expect(content).not.toContain('HTTP timeout');
    expect(content).not.toContain('Rate limited');
    expect(content).not.toContain('Parse failed');
    expect(content).not.toContain('Business outcomes');
    expect(content).not.toContain('Technical outcomes');
  });

  it('nomination-review detail: true shows full technical breakdown', async () => {
    jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
      recordNomination: jest.fn(),
      getUnprocessedNominations: jest.fn(async () => [
        {
          normalizedHandle: 'qualifiedpilot',
          displayHandle: 'QualifiedPilot',
          nominationCount: 1,
          lifecycleState: 'qualified',
          processedByUserId: null,
          processedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOrgCheckStatus: 'not_in_org',
          lastOrgCheckAt: '2026-01-02T00:00:00.000Z',
          lastOrgCheckResultCode: 'not_in_org',
          events: [{ nominatorUserId: 'u1', nominatorUserTag: 'tester#0001', reason: null, createdAt: '2026-01-01T00:00:00.000Z' }],
        },
      ]),
      getUnprocessedNominationByHandle: jest.fn(),
      updateOrgCheckResult: jest.fn(),
      markNominationProcessedByHandle: jest.fn(),
      markAllNominationsProcessed: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { handleNominationReviewCommand, detailOptionName } = await import('../nomination-review.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      deferReply: jest.fn(async () => undefined),
      editReply,
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: (name: string) => (name === detailOptionName ? true : null),
      },
    } as any;

    await handleNominationReviewCommand(interaction);

    const content = (editReply as any).mock.calls[0]?.[0]?.content ?? '';
    expect(content).toContain('Business outcomes');
    expect(content).toContain('Technical outcomes');
    expect(content).toContain('HTTP timeout');
    expect(content).toContain('Rate limited');
    expect(content).toContain('Nominations shown: 1');
  });
});
