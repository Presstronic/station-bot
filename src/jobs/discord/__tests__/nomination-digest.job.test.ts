import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

type CronCallback = () => Promise<void>;

const BASE_CONFIG = {
  channelId: 'channel-123',
  roleId: 'role-456',
  cronSchedule: '0 9 * * *',
};

async function setupMocks(configOverrides: Partial<typeof BASE_CONFIG> = {}) {
  const config = { ...BASE_CONFIG, ...configOverrides };
  let capturedCallback: CronCallback | null = null;

  const mockWarn = jest.fn();
  const mockError = jest.fn();

  const countUnprocessedNominations = jest.fn(async () => 0);

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn: mockWarn, error: mockError }),
  }));

  jest.unstable_mockModule('../../../config/nomination-digest.config.js', () => ({
    getNominationDigestConfig: () => config,
  }));

  jest.unstable_mockModule('../../../services/nominations/nominations.repository.js', () => ({
    countUnprocessedNominations,
  }));

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn((_schedule: string) => true),
      schedule: jest.fn((_schedule: string, cb: CronCallback) => {
        capturedCallback = cb;
        return { stop: jest.fn() };
      }),
    },
  }));

  const { scheduleNominationDigest } = await import('../nomination-digest.job.js');

  return {
    scheduleNominationDigest,
    countUnprocessedNominations,
    runJob: async () => {
      if (!capturedCallback) {
        throw new Error('cron callback was not captured');
      }
      await capturedCallback();
    },
    mocks: { warn: mockWarn, error: mockError },
  };
}

function makeTextChannel() {
  return {
    isTextBased: () => true,
    send: jest.fn(async () => undefined),
  };
}

describe('scheduleNominationDigest', () => {
  it('returns null when the cron schedule is invalid', async () => {
    const { scheduleNominationDigest, mocks } = await setupMocks({
      cronSchedule: 'not-a-valid-cron',
    });
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValue(false);

    const task = scheduleNominationDigest({ channels: { fetch: jest.fn() } } as any);

    expect(task).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid NOMINATION_DIGEST_CRON_SCHEDULE'),
      expect.any(Object),
    );
  });

  it('warns and does not throw when channel fetch fails', async () => {
    const { scheduleNominationDigest, runJob, mocks } = await setupMocks();
    const client = {
      channels: {
        fetch: jest.fn(async () => {
          throw new Error('missing access');
        }),
      },
    };

    scheduleNominationDigest(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch digest channel'),
      expect.any(Object),
    );
  });

  it('sends the zero-count digest message', async () => {
    const { scheduleNominationDigest, countUnprocessedNominations, runJob } = await setupMocks();
    const channel = makeTextChannel();
    const client = { channels: { fetch: jest.fn(async () => channel) } };

    countUnprocessedNominations.mockResolvedValueOnce(0);

    scheduleNominationDigest(client as any);
    await runJob();

    expect(channel.send).toHaveBeenCalledWith({
      content: '<@&role-456> Daily nomination digest: there are currently no unprocessed nominations in the queue.',
      allowedMentions: { roles: ['role-456'] },
    });
  });

  it('sends the non-zero digest message', async () => {
    const { scheduleNominationDigest, countUnprocessedNominations, runJob } = await setupMocks();
    const channel = makeTextChannel();
    const client = { channels: { fetch: jest.fn(async () => channel) } };

    countUnprocessedNominations.mockResolvedValueOnce(12);

    scheduleNominationDigest(client as any);
    await runJob();

    expect(channel.send).toHaveBeenCalledWith({
      content: '<@&role-456> Daily nomination digest: **12** unprocessed nomination(s) are currently in the queue.',
      allowedMentions: { roles: ['role-456'] },
    });
  });

  it('warns and does not throw when the configured channel is not text-based', async () => {
    const { scheduleNominationDigest, runJob, mocks } = await setupMocks();
    const client = {
      channels: {
        fetch: jest.fn(async () => ({ isTextBased: () => false })),
      },
    };

    scheduleNominationDigest(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not text-based'),
      expect.any(Object),
    );
  });
});
