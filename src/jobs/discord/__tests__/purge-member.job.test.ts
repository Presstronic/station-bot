import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import i18n from '../../../utils/i18n-config.js';
import { purgeMembers } from '../purge-member.job.js';
import { Client, Guild, GuildMember, Role, Collection } from 'discord.js';

type MockGuild = {
  name: string;
  preferredLocale: string;
  members: {
    fetch: () => Promise<Collection<string, GuildMember>>;
    cache: Map<string, GuildMember>;
  };
};

function toCollection(members: GuildMember[]): Collection<string, GuildMember> {
  return new Collection(members.map((m) => [m.user.tag, m]));
}

describe('locale normalization in schedule callbacks', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function makeMockClient(preferredLocale: string) {
    const mockGuild = {
      id: 'guild-1',
      name: 'Test Guild',
      preferredLocale,
      members: {
        fetch: jest.fn<() => Promise<unknown>>().mockResolvedValue(new Map()),
        cache: new Map(),
      },
    };
    return {
      guilds: {
        cache: {
          size: 1,
          values: () => [mockGuild].values(),
        },
      },
    } as unknown as Client;
  }

  it('passes 2-char locale to i18n in scheduleTemporaryMemberCleanup', async () => {
    let capturedCallback: (() => Promise<void>) | undefined;
    const mockI18nMf = jest.fn<typeof i18n.__mf>().mockReturnValue('');

    jest.unstable_mockModule('node-cron', () => ({
      default: {
        schedule: jest.fn((_: string, cb: () => Promise<void>) => {
          capturedCallback = cb;
          return { stop: jest.fn() };
        }),
      },
    }));
    jest.unstable_mockModule('i18n', () => ({
      default: { __mf: mockI18nMf },
    }));

    const { scheduleTemporaryMemberCleanup } = await import('../purge-member.job.js') as {
      scheduleTemporaryMemberCleanup: (client: Client) => unknown;
    };

    scheduleTemporaryMemberCleanup(makeMockClient('en-US'));
    await capturedCallback!();

    expect(mockI18nMf).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en' }),
      expect.any(Object)
    );
  });
});

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
        cleanGuildName: mockGuild.name.replace(/[^ -~]/g, ''),
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
