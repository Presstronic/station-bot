import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalMessageLimit = process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH;

beforeEach(() => {
  jest.resetModules();
  delete process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH;
});

afterEach(() => {
  if (originalMessageLimit === undefined) {
    delete process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH;
  } else {
    process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH = originalMessageLimit;
  }
});

async function loadCommand({
  history = [],
  pending = [],
}: {
  history?: Array<{ year: number; count: number }>;
  pending?: Array<{ displayHandle: string; createdAt: string }>;
} = {}) {
  const loggerError = jest.fn();
  const loggerWarn = jest.fn();

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: loggerWarn,
      error: loggerError,
    }),
  }));

  jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
    getNominationCountsByUser: jest.fn(async () => history),
    getPendingNominationsByUser: jest.fn(async () => pending),
  }));

  jest.unstable_mockModule('../nomination.helpers.js', () => ({
    getCommandLocale: jest.fn(() => 'en'),
    isNominationConfigurationError: jest.fn(() => false),
  }));

  jest.unstable_mockModule('../../utils/i18n-config.js', () => ({
    default: {
      __: jest.fn(({ phrase }: { phrase: string }) => {
        const phrases: Record<string, string> = {
          'commands.myNominations.description': 'See your nomination history.',
          'commands.myNominations.responses.none': "You haven't nominated any players yet.",
          'commands.myNominations.responses.historyTitle': 'Your nomination history:',
          'commands.nominationCommon.responses.guildOnly': 'This command can only be used in a server.',
          'commands.nominationCommon.responses.configurationError':
            'Nomination features are not configured correctly right now. Please contact a server admin.',
          'commands.nominationCommon.responses.unexpectedError':
            'Something went wrong while handling this command. Please try again.',
        };
        return phrases[phrase] ?? phrase;
      }),
      __mf: jest.fn(
        ({ phrase }: { phrase: string }, vars: Record<string, string>) => {
          if (phrase === 'commands.myNominations.responses.lifetimeTotal') {
            return `Lifetime total: ${vars.count}`;
          }
          if (phrase === 'commands.myNominations.responses.pendingTitle') {
            return `Pending Review (${vars.count})`;
          }
          if (phrase === 'commands.myNominations.responses.pendingLine') {
            return `• ${vars.displayHandle} — submitted ${vars.submittedAt}`;
          }
          if (phrase === 'commands.myNominations.responses.pendingTruncated') {
            return `... ${vars.count} more pending entries not shown.`;
          }
          return phrase;
        }
      ),
    },
  }));

  const mod = await import('../my-nominations.command.js');
  return { ...mod, loggerError, loggerWarn };
}

function makeInteraction() {
  return {
    locale: 'en-US',
    user: { id: 'user-1' },
    inGuild: () => true,
    deferReply: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
  } as any;
}

describe('handleMyNominationsCommand', () => {
  it('returns a multi-year nomination history reply', async () => {
    const { handleMyNominationsCommand } = await loadCommand({
      history: [
        { year: 2026, count: 12 },
        { year: 2025, count: 8 },
      ],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Your nomination history:'),
      })
    );
    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain('2026: 12 nominations');
    expect(content).toContain('2025: 8 nominations');
    expect(content).toContain('Lifetime total: 20 nominations');
    expect(content).not.toContain('Pending Review');
  });

  it('returns a single-year history reply', async () => {
    const { handleMyNominationsCommand } = await loadCommand({
      history: [{ year: 2026, count: 1 }],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain('2026: 1 nomination');
    expect(content).toContain('Lifetime total: 1 nomination');
    expect(content).not.toContain('Pending Review');
  });

  it('appends pending nominations below the historical counts when present', async () => {
    const { handleMyNominationsCommand } = await loadCommand({
      history: [{ year: 2026, count: 3 }],
      pending: [
        { displayHandle: 'QuantumPilot', createdAt: '2026-04-20T18:30:00.000Z' },
        { displayHandle: 'NovaWing', createdAt: '2026-04-22T09:15:00.000Z' },
      ],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain('Your nomination history:');
    expect(content).toContain('2026: 3 nominations');
    expect(content).toContain('Lifetime total: 3 nominations');
    expect(content).toContain('Pending Review (2)');
    expect(content).toContain('• QuantumPilot — submitted 2026-04-20');
    expect(content).toContain('• NovaWing — submitted 2026-04-22');
  });

  it('sanitizes pending nomination handles before rendering them inline', async () => {
    const { handleMyNominationsCommand } = await loadCommand({
      history: [{ year: 2026, count: 1 }],
      pending: [
        { displayHandle: 'Quantum`Pilot|Line\nBreak', createdAt: '2026-04-20T18:30:00.000Z' },
      ],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain("• Quantum'Pilot/Line Break — submitted 2026-04-20");
    expect(content).not.toContain('Quantum`Pilot|Line\nBreak');
  });

  it('returns a friendly message when the user has no nominations', async () => {
    const { handleMyNominationsCommand } = await loadCommand({ history: [] });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You haven't nominated any players yet.",
      })
    );
  });

  it('rejects usage outside guilds', async () => {
    const { handleMyNominationsCommand } = await loadCommand();
    const interaction = {
      ...makeInteraction(),
      inGuild: () => false,
    };

    await handleMyNominationsCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'This command can only be used in a server.',
        flags: 64,
      })
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('truncates pending nominations to fit the configured Discord message length limit', async () => {
    process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH = '220';
    const { handleMyNominationsCommand, loggerWarn } = await loadCommand({
      history: [{ year: 2026, count: 3 }],
      pending: [
        { displayHandle: 'QuantumPilot', createdAt: '2026-04-20T18:30:00.000Z' },
        { displayHandle: 'NovaWing', createdAt: '2026-04-22T09:15:00.000Z' },
        { displayHandle: 'Starlance', createdAt: '2026-04-23T11:00:00.000Z' },
      ],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content.length).toBeLessThanOrEqual(220);
    expect(content).toContain('Pending Review (3)');
    expect(content).toContain('... ');
    expect(content).toContain('more pending entries not shown.');
    expect(content).not.toContain('Starlance');
    expect(loggerWarn).toHaveBeenCalledWith(
      'my-nominations response truncated to fit Discord message limit',
      expect.objectContaining({
        userId: 'user-1',
        maxMessageLength: 220,
        pendingNominationCount: 3,
      })
    );
  });

  it('ignores too-small configured message limits and logs a warning', async () => {
    process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH = '10';
    const { handleMyNominationsCommand, loggerWarn } = await loadCommand({
      history: [{ year: 2026, count: 1 }],
      pending: [
        { displayHandle: 'QuantumPilot', createdAt: '2026-04-20T18:30:00.000Z' },
      ],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain('Pending Review (1)');
    expect(content).toContain('• QuantumPilot — submitted 2026-04-20');
    expect(loggerWarn).toHaveBeenCalledWith(
      'MY_NOMINATIONS_MAX_MESSAGE_LENGTH is below the supported minimum; using default',
      expect.objectContaining({
        configuredValue: 10,
        minimumSupportedValue: 200,
        defaultValue: 2000,
      })
    );
  });

  it('falls back to the Discord limit when the configured limit cannot fit the base history section', async () => {
    process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH = '200';
    const { handleMyNominationsCommand, loggerWarn } = await loadCommand({
      history: Array.from({ length: 15 }, (_, index) => ({ year: 2026 - index, count: 123456789 })),
      pending: [],
    });
    const interaction = makeInteraction();

    await handleMyNominationsCommand(interaction);

    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content.length).toBeGreaterThan(200);
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain('Lifetime total:');
    expect(loggerWarn).toHaveBeenCalledWith(
      'my-nominations response exceeded configured limit; falling back to Discord limit',
      expect.objectContaining({
        userId: 'user-1',
        configuredMaxMessageLength: 200,
        fallbackMaxMessageLength: 2000,
      })
    );
  });
});
