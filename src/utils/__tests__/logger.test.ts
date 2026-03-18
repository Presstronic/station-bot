import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mocks must be declared before any dynamic import of logger.ts
jest.unstable_mockModule('winston', () => {
  const mockConsoleTransport = jest.fn(() => ({ name: 'console' }));
  const mockFileTransport = jest.fn(() => ({ name: 'file' }));
  const mockCreateLogger = jest.fn(() => ({
    level: 'info',
    format: {},
    transports: [],
  }));
  return {
    createLogger: mockCreateLogger,
    format: {
      combine: jest.fn((...args: unknown[]) => args),
      errors: jest.fn(() => ({})),
      splat: jest.fn(() => ({})),
      timestamp: jest.fn(() => ({})),
      printf: jest.fn(() => ({})),
    },
    transports: {
      Console: mockConsoleTransport,
      File: mockFileTransport,
    },
  };
});

jest.unstable_mockModule('winston-elasticsearch', () => {
  const mockOn = jest.fn();
  const mockEsTransport = jest.fn(() => ({ name: 'elasticsearch', on: mockOn }));
  return { ElasticsearchTransport: mockEsTransport };
});

jest.unstable_mockModule('../request-context.js', () => ({
  getCorrelationId: jest.fn(() => undefined),
}));

async function loadLogger() {
  const mod = await import('../logger.js');
  return mod;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  delete process.env.LOG_LEVEL;
  delete process.env.LOG_FILE_ENABLED;
  delete process.env.ELASTICSEARCH_NODE;
});

describe('getLogger — singleton', () => {
  it('returns the same instance on repeated calls', async () => {
    const { getLogger } = await loadLogger();
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });
});

describe('getLogger — file transport', () => {
  it('adds File transport by default', async () => {
    const winston = await import('winston');
    const { getLogger } = await loadLogger();
    getLogger();
    expect(winston.transports.File).toHaveBeenCalledTimes(1);
  });

  it('adds File transport when LOG_FILE_ENABLED=true', async () => {
    process.env.LOG_FILE_ENABLED = 'true';
    const winston = await import('winston');
    const { getLogger } = await loadLogger();
    getLogger();
    expect(winston.transports.File).toHaveBeenCalledTimes(1);
  });

  it.each(['false', '0', 'no', 'off', 'FALSE', 'Off'])(
    'omits File transport when LOG_FILE_ENABLED=%s',
    async (value) => {
      process.env.LOG_FILE_ENABLED = value;
      const winston = await import('winston');
      const { getLogger } = await loadLogger();
      getLogger();
      expect(winston.transports.File).not.toHaveBeenCalled();
    }
  );
});

describe('getLogger — Elasticsearch transport', () => {
  it('omits ES transport when ELASTICSEARCH_NODE is not set', async () => {
    const { ElasticsearchTransport } = await import('winston-elasticsearch');
    const { getLogger } = await loadLogger();
    getLogger();
    expect(ElasticsearchTransport).not.toHaveBeenCalled();
  });

  it('adds ES transport when ELASTICSEARCH_NODE is set', async () => {
    process.env.ELASTICSEARCH_NODE = 'http://elasticsearch:9200';
    const { ElasticsearchTransport } = await import('winston-elasticsearch');
    const { getLogger } = await loadLogger();
    getLogger();
    expect(ElasticsearchTransport).toHaveBeenCalledTimes(1);
  });

  it('registers an error handler on the ES transport', async () => {
    process.env.ELASTICSEARCH_NODE = 'http://elasticsearch:9200';
    const { ElasticsearchTransport } = await import('winston-elasticsearch');
    const mockOn = jest.fn();
    (ElasticsearchTransport as unknown as jest.Mock).mockImplementation(() => ({ name: 'elasticsearch', on: mockOn }));
    const { getLogger } = await loadLogger();
    getLogger();
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
