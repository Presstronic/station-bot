import { cleanupTempMembers } from '../purge-member.job';
import { Guild, GuildMember, Role } from 'discord.js';

// Optional: mock discord.js if needed
jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
}));

describe('cleanupTempMembers', () => {
  let mockGuild: Guild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    // Create a fake role
    const tempRole = { id: 'tempRoleId', name: 'Temp Member' } as Role;

    // A few mock members
    const now = Date.now();
    mockMembers = [
      {
        user: { tag: 'User1#1234' },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 49 * 60 * 60 * 1000, // 49 hours ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'User2#5678' },
        roles: { cache: [] },
        joinedTimestamp: now - 60 * 60 * 1000, // 1 hour ago
        kick: jest.fn(),
      } as any as GuildMember,
      {
        user: { tag: 'User3#9999' },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 10 * 60 * 60 * 1000, // 10 hours ago
        kick: jest.fn(),
      } as any as GuildMember,
    ];

    // Mock Guild
    mockGuild = {
      members: {
        fetch: jest.fn().mockResolvedValue(mockMembers),
        cache: new Map(mockMembers.map((member) => [member.user.tag, member])),
      },
    } as any as Guild;
  });

  it('kicks members with Temp Member role who joined more than 48 hours ago', async () => {
    const kicked = await cleanupTempMembers(mockGuild, 'Temp Member', 48);

    // Expect only the first user to be kicked
    expect(kicked).toEqual(['User1#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});
