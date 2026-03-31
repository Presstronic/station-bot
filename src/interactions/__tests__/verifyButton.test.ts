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
  const clearUserVerificationData = jest.fn();
  const verifyRSIProfile = jest.fn(async () => rsiProfileVerified);
  const assignVerifiedRole = jest.fn(async () => true);
  const removeVerifiedRole = jest.fn(async () => undefined);

  await jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }));
  await jest.unstable_mockModule('../../commands/verify.js', () => ({
    getUserVerificationData,
    clearUserVerificationData,
  }));
  await jest.unstable_mockModule('../../services/rsi.services.js', () => ({
    verifyRSIProfile,
  }));
  await jest.unstable_mockModule('../../services/role.services.js', () => ({
    assignVerifiedRole,
    removeVerifiedRole,
  }));

  const { handleVerifyButtonInteraction } = await import('../verifyButton.js');

  return {
    handleVerifyButtonInteraction,
    getUserVerificationData,
    clearUserVerificationData,
    verifyRSIProfile,
    assignVerifiedRole,
    removeVerifiedRole,
  };
}

function makeButtonInteraction(customId = 'verify') {
  const interaction = {
    customId,
    deferred: false,
    replied: false,
    locale: 'en-US',
    user: { id: 'user-123', username: 'TestUser' },
    deferReply: jest.fn(async () => { interaction.deferred = true; }),
    editReply: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
    followUp: jest.fn(async () => undefined),
  };
  return interaction as unknown as import('discord.js').ButtonInteraction;
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

  it('defers the reply ephemerally before processing', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const interaction = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 }); // MessageFlags.Ephemeral
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

  it('clears the verification session only after the reply is sent on success', async () => {
    const { handleVerifyButtonInteraction, clearUserVerificationData } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
    });
    const callOrder: string[] = [];
    const interaction = makeButtonInteraction();
    (interaction.editReply as jest.Mock).mockImplementation(async () => { callOrder.push('editReply'); });
    (clearUserVerificationData as jest.Mock).mockImplementation(() => { callOrder.push('clear'); });

    await handleVerifyButtonInteraction(interaction);

    expect(clearUserVerificationData).toHaveBeenCalledTimes(1);
    expect(clearUserVerificationData).toHaveBeenCalledWith('user-123');
    expect(callOrder.indexOf('editReply')).toBeLessThan(callOrder.indexOf('clear'));
  });

  it('clears the verification session only after the reply is sent on failure', async () => {
    const { handleVerifyButtonInteraction, clearUserVerificationData } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: false,
    });
    const callOrder: string[] = [];
    const interaction = makeButtonInteraction();
    (interaction.editReply as jest.Mock).mockImplementation(async () => { callOrder.push('editReply'); });
    (clearUserVerificationData as jest.Mock).mockImplementation(() => { callOrder.push('clear'); });

    await handleVerifyButtonInteraction(interaction);

    expect(clearUserVerificationData).toHaveBeenCalledTimes(1);
    expect(clearUserVerificationData).toHaveBeenCalledWith('user-123');
    expect(callOrder.indexOf('editReply')).toBeLessThan(callOrder.indexOf('clear'));
  });
});
