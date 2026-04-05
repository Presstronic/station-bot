import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PermissionFlagsBits } from 'discord.js';
import type { Guild } from 'discord.js';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allFlags = {
  verificationEnabled: true,
  purgeJobsEnabled: true,
  manufacturingEnabled: true,
};

function makeMe(grantedKeys: (keyof typeof PermissionFlagsBits)[]) {
  const granted = new Set(grantedKeys.map((k) => PermissionFlagsBits[k]));
  return { permissions: { has: jest.fn((perm: bigint) => granted.has(perm)) } };
}

function makeGuild({
  me = makeMe(['ManageRoles', 'ManageNicknames', 'KickMembers', 'ManageChannels']),
  name = 'Test Guild',
  id = 'guild-1',
}: { me?: ReturnType<typeof makeMe> | null; name?: string; id?: string } = {}) {
  return {
    name,
    id,
    members: { me },
    fetchOwner: jest.fn<() => Promise<unknown>>(),
  };
}

type GuildStub = ReturnType<typeof makeGuild>;
function asGuild(stub: GuildStub): Guild { return stub as unknown as Guild; }

async function loadModule() {
  const loggerWarn = jest.fn();
  jest.unstable_mockModule('../logger.js', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: loggerWarn, error: jest.fn() }),
  }));
  const mod = await import('../permission-check.js');
  return { ...mod, loggerWarn };
}

// ---------------------------------------------------------------------------
// checkBotPermissions
// ---------------------------------------------------------------------------

describe('checkBotPermissions', () => {
  it('returns [] when all required permissions are present', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    expect(checkBotPermissions(asGuild(makeGuild()), allFlags)).toEqual([]);
  });

  it('returns missing ManageNicknames when verificationEnabled and perm absent', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    const guild = makeGuild({ me: makeMe(['ManageRoles', 'KickMembers', 'ManageChannels']) });
    const missing = checkBotPermissions(asGuild(guild), allFlags);
    expect(missing).toContain('ManageNicknames');
    expect(missing).not.toContain('ManageRoles');
  });

  it('does not include KickMembers when purgeJobsEnabled is false', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    const guild = makeGuild({ me: makeMe(['ManageRoles', 'ManageNicknames', 'ManageChannels']) });
    const missing = checkBotPermissions(asGuild(guild), { ...allFlags, purgeJobsEnabled: false });
    expect(missing).not.toContain('KickMembers');
  });

  it('does not include ManageChannels when manufacturingEnabled is false', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    const guild = makeGuild({ me: makeMe(['ManageRoles', 'ManageNicknames', 'KickMembers']) });
    const missing = checkBotPermissions(asGuild(guild), { ...allFlags, manufacturingEnabled: false });
    expect(missing).not.toContain('ManageChannels');
  });

  it('returns all required permissions as missing when guild.members.me is null', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    const missing = checkBotPermissions(asGuild(makeGuild({ me: null })), allFlags);
    expect(missing).toContain('ManageRoles');
    expect(missing).toContain('ManageNicknames');
    expect(missing).toContain('KickMembers');
    expect(missing).toContain('ManageChannels');
  });

  it('returns [] when no features are enabled', async () => {
    const { checkBotPermissions } = await import('../permission-check.js');
    expect(
      checkBotPermissions(asGuild(makeGuild({ me: makeMe([]) })), {
        verificationEnabled: false,
        purgeJobsEnabled: false,
        manufacturingEnabled: false,
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// notifyOwnerOfMissingPermissions
// ---------------------------------------------------------------------------

describe('notifyOwnerOfMissingPermissions', () => {
  it('sends a DM to the guild owner listing missing permissions', async () => {
    const { notifyOwnerOfMissingPermissions } = await loadModule();
    const send = jest.fn(async () => {});
    const createDM = jest.fn(async () => ({ send }));
    const stub = makeGuild();
    stub.fetchOwner.mockResolvedValue({ createDM });

    await notifyOwnerOfMissingPermissions(asGuild(stub), ['ManageNicknames', 'ManageRoles']);

    expect(stub.fetchOwner).toHaveBeenCalledTimes(1);
    expect(createDM).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = (send as jest.Mock).mock.calls[0] as [string];
    expect(message).toContain('Manage Nicknames');
    expect(message).toContain('Manage Roles');
    expect(message).toContain('Test Guild');
  });

  it('includes the correct one-line description for each missing permission', async () => {
    const { notifyOwnerOfMissingPermissions } = await loadModule();
    const send = jest.fn(async () => {});
    const stub = makeGuild();
    stub.fetchOwner.mockResolvedValue({ createDM: jest.fn(async () => ({ send })) });

    await notifyOwnerOfMissingPermissions(asGuild(stub), ['KickMembers', 'ManageChannels']);

    const [message] = (send as jest.Mock).mock.calls[0] as [string];
    expect(message).toContain('required by the member purge jobs');
    expect(message).toContain('required by the manufacturing feature');
  });

  it('logs warn and does not throw when DM sending fails', async () => {
    const { notifyOwnerOfMissingPermissions, loggerWarn } = await loadModule();
    const stub = makeGuild();
    stub.fetchOwner.mockRejectedValue(new Error('DM blocked'));

    await expect(
      notifyOwnerOfMissingPermissions(asGuild(stub), ['ManageRoles']),
    ).resolves.toBeUndefined();

    expect(loggerWarn).toHaveBeenCalledWith(
      'Failed to DM guild owner about missing permissions',
      expect.objectContaining({ guildId: stub.id }),
    );
  });

  it('does nothing when the missing array is empty', async () => {
    const { notifyOwnerOfMissingPermissions } = await loadModule();
    const stub = makeGuild();

    await notifyOwnerOfMissingPermissions(asGuild(stub), []);

    expect(stub.fetchOwner).not.toHaveBeenCalled();
  });
});
