import { jest } from '@jest/globals';
import i18n from '../../../utils/i18n-config.ts';
import { purgeMembers } from '../purge-member.job.ts';
import { Guild, GuildMember, Role, Collection } from 'discord.js';

// Lightweight mock type for Guild, safe for test usage
type MockGuild = {
  name: string;
  preferredLocale: string;
  members: {
    fetch: () => Promise<Collection<string, GuildMember>>;
    cache: Map<string, GuildMember>;
  };
};

// Helper function to convert array to Collection
function toCollection(members: GuildMember[]): Collection<string, GuildMember> {
  return new Collection(members.map((m) => [m.user.tag, m]));
}

describe('purgeMembers - Temporary Member', () => {
  let mockGuild: MockGuild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    const tempRole = { id: 'tempRoleId', name: 'Temporary Member' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { tag: 'OldTempMember#1234', send: jest.fn() },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 49 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NewTempMember#5678', send: jest.fn() },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 10 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NoTempRoleUser#9999', send: jest.fn() },
        roles: { cache: [] },
        joinedTimestamp: now - 100 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
    ] as unknown as GuildMember[];
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn<() => Promise<Collection<string, GuildMember>>>()
          .mockResolvedValue(toCollection(mockMembers)),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    }; 
  });

  it('kicks Temporary Members who joined more than 48 hours ago', async () => {
    const HOURS_TO_EXPIRE = 48;
    const locale = mockGuild.preferredLocale;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^ -\u007E]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString(),
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild as unknown as Guild,
      'Temporary Member',
      HOURS_TO_EXPIRE,
      'TEST TEMPORARY MEMBERS TIME LIMIT',
      message
    );

    expect(kickedMembers).toEqual(['OldTempMember#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});

describe('purgeMembers - Potential Applicant', () => {
  let mockGuild: MockGuild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    const applicantRole = { id: 'applicantRoleId', name: 'Potential Applicant' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { tag: 'OldApplicant#1111', send: jest.fn() },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 31 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NewApplicant#2222', send: jest.fn() },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 10 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'DifferentRoleUser#3333', send: jest.fn() },
        roles: { cache: [] },
        joinedTimestamp: now - 50 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
    ] as unknown as GuildMember[];
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn<() => Promise<Collection<string, GuildMember>>>()
          .mockResolvedValue(toCollection(mockMembers)),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    };
  });

  it('kicks Potential Applicant members who joined more than 30 days (720 hours) ago', async () => {
    const HOURS_TO_EXPIRE = 720;
    const locale = mockGuild.preferredLocale;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^ -\u007E]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString(),
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild as unknown as Guild,
      'Potential Applicant',
      HOURS_TO_EXPIRE,
      'TEST POTENTIAL APPLICANT TIME LIMIT',
      message
    );

    expect(kickedMembers).toEqual(['OldApplicant#1111']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});
