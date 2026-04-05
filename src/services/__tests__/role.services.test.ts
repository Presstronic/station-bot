import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ButtonInteraction, Client, Guild } from 'discord.js';

beforeEach(() => {
  jest.resetModules();
  delete process.env.DEFAULT_ROLES;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember() {
  return {
    user: { username: 'TestUser' },
    roles: {
      add: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
    },
  };
}

async function loadRoleServicesWithLogger() {
  const loggerError = jest.fn();
  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: loggerError }),
  }));
  const mod = await import('../role.services.js');
  return { ...mod, loggerError };
}

type Member = ReturnType<typeof makeMember>;

function makeRoleCache(names: string[]) {
  const roles = names.map((name) => ({ name, id: `role-${name}` }));
  return {
    find: (fn: (r: { name: string }) => boolean) => roles.find(fn),
    some: (fn: (r: { name: string }) => boolean) => roles.some(fn),
  };
}

function makeGuild({
  roleNames = ['Verified'],
  member = makeMember() as Member | null,
  hasManageRoles = true,
}: { roleNames?: string[]; member?: Member | null; hasManageRoles?: boolean } = {}) {
  return {
    name: 'Test Guild',
    id: 'guild-1',
    roles: {
      cache: makeRoleCache(roleNames),
      fetch: jest.fn(async () => {}),
      create: jest.fn(async (opts: { name: string }) => ({ name: opts.name })),
    },
    members: {
      cache: { get: jest.fn((): Member | undefined => member ?? undefined) },
      fetch: jest.fn(async (): Promise<Member | null> => member),
      me: { permissions: { has: jest.fn(() => hasManageRoles) } },
    },
  };
}

function makeInteraction(guild: ReturnType<typeof makeGuild> | null = makeGuild()) {
  return { guild } as unknown as ButtonInteraction;
}

// ---------------------------------------------------------------------------
// assignVerifiedRole
// ---------------------------------------------------------------------------

describe('assignVerifiedRole', () => {
  it('returns false when guild is not present', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    expect(await assignVerifiedRole(makeInteraction(null), 'user-1')).toBe(false);
  });

  it('returns false when member is not found', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ member: null });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('returns false when verified role is not in guild', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ roleNames: [] });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('assigns the role and returns true on success', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('returns false when roles.add throws', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    member.roles.add = jest.fn(async () => { throw new Error('Permission denied'); });
    const guild = makeGuild({ member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('passes the error object as structured metadata when roles.add throws', async () => {
    const { assignVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const assignError = new Error('Permission denied');
    member.roles.add = jest.fn(async () => { throw assignError; });
    const guild = makeGuild({ member });
    await assignVerifiedRole(makeInteraction(guild), 'user-1');
    expect(loggerError).toHaveBeenCalledWith('Error assigning role', { error: assignError });
  });

  it('uses the first role from DEFAULT_ROLES env var', async () => {
    process.env.DEFAULT_ROLES = 'CustomVerified,Temp,Potential';
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['CustomVerified'], member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomVerified' }));
  });

  it('returns false when the default "Verified" role is absent and DEFAULT_ROLES is not set', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ roleNames: ['SomeOtherRole'] });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('falls back to "Verified" when DEFAULT_ROLES contains only empty entries', async () => {
    process.env.DEFAULT_ROLES = ',  , ';
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['Verified'], member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('returns false when bot is missing ManageRoles permission', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member, hasManageRoles: false });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeVerifiedRole
// ---------------------------------------------------------------------------

describe('removeVerifiedRole', () => {
  it('returns false when guild is not present', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    expect(await removeVerifiedRole(makeInteraction(null), 'user-1')).toBe(false);
  });

  it('returns false when member is not found', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ member: null });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('returns false when verified role is not in guild', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ roleNames: [] });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('removes the role and returns true on success', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('returns false when roles.remove throws', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    member.roles.remove = jest.fn(async () => { throw new Error('Permission denied'); });
    const guild = makeGuild({ member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
  });

  it('passes the error object as structured metadata when roles.remove throws', async () => {
    const { removeVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const removeError = new Error('Permission denied');
    member.roles.remove = jest.fn(async () => { throw removeError; });
    const guild = makeGuild({ member });
    await removeVerifiedRole(makeInteraction(guild), 'user-1');
    expect(loggerError).toHaveBeenCalledWith('Error removing role', { error: removeError });
  });

  it('uses the first role from DEFAULT_ROLES env var', async () => {
    process.env.DEFAULT_ROLES = 'CustomVerified,Temp,Potential';
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['CustomVerified'], member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomVerified' }));
  });

  it('falls back to "Verified" when DEFAULT_ROLES contains only empty entries', async () => {
    process.env.DEFAULT_ROLES = ',  , ';
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['Verified'], member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('returns false when bot is missing ManageRoles permission', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member, hasManageRoles: false });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1')).toBe(false);
    expect(member.roles.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addMissingDefaultRoles
// ---------------------------------------------------------------------------

describe('addMissingDefaultRoles', () => {
  const makeClient = () => ({ user: { username: 'TestBot' } }) as unknown as Client;

  it('creates all roles when none exist', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: [] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient());
    expect(stub.roles.create).toHaveBeenCalledTimes(3);
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Temporary Member' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Potential Applicant' }));
  });

  it('skips roles that already exist', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: ['Verified', 'Temporary Member', 'Potential Applicant'] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient());
    expect(stub.roles.create).not.toHaveBeenCalled();
  });

  it('creates only the missing roles when some exist', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: ['Verified'] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient());
    expect(stub.roles.create).toHaveBeenCalledTimes(2);
    expect(stub.roles.create).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('uses role names from DEFAULT_ROLES env var', async () => {
    process.env.DEFAULT_ROLES = 'CustomVerified,CustomTemp';
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: [] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient());
    expect(stub.roles.create).toHaveBeenCalledTimes(2);
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomVerified' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomTemp' }));
  });

  it('throws when roles.fetch fails', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild();
    stub.roles.fetch.mockRejectedValueOnce(new Error('API error'));
    await expect(addMissingDefaultRoles(stub as unknown as Guild, makeClient())).rejects.toThrow('API error');
  });

  it('falls back to default role set when DEFAULT_ROLES contains only empty entries', async () => {
    process.env.DEFAULT_ROLES = ',  , ';
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: [] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient());
    expect(stub.roles.create).toHaveBeenCalledTimes(3);
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Temporary Member' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Potential Applicant' }));
  });
});
