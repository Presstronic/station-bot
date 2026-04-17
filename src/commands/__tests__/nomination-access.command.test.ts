import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('nomination-access command', () => {
  it('add uses a markdown-safe non-mention role label in the confirmation', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(async () => ({ added: true, roleIds: ['role-1'] })),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn<(arg: { content: string }) => Promise<void>>(async () => undefined);
    const interaction: any = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'u1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => 'add',
        getRole: () => ({ id: 'role-1', name: 'Ops`Lead*' }),
      },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("`Ops'Lead*`"),
      })
    );
    const addReplyArg = editReply.mock.calls[0]?.[0];
    expect(addReplyArg).toBeDefined();
    expect(addReplyArg!.content).not.toContain('@Ops');
  });

  it('add preserves pipes in inline-code role labels', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(async () => ({ added: true, roleIds: ['role-1'] })),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn<(arg: { content: string }) => Promise<void>>(async () => undefined);
    const interaction: any = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'u1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => 'add',
        getRole: () => ({ id: 'role-1', name: 'A|B`Team' }),
      },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("`A|B'Team`"),
      })
    );
  });

  it('remove uses a markdown-safe non-mention role label in the confirmation', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(async () => ({ removed: true, roleIds: [] })),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn<(arg: { content: string }) => Promise<void>>(async () => undefined);
    const interaction: any = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'u1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => 'remove',
        getRole: () => ({ id: 'role-1', name: 'Ops`Lead*' }),
      },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("`Ops'Lead*`"),
      })
    );
    const removeReplyArg = editReply.mock.calls[0]?.[0];
    expect(removeReplyArg).toBeDefined();
    expect(removeReplyArg!.content).not.toContain('@Ops');
  });

  it('returns configuration guidance when database is misconfigured', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(async () => {
        throw new Error('DATABASE_URL is required for nomination access control');
      }),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'u1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => 'add',
        getRole: () => ({ id: 'role-1', name: 'TestRole' }),
      },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
      })
    );
  });

  it('reset replies immediately when no custom roles are configured', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn(async () => undefined);
    const interaction: any = {
      id: 'iid-r1',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No custom roles are configured'),
      })
    );
  });

  it('reset shows confirmation prompt with role count and mentions', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => ['role-1', 'role-2']),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const mockResponse = { awaitMessageComponent: jest.fn(async () => { throw new Error('never resolves'); }) };
    const editReply = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce(mockResponse).mockResolvedValue(undefined);
    const interaction: any = {
      id: 'iid-r2',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply,
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    const editReplyArg = (editReply as jest.Mock).mock.calls[0]?.[0] as any;
    expect(editReplyArg.content).toContain('2');
    expect(editReplyArg.content).toContain('<@&role-1>');
    expect(editReplyArg.content).toContain('<@&role-2>');
    expect(editReplyArg.components).toHaveLength(1);
  });

  it('reset confirms and performs reset when Confirm Reset is clicked', async () => {
    const resetReviewProcessRoleIds = jest.fn(async () => undefined);
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => ['role-1']),
      resetReviewProcessRoleIds,
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn(async () => undefined);
    const deferUpdate = jest.fn(async () => undefined);
    const mockResponse = {
      awaitMessageComponent: jest.fn(async () => ({
        customId: 'confirm-reset-iid-r3',
        deferUpdate,
        update: jest.fn(async () => undefined),
      })),
    };
    const interaction: any = {
      id: 'iid-r3',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce(mockResponse).mockImplementation(editReply),
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(resetReviewProcessRoleIds).toHaveBeenCalledTimes(1);
    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('has been reset'),
        components: [],
      })
    );
  });

  it('reset cancels without performing reset when Cancel is clicked', async () => {
    const resetReviewProcessRoleIds = jest.fn(async () => undefined);
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => ['role-1']),
      resetReviewProcessRoleIds,
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const update = jest.fn(async () => undefined);
    const mockResponse = {
      awaitMessageComponent: jest.fn(async () => ({
        customId: 'cancel-reset-iid-r4',
        deferUpdate: jest.fn(async () => undefined),
        update,
      })),
    };
    const interaction: any = {
      id: 'iid-r4',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce(mockResponse).mockResolvedValue(undefined),
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(resetReviewProcessRoleIds).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cancelled'),
        components: [],
      })
    );
  });

  it('reset shows timeout message when confirmation expires', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => ['role-1']),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn(async () => undefined);
    const mockResponse = {
      awaitMessageComponent: jest.fn(async () => { throw new Error('Collector received no interactions before ending with reason: time'); }),
    };
    const interaction: any = {
      id: 'iid-r5',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce(mockResponse).mockImplementation(editReply),
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('timed out'),
        components: [],
      })
    );
  });

  it('reset shows error message and clears buttons when resetReviewProcessRoleIds throws', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.js', () => ({
      addReviewProcessRoleId: jest.fn(),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => ['role-1']),
      resetReviewProcessRoleIds: jest.fn(async () => { throw new Error('DB write failed'); }),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.js');
    const editReply = jest.fn(async () => undefined);
    const deferUpdate = jest.fn(async () => undefined);
    const mockResponse = {
      awaitMessageComponent: jest.fn(async () => ({
        customId: 'confirm-reset-iid-r6',
        deferUpdate,
        update: jest.fn(async () => undefined),
      })),
    };
    const interaction: any = {
      id: 'iid-r6',
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: { getString: () => 'reset', getRole: () => null },
      replied: false,
      deferred: false,
      editReply: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce(mockResponse).mockImplementation(editReply),
      deferReply: jest.fn(async () => { interaction.deferred = true; }),
    };

    await handleNominationAccessCommand(interaction);

    expect(deferUpdate).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('went wrong'),
        components: [],
      })
    );
  });
});
