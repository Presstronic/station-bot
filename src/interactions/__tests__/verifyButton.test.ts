import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

async function loadHandlerWithMocks({
  userData,
  rsiProfileVerified = false,
}: {
  userData: { rsiProfileName: string; dreadnoughtValidationCode: string } | undefined;
  rsiProfileVerified?: boolean;
}) {
  const getUserVerificationData = jest.fn(() => userData);
  const verifyRSIProfile = jest.fn(async () => rsiProfileVerified);
  const assignVerifiedRole = jest.fn(async () => true);
  const removeVerifiedRole = jest.fn(async () => undefined);

  await jest.unstable_mockModule('../../commands/verify.ts', () => ({
    getUserVerificationData,
  }));
  await jest.unstable_mockModule('../../services/rsi.services.ts', () => ({
    verifyRSIProfile,
  }));
  await jest.unstable_mockModule('../../services/role.services.ts', () => ({
    assignVerifiedRole,
    removeVerifiedRole,
  }));

  const { handleVerifyButtonInteraction } = await import('../verifyButton.ts');

  return {
    handleVerifyButtonInteraction,
    getUserVerificationData,
    verifyRSIProfile,
    assignVerifiedRole,
    removeVerifiedRole,
  };
}

function makeButtonInteraction(customId = 'verify') {
  const editReply = jest.fn(async () => undefined);
  const reply = jest.fn(async () => undefined);
  const followUp = jest.fn(async () => undefined);

  return {
    customId,
    deferred: true,
    replied: false,
    locale: 'en-US',
    user: { id: 'user-123', username: 'TestUser' },
    editReply,
    reply,
    followUp,
  } as unknown as import('discord.js').ButtonInteraction;
}

describe('handleVerifyButtonInteraction', () => {
  it('ignores interactions with a different customId', async () => {
    const { handleVerifyButtonInteraction, verifyRSIProfile } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const interaction = makeButtonInteraction('not-verify');
    await handleVerifyButtonInteraction(interaction);
    expect(verifyRSIProfile).not.toHaveBeenCalled();
  });

  it('replies with sessionExpired message when no session data exists', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const interaction = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('expired');
    expect(content).toContain('/verify');
  });

  it('does not call verifyRSIProfile when session data is missing', async () => {
    const { handleVerifyButtonInteraction, verifyRSIProfile } = await loadHandlerWithMocks({
      userData: undefined,
    });
    await handleVerifyButtonInteraction(makeButtonInteraction());
    expect(verifyRSIProfile).not.toHaveBeenCalled();
  });

  it('assigns role and replies with success when verification passes', async () => {
    const { handleVerifyButtonInteraction, assignVerifiedRole } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'https://robertsspaceindustries.com/en/citizens/PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
    });
    const interaction = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(assignVerifiedRole).toHaveBeenCalledTimes(1);
    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('verified');
  });

  it('replies with verificationFailed and removes role when verification fails', async () => {
    const { handleVerifyButtonInteraction, removeVerifiedRole } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: false,
    });
    const interaction = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(removeVerifiedRole).toHaveBeenCalledTimes(1);
    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('verify');
  });
});
