import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

async function loadCommand({
  history = [],
}: {
  history?: Array<{ year: number; count: number }>;
} = {}) {
  const loggerError = jest.fn();

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: loggerError,
    }),
  }));

  jest.unstable_mockModule('../../services/nominations/nominations.repository.js', () => ({
    getNominationCountsByUser: jest.fn(async () => history),
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
          return phrase;
        }
      ),
    },
  }));

  const mod = await import('../my-nominations.command.js');
  return { ...mod, loggerError };
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
});
