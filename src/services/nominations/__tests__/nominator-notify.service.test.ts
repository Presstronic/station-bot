import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
};

beforeEach(() => {
  jest.resetModules();
  Object.values(logger).forEach((mockFn) => mockFn.mockReset());
  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => logger,
  }));
});

describe('notifyNominators', () => {
  it('does nothing when no nominator ids are provided', async () => {
    const fetch = jest.fn();
    const client = {
      users: { fetch },
    } as any;

    const { notifyNominators } = await import('../nominator-notify.service.js');
    await notifyNominators(client, []);

    expect(fetch).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('deduplicates duplicate nominator ids before fetching', async () => {
    const send = jest.fn(async () => undefined);
    const fetch = jest.fn(async () => ({ send }));
    const client = {
      users: { fetch },
    } as any;

    const { notifyNominators } = await import('../nominator-notify.service.js');
    await notifyNominators(client, ['user-1', 'user-1', 'user-2']);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, 'user-1');
    expect(fetch).toHaveBeenNthCalledWith(2, 'user-2');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends one dm per unique nominator on success', async () => {
    const sendUser1 = jest.fn(async () => undefined);
    const sendUser2 = jest.fn(async () => undefined);
    const fetch = jest.fn(async (userId: string) => ({
      send: userId === 'user-1' ? sendUser1 : sendUser2,
    }));
    const client = {
      users: { fetch },
    } as any;

    const { notifyNominators } = await import('../nominator-notify.service.js');
    await notifyNominators(client, ['user-1', 'user-2']);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sendUser1).toHaveBeenCalledTimes(1);
    expect(sendUser2).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warn-logs fetch failures and continues notifying remaining users', async () => {
    const send = jest.fn(async () => undefined);
    const fetch = jest.fn(async (userId: string) => {
      if (userId === 'user-1') {
        throw new Error('User not found');
      }
      return { send };
    });
    const client = {
      users: { fetch },
    } as any;

    const { notifyNominators } = await import('../nominator-notify.service.js');
    await notifyNominators(client, ['user-1', 'user-2']);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('user-1'));
  });

  it('warn-logs dm send failures and continues notifying remaining users', async () => {
    const fetch = jest.fn(async (userId: string) => ({
      send: userId === 'user-1'
        ? jest.fn(async () => { throw new Error('Cannot send messages to this user'); })
        : jest.fn(async () => undefined),
    }));
    const client = {
      users: { fetch },
    } as any;

    const { notifyNominators } = await import('../nominator-notify.service.js');
    await notifyNominators(client, ['user-1', 'user-2']);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('user-1'));
  });
});
