import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MessageFlags } from 'discord.js';

beforeEach(() => {
  jest.resetModules();
});

async function loadHandlerWithMocks({
  userData,
  rsiProfileVerified = false,
  rsiCanonicalHandle = 'PilotOne',
  rsiProfileError,
}: {
  userData: { rsiProfileName: string; dreadnoughtValidationCode: string } | undefined;
  rsiProfileVerified?: boolean;
  rsiCanonicalHandle?: string;
  rsiProfileError?: Error;
}) {
  const getUserVerificationData = jest.fn(() => userData);
  const clearUserVerificationData = jest.fn();
  const verifyRSIProfile = jest.fn(async () => {
    if (rsiProfileError) throw rsiProfileError;
    return { verified: rsiProfileVerified, canonicalHandle: rsiCanonicalHandle };
  });
  const assignVerifiedRole = jest.fn(async () => true);
  const removeVerifiedRole = jest.fn(async () => undefined);

  const loggerWarn = jest.fn();
  const loggerError = jest.fn();
  await jest.unstable_mockModule('../../utils/logger.js', () => ({
    getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: loggerWarn, error: loggerError }),
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
    loggerWarn,
    loggerError,
  };
}

function makeButtonInteraction(customId = 'verify', { hasManageNicknames = true } = {}) {
  const setNickname = jest.fn<() => Promise<unknown>>(async () => undefined);
  const member = { setNickname };
  const interaction = {
    customId,
    deferred: false,
    replied: false,
    locale: 'en-US',
    user: { id: 'user-123', username: 'TestUser' },
    appPermissions: { has: jest.fn(() => hasManageNicknames) },
    guild: {
      members: {
        fetch: jest.fn(async () => member),
      },
    },
    deferReply: jest.fn(async () => { interaction.deferred = true; }),
    editReply: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
    followUp: jest.fn(async () => undefined),
  };
  return { interaction: interaction as unknown as import('discord.js').ButtonInteraction, setNickname };
}

describe('handleVerifyButtonInteraction', () => {
  it('logs at error level and rethrows when deferReply throws an unexpected error', async () => {
    const { handleVerifyButtonInteraction, verifyRSIProfile, clearUserVerificationData, loggerError, loggerWarn } =
      await loadHandlerWithMocks({ userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc' } });
    const { interaction } = makeButtonInteraction();
    const deferError = new TypeError('Something unexpected');
    (interaction.deferReply as jest.Mock).mockImplementation(async () => { throw deferError; });

    await expect(handleVerifyButtonInteraction(interaction)).rejects.toThrow('Something unexpected');

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerWarn).not.toHaveBeenCalled();
    const [message, meta] = (loggerError as jest.Mock).mock.calls[0] as [string, { userId: string; error: Error }];
    expect(message).toContain('defer');
    expect(meta.userId).toBe('user-123');
    expect(meta.error).toBe(deferError);
    expect(verifyRSIProfile).not.toHaveBeenCalled();
    expect(clearUserVerificationData).not.toHaveBeenCalled();
  });

  it('logs at warn level (not error) and rethrows when deferReply fails with a transport error', async () => {
    const { handleVerifyButtonInteraction, loggerWarn, loggerError } =
      await loadHandlerWithMocks({ userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc' } });
    const { interaction } = makeButtonInteraction();
    const transportError = Object.assign(new Error('Connect Timeout Error'), { name: 'ConnectTimeoutError' });
    (interaction.deferReply as jest.Mock).mockImplementation(async () => { throw transportError; });

    await expect(handleVerifyButtonInteraction(interaction)).rejects.toThrow(transportError);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerError).not.toHaveBeenCalled();
    const [message, meta] = (loggerWarn as jest.Mock).mock.calls[0] as [string, { userId: string; error: Error }];
    expect(message).toContain('defer');
    expect(meta.userId).toBe('user-123');
    expect(meta.error).toBe(transportError);
  });

  it('logs at warn level (not error) and rethrows when deferReply fails with an expired token', async () => {
    const { handleVerifyButtonInteraction, loggerWarn, loggerError } =
      await loadHandlerWithMocks({ userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc' } });
    const { interaction } = makeButtonInteraction();
    const { DiscordAPIError, RESTJSONErrorCodes } = await import('discord.js');
    const tokenExpiredError = Object.assign(
      new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownInteraction, message: 'Unknown interaction' } as never,
        RESTJSONErrorCodes.UnknownInteraction,
        404,
        'POST',
        '',
        {}
      ),
      { code: RESTJSONErrorCodes.UnknownInteraction }
    );
    (interaction.deferReply as jest.Mock).mockImplementation(async () => { throw tokenExpiredError; });

    await expect(handleVerifyButtonInteraction(interaction)).rejects.toThrow(tokenExpiredError);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerError).not.toHaveBeenCalled();
    const [message, meta] = (loggerWarn as jest.Mock).mock.calls[0] as [string, { userId: string; error: Error }];
    expect(message).toContain('defer');
    expect(meta.userId).toBe('user-123');
    expect(meta.error).toBe(tokenExpiredError);
  });

  it('skips deferReply when interaction is already deferred', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({ userData: undefined });
    const { interaction } = makeButtonInteraction();
    interaction.deferred = true as unknown as typeof interaction.deferred;

    await handleVerifyButtonInteraction(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    // Processing continues — session expired path uses editReply (already deferred)
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  it('ignores interactions with a different customId', async () => {
    const { handleVerifyButtonInteraction, verifyRSIProfile } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const { interaction } = makeButtonInteraction('not-verify');
    await handleVerifyButtonInteraction(interaction);
    expect(verifyRSIProfile).not.toHaveBeenCalled();
  });

  it('defers the reply ephemerally before processing', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const { interaction } = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('replies with sessionExpired message when no session data exists', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: undefined,
    });
    const { interaction } = makeButtonInteraction();
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
    const { interaction } = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);
    expect(verifyRSIProfile).not.toHaveBeenCalled();
  });

  it('assigns role, sets nickname, and replies with success when verification passes', async () => {
    const { handleVerifyButtonInteraction, assignVerifiedRole } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
    });
    const { interaction, setNickname } = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(assignVerifiedRole).toHaveBeenCalledTimes(1);
    expect(setNickname).toHaveBeenCalledTimes(1);
    expect(setNickname).toHaveBeenCalledWith('PilotOne');
    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('verified');
  });

  it('sets nickname to canonical handle from RSI page, not the typed input', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'pilotone', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
      rsiCanonicalHandle: 'PilotOne',
    });
    const { interaction, setNickname } = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(setNickname).toHaveBeenCalledWith('PilotOne');
    expect(setNickname).not.toHaveBeenCalledWith('pilotone');
  });

  it('replies with success and missingPermissionNickname warning and does not set nickname when ManageNicknames is missing', async () => {
    const { handleVerifyButtonInteraction, assignVerifiedRole } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
    });
    const { interaction, setNickname } = makeButtonInteraction('verify', { hasManageNicknames: false });
    await handleVerifyButtonInteraction(interaction);

    expect(assignVerifiedRole).toHaveBeenCalledTimes(1);
    expect(setNickname).not.toHaveBeenCalled();
    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('verified');
    expect(content).toContain('Manage Nicknames');
    expect(content).toContain('administrator');
  });

  it('replies with success and nicknameFailed note and logs warn when setNickname throws', async () => {
    const { handleVerifyButtonInteraction, loggerWarn } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: true,
    });
    const { interaction, setNickname } = makeButtonInteraction();
    setNickname.mockImplementation(async () => { throw new Error('Hierarchy error'); });
    await handleVerifyButtonInteraction(interaction);

    const content = ((interaction.editReply as jest.Mock).mock.calls[0] as [{ content: string }])[0].content;
    expect(content).toContain('verified');
    expect(content).toContain('nickname');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('nickname'),
      expect.objectContaining({ userId: 'user-123' }),
    );
  });

  it('does not set nickname when verification fails', async () => {
    const { handleVerifyButtonInteraction } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: false,
    });
    const { interaction, setNickname } = makeButtonInteraction();
    await handleVerifyButtonInteraction(interaction);

    expect(setNickname).not.toHaveBeenCalled();
  });

  it('replies with verificationFailed and removes role when verification fails', async () => {
    const { handleVerifyButtonInteraction, removeVerifiedRole } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileVerified: false,
    });
    const { interaction } = makeButtonInteraction();
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
    const { interaction } = makeButtonInteraction();
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
    const { interaction } = makeButtonInteraction();
    (interaction.editReply as jest.Mock).mockImplementation(async () => { callOrder.push('editReply'); });
    (clearUserVerificationData as jest.Mock).mockImplementation(() => { callOrder.push('clear'); });

    await handleVerifyButtonInteraction(interaction);

    expect(clearUserVerificationData).toHaveBeenCalledTimes(1);
    expect(clearUserVerificationData).toHaveBeenCalledWith('user-123');
    expect(callOrder.indexOf('editReply')).toBeLessThan(callOrder.indexOf('clear'));
  });

  it('clears the verification session even if verifyRSIProfile throws', async () => {
    const { handleVerifyButtonInteraction, clearUserVerificationData } = await loadHandlerWithMocks({
      userData: { rsiProfileName: 'PilotOne', dreadnoughtValidationCode: 'abc123' },
      rsiProfileError: new Error('network failure'),
    });
    const { interaction } = makeButtonInteraction();

    await expect(handleVerifyButtonInteraction(interaction)).rejects.toThrow('network failure');

    expect(clearUserVerificationData).toHaveBeenCalledTimes(1);
    expect(clearUserVerificationData).toHaveBeenCalledWith('user-123');
  });
});
