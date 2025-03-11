// src/jobs/__tests__/purge-member.job.test.ts

import { purgeMembers } from '../purge-member.job';
import { Guild, GuildMember, Role } from 'discord.js';

describe('purgeMembers - Temp Member', () => {
  let mockGuild: Guild;
  let mockMembers: GuildMember[];
  
  beforeEach(() => {
    // Create a fake "Temp Member" role
    const tempRole = { id: 'tempRoleId', name: 'Temp Member' } as Role;

    const now = Date.now();

    mockMembers = [
      {
        user: { tag: 'OldTempMember#1234' },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 49 * 60 * 60 * 1000, // 49 hours ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'NewTempMember#5678' },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 10 * 60 * 60 * 1000, // 10 hours ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'NoTempRoleUser#9999' },
        roles: { cache: [] },
        joinedTimestamp: now - 100 * 60 * 60 * 1000, // 100 hours but no "Temp Member" role
        kick: jest.fn(),
      } as any as GuildMember,
    ];

    // Mock the Guild
    mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue(mockMembers),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    } as any as Guild;
  });

  it('kicks Temp Members who joined more than 48 hours ago', async () => {
    const HOURS_TO_EXPIRE = 48;
    const kickedMembers = await purgeMembers(mockGuild, 'Temp Member', HOURS_TO_EXPIRE, "TEST TEMPORARY MEMBERS TIME LIMIT");

    // We only expect the member who joined 49 hours ago to be kicked
    expect(kickedMembers).toEqual(['OldTempMember#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);

    // The 10-hour user should not be kicked
    expect(mockMembers[1].kick).not.toHaveBeenCalled();

    // The user without the "Temp Member" role should not be kicked
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
        user: { tag: 'OldApplicant#1111' },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 31 * 24 * 60 * 60 * 1000, // 31 days ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'NewApplicant#2222' },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'DifferentRoleUser#3333' },
        roles: { cache: [] },
        joinedTimestamp: now - 50 * 24 * 60 * 60 * 1000, // 50 days, but no "Potential Applicant" role
        kick: jest.fn(),
      } as any as GuildMember,
    ];

    // Mock the Guild
    mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue(mockMembers),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    } as any as Guild;
  });

  it('kicks Potential Applicant members who joined more than 30 days (720 hours) ago', async () => {
    const HOURS_TO_EXPIRE = 720; // 30 days
    const kickedMembers = await purgeMembers(mockGuild, 'Potential Applicant', HOURS_TO_EXPIRE, "TEST POTENTIAL APPLICANT TIME LIMIT");

    // We only expect the 31-day user to be kicked
    expect(kickedMembers).toEqual(['OldApplicant#1111']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);

    // 10 days is too soon, so not kicked
    expect(mockMembers[1].kick).not.toHaveBeenCalled();

    // No role, so not kicked
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});
