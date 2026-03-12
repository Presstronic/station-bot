import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('nomination-access command', () => {
  it('returns configuration guidance when database is misconfigured', async () => {
    jest.unstable_mockModule('../../services/nominations/access-control.repository.ts', () => ({
      addReviewProcessRoleId: jest.fn(async () => {
        throw new Error('DATABASE_URL is required for nomination access control');
      }),
      removeReviewProcessRoleId: jest.fn(),
      getReviewProcessRoleIds: jest.fn(async () => []),
      resetReviewProcessRoleIds: jest.fn(),
    }));

    const { handleNominationAccessCommand } = await import('../nomination-access.command.ts');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'u1', tag: 'admin#0001' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => 'add',
        getRole: () => ({ id: 'role-1', name: 'TestRole' }),
      },
      reply,
      replied: false,
      deferred: false,
    } as any;

    await handleNominationAccessCommand(interaction);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not configured correctly'),
        ephemeral: true,
      })
    );
  });
});
