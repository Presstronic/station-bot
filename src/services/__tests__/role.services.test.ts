import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ButtonInteraction, Client, Guild } from 'discord.js';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
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
}: { roleNames?: string[]; member?: Member | null } = {}) {
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
    },
  };
}

function makeInteraction(
  guild: ReturnType<typeof makeGuild> | null = makeGuild(),
  { hasManageRoles = true }: { hasManageRoles?: boolean } = {},
) {
  return { guild, appPermissions: { has: jest.fn(() => hasManageRoles) } } as unknown as ButtonInteraction;
}

function makeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
    verificationEnabled: true,
    verifiedRoleName: 'Verified',
    tempMemberRoleName: 'Temporary Member',
    potentialApplicantRoleName: 'Potential Applicant',
    orgMemberRoleId: null,
    orgMemberRoleName: null,
    nominationDigestEnabled: false,
    nominationDigestChannelId: null,
    nominationDigestRoleId: null,
    nominationDigestCronSchedule: '0 9 * * *',
    manufacturingEnabled: false,
    manufacturingForumChannelId: null,
    manufacturingStaffChannelId: null,
    manufacturingRoleId: null,
    manufacturingCreateOrderThreadId: null,
    manufacturingOrderLimit: 5,
    manufacturingMaxItemsPerOrder: 10,
    manufacturingOrderRateLimitPer5Min: 1,
    manufacturingOrderRateLimitPerHour: 5,
    manufacturingCreateOrderPostTitle: '📋 Create Order',
    manufacturingCreateOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: false,
    tempMemberHoursToExpire: 48,
    tempMemberPurgeCronSchedule: '0 3 * * *',
    birthdayEnabled: false,
    birthdayChannelId: null,
    birthdayCronSchedule: '0 12 * * *',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assignVerifiedRole
// ---------------------------------------------------------------------------

describe('assignVerifiedRole', () => {
  it('returns false when guild is not present', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    expect(await assignVerifiedRole(makeInteraction(null), 'user-1', 'Verified')).toBe(false);
  });

  it('returns false when member is not found', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ member: null });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('returns false when the specified role is not in guild', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ roleNames: [] });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('assigns the role and returns true on success', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('uses the supplied verifiedRoleName parameter', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['CustomVerified'], member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1', 'CustomVerified')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomVerified' }));
  });

  it('returns false when roles.add throws', async () => {
    const { assignVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    member.roles.add = jest.fn(async () => { throw new Error('Permission denied'); });
    const guild = makeGuild({ member });
    expect(await assignVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('passes the error object as structured metadata when roles.add throws', async () => {
    const { assignVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const assignError = new Error('Permission denied');
    member.roles.add = jest.fn(async () => { throw assignError; });
    const guild = makeGuild({ member });
    await assignVerifiedRole(makeInteraction(guild), 'user-1', 'Verified');
    expect(loggerError).toHaveBeenCalledWith('Error assigning role', { error: assignError });
  });

  it('returns false when bot is missing ManageRoles permission', async () => {
    const { assignVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await assignVerifiedRole(makeInteraction(guild, { hasManageRoles: false }), 'user-1', 'Verified')).toBe(false);
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('ManageRoles'),
      expect.objectContaining({ guildId: guild.id }),
    );
  });
});

// ---------------------------------------------------------------------------
// removeVerifiedRole
// ---------------------------------------------------------------------------

describe('removeVerifiedRole', () => {
  it('returns false when guild is not present', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    expect(await removeVerifiedRole(makeInteraction(null), 'user-1', 'Verified')).toBe(false);
  });

  it('returns false when member is not found', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ member: null });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('returns false when the specified role is not in guild', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const guild = makeGuild({ roleNames: [] });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('removes the role and returns true on success', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('uses the supplied verifiedRoleName parameter', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    const guild = makeGuild({ roleNames: ['CustomVerified'], member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1', 'CustomVerified')).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'CustomVerified' }));
  });

  it('returns false when roles.remove throws', async () => {
    const { removeVerifiedRole } = await import('../role.services.js');
    const member = makeMember();
    member.roles.remove = jest.fn(async () => { throw new Error('Permission denied'); });
    const guild = makeGuild({ member });
    expect(await removeVerifiedRole(makeInteraction(guild), 'user-1', 'Verified')).toBe(false);
  });

  it('passes the error object as structured metadata when roles.remove throws', async () => {
    const { removeVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const removeError = new Error('Permission denied');
    member.roles.remove = jest.fn(async () => { throw removeError; });
    const guild = makeGuild({ member });
    await removeVerifiedRole(makeInteraction(guild), 'user-1', 'Verified');
    expect(loggerError).toHaveBeenCalledWith('Error removing role', { error: removeError });
  });

  it('returns false when bot is missing ManageRoles permission', async () => {
    const { removeVerifiedRole, loggerError } = await loadRoleServicesWithLogger();
    const member = makeMember();
    const guild = makeGuild({ member });
    expect(await removeVerifiedRole(makeInteraction(guild, { hasManageRoles: false }), 'user-1', 'Verified')).toBe(false);
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('ManageRoles'),
      expect.objectContaining({ guildId: guild.id }),
    );
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
    const config = makeGuildConfig();
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient(), config);
    expect(stub.roles.create).toHaveBeenCalledTimes(3);
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Temporary Member' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Potential Applicant' }));
  });

  it('skips roles that already exist', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: ['Verified', 'Temporary Member', 'Potential Applicant'] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient(), makeGuildConfig());
    expect(stub.roles.create).not.toHaveBeenCalled();
  });

  it('creates only the missing roles when some exist', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: ['Verified'] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient(), makeGuildConfig());
    expect(stub.roles.create).toHaveBeenCalledTimes(2);
    expect(stub.roles.create).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Verified' }));
  });

  it('uses role names from the supplied guildConfig', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: [] });
    const config = makeGuildConfig({
      verifiedRoleName: 'Full Member',
      tempMemberRoleName: 'New Member',
      potentialApplicantRoleName: 'Prospect',
    });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient(), config);
    expect(stub.roles.create).toHaveBeenCalledTimes(3);
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Full Member' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Member' }));
    expect(stub.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Prospect' }));
  });

  it('uses hardcoded default role names and creates missing roles when guildConfig is null', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild({ roleNames: [] });
    await addMissingDefaultRoles(stub as unknown as Guild, makeClient(), null);
    expect(stub.roles.create).toHaveBeenCalledTimes(3);
    const createdNames = (stub.roles.create as jest.Mock).mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(createdNames).toContain('Verified');
    expect(createdNames).toContain('Temporary Member');
    expect(createdNames).toContain('Potential Applicant');
  });

  it('throws when roles.fetch fails', async () => {
    const { addMissingDefaultRoles } = await import('../role.services.js');
    const stub = makeGuild();
    stub.roles.fetch.mockRejectedValueOnce(new Error('API error'));
    await expect(addMissingDefaultRoles(stub as unknown as Guild, makeClient(), makeGuildConfig())).rejects.toThrow('API error');
  });
});
