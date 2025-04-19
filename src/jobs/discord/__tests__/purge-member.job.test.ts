import { jest } from '@jest/globals';
import i18n from '../../../utils/i18n-config.ts';
import { purgeMembers } from '../purge-member.job.ts';
import { Guild, GuildMember, Role } from 'discord.js';

describe('purgeMembers - Temporary Member', () => {
  let mockGuild: Guild;
  let mockMembers: GuildMember[];
  
  beforeEach(() => {
    // Create a fake "Temporary Member" role
    const tempRole = { id: 'tempRoleId', name: 'Temporary Member' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { 
          tag: 'OldTempMember#1234',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [tempRole] },
        kickable: true,
        joinedTimestamp: now - 49 * 60 * 60 * 1000, // 49 hours ago
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
      {
        user: { 
          tag: 'NewTempMember#5678',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [tempRole] },
        kickable: true,
        joinedTimestamp: now - 10 * 60 * 60 * 1000, // 10 hours ago
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
      {
        user: { 
          tag: 'NoTempRoleUser#9999',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [] },
        kickable: true,
        joinedTimestamp: now - 100 * 60 * 60 * 1000, // 100 hours but no "Temporary Member" role
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
    ];

    // Mock the Guild
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn().mockResolvedValue(mockMembers),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    } as any as Guild;
  });

  it('kicks Temporary Members who joined more than 48 hours ago', async () => {
    const locale = mockGuild.preferredLocale;
    const HOURS_TO_EXPIRE = 48;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^\w\s\-]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString()
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild,
      'Temporary Member',
      HOURS_TO_EXPIRE,
      "TEST TEMPORARY MEMBERS TIME LIMIT",
      message
    );

    // We only expect the member who joined 49 hours ago to be kicked
    expect(kickedMembers).toEqual(['OldTempMember#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);

    // The 10-hour user should not be kicked
    expect(mockMembers[1].kick).not.toHaveBeenCalled();

    // The user without the "Temporary Member" role should not be kicked
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});


describe('purgeMembers - Potential Applicant', () => {
  let mockGuild: Guild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    // Create a fake "Potential Applicant" role
    const applicantRole = { id: 'applicantRoleId', name: 'Potential Applicant' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { 
          tag: 'OldApplicant#1111',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [applicantRole] },
        kickable: true,
        joinedTimestamp: now - 31 * 24 * 60 * 60 * 1000, // 31 days ago
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
      {
        user: { 
          tag: 'NewApplicant#2222',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [applicantRole] },
        kickable: true,
        joinedTimestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
      {
        user: { 
          tag: 'DifferentRoleUser#3333',
          send: jest.fn(() => Promise.resolve())
        },
        roles: { cache: [] },
        kickable: true,
        joinedTimestamp: now - 50 * 24 * 60 * 60 * 1000, // 50 days, but no "Potential Applicant" role
        kick: jest.fn(() => Promise.resolve()),
      } as any as GuildMember,
    ];

    // Mock the Guild
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn().mockResolvedValue(mockMembers),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    } as any as Guild;
  });

  it('kicks Potential Applicant members who joined more than 30 days (720 hours) ago', async () => {
    const HOURS_TO_EXPIRE = 720; // 30 days
    const locale = mockGuild.preferredLocale;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^\w\s\-]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString()
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild,
      'Potential Applicant',
      HOURS_TO_EXPIRE,
      "TEST POTENTIAL APPLICANT TIME LIMIT",
      message
    );

    // We only expect the 31-day user to be kicked
    expect(kickedMembers).toEqual(['OldApplicant#1111']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);

    // 10 days is too soon, so not kicked
    expect(mockMembers[1].kick).not.toHaveBeenCalled();

    // No role, so not kicked
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});

