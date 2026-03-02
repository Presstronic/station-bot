import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const originalStorePath = process.env.NOMINATIONS_STORE_PATH;
const originalRoleName = process.env.ORGANIZATION_MEMBER_ROLE_NAME;
let tempDir = '';

beforeEach(() => {
  jest.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'station-bot-nominations-cmd-'));
  process.env.NOMINATIONS_STORE_PATH = join(tempDir, 'nominations.json');
  process.env.ORGANIZATION_MEMBER_ROLE_NAME = 'Organization Member';
});

afterEach(() => {
  if (originalStorePath === undefined) {
    delete process.env.NOMINATIONS_STORE_PATH;
  } else {
    process.env.NOMINATIONS_STORE_PATH = originalStorePath;
  }
  if (originalRoleName === undefined) {
    delete process.env.ORGANIZATION_MEMBER_ROLE_NAME;
  } else {
    process.env.ORGANIZATION_MEMBER_ROLE_NAME = originalRoleName;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createNominationInteraction(overrides: Record<string, unknown> = {}) {
  const reply = jest.fn(async () => undefined);
  return {
    inGuild: () => true,
    locale: 'en-US',
    user: { id: 'u1', tag: 'tester#0001' },
    memberPermissions: { has: () => false },
    guild: {
      roles: {
        fetch: async () => undefined,
        cache: {
          find: (predicate: (role: { name: string }) => boolean) => {
            const role = { name: 'Organization Member', position: 10 };
            return predicate(role) ? role : undefined;
          },
        },
      },
      members: {
        cache: {
          get: () => ({
            roles: {
              highest: {
                comparePositionTo: () => 1,
              },
            },
          }),
        },
        fetch: async () => null,
      },
    },
    options: {
      getString: (name: string, required?: boolean) => {
        if (name === 'rsi-handle') return 'PilotNominee';
        if (name === 'reason') return 'Helpful in chat';
        if (required) return '';
        return null;
      },
    },
    reply,
    ...overrides,
  } as any;
}

describe('nominations commands', () => {
  it('creates nomination when role check passes', async () => {
    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction();

    await handleNominatePlayerCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Nomination recorded'),
        ephemeral: true,
      })
    );
  });

  it('rejects nomination when role check fails', async () => {
    const { handleNominatePlayerCommand } = await import('../nominate-player.command.ts');
    const interaction = createNominationInteraction({
      guild: {
        roles: {
          fetch: async () => undefined,
          cache: { find: () => ({ name: 'Organization Member', position: 10 }) },
        },
        members: {
          cache: {
            get: () => ({
              roles: {
                highest: {
                  comparePositionTo: () => -1,
                },
              },
            }),
          },
          fetch: async () => null,
        },
      },
    });

    await handleNominatePlayerCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('must have the role'),
      })
    );
  });

  it('processes all nominations when admin runs process command without handle', async () => {
    const nominateModule = await import('../nominate-player.command.ts');
    const processModule = await import('../process-nomination.command.ts');
    const nominateInteraction = createNominationInteraction();
    await nominateModule.handleNominatePlayerCommand(nominateInteraction);

    const processReply = jest.fn(async () => undefined);
    const processInteraction = {
      inGuild: () => true,
      locale: 'en-US',
      user: { id: 'admin-1' },
      memberPermissions: { has: () => true },
      options: {
        getString: () => null,
      },
      reply: processReply,
    } as any;

    await processModule.handleProcessNominationCommand(processInteraction);

    expect(processReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Marked 1 nomination(s) as processed.'),
        ephemeral: true,
      })
    );
  });
});
