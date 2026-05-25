import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { getNominationCountsByUser, getPendingNominationsByUser } from '../services/nominations/nominations.repository.js';
import { getCommandLocale, isNominationConfigurationError } from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';
import { toDateString } from '../utils/date.js';
import { sanitizeForInlineText } from '../utils/sanitize.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const discordMessageLimit = 2000;
const defaultMyNominationsMessageMaxLength = 2000;
const minimumMyNominationsMessageMaxLength = 200;

export const MY_NOMINATIONS_COMMAND_NAME = 'my-nominations';

export const myNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(MY_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.myNominations.description', locale: defaultLocale }))
  .setDMPermission(false);

function formatNominationCount(count: number): string {
  return `${count} nomination${count === 1 ? '' : 's'}`;
}

function truncateToLimit(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  if (limit <= 3) {
    return value.slice(0, limit);
  }
  return `${value.slice(0, limit - 3)}...`;
}

function getMyNominationsMessageMaxLength(): number {
  const raw = process.env.MY_NOMINATIONS_MAX_MESSAGE_LENGTH?.trim();
  if (!raw) {
    return defaultMyNominationsMessageMaxLength;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return defaultMyNominationsMessageMaxLength;
  }

  if (parsed < minimumMyNominationsMessageMaxLength) {
    logger.warn('MY_NOMINATIONS_MAX_MESSAGE_LENGTH is below the supported minimum; using default', {
      configuredValue: parsed,
      minimumSupportedValue: minimumMyNominationsMessageMaxLength,
      defaultValue: defaultMyNominationsMessageMaxLength,
    });
    return defaultMyNominationsMessageMaxLength;
  }

  return Math.min(parsed, discordMessageLimit);
}

export async function handleMyNominationsCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  const maxMessageLength = getMyNominationsMessageMaxLength();

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const [history, pendingNominations] = await Promise.all([
      getNominationCountsByUser(interaction.user.id),
      getPendingNominationsByUser(interaction.user.id),
    ]);

    if (history.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.myNominations.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const yearlyLines = history.map(({ year, count }) => `${year}: ${formatNominationCount(count)}`);
    const lifetimeTotal = history.reduce((sum, { count }) => sum + count, 0);
    const pendingLines = pendingNominations.map(({ displayHandle, createdAt }) =>
      i18n.__mf(
        { phrase: 'commands.myNominations.responses.pendingLine', locale },
        { displayHandle: sanitizeForInlineText(displayHandle), submittedAt: toDateString(createdAt) }
      )
    );
    const baseContentLines = [
      i18n.__({ phrase: 'commands.myNominations.responses.historyTitle', locale }),
      ...yearlyLines,
      '──────────────────────',
      i18n.__mf(
        { phrase: 'commands.myNominations.responses.lifetimeTotal', locale },
        { count: formatNominationCount(lifetimeTotal) }
      ),
    ];
    const baseContent = baseContentLines.join('\n');
    const contentLines = [...baseContentLines];

    if (pendingLines.length > 0) {
      const pendingTitle = i18n.__mf(
        { phrase: 'commands.myNominations.responses.pendingTitle', locale },
        { count: pendingLines.length }
      );
      const pendingSectionLines = ['', pendingTitle, ...pendingLines];
      let pendingSectionContent = pendingSectionLines.join('\n');

      if ([...baseContentLines, pendingSectionContent].join('\n').length > maxMessageLength) {
        for (let shownCount = pendingLines.length - 1; shownCount >= 0; shownCount -= 1) {
          const hiddenCount = pendingLines.length - shownCount;
          const truncatedLine = i18n.__mf(
            { phrase: 'commands.myNominations.responses.pendingTruncated', locale },
            { count: hiddenCount }
          );
          const candidateLines = ['', pendingTitle, ...pendingLines.slice(0, shownCount), truncatedLine];
          pendingSectionContent = candidateLines.join('\n');
          if ([...baseContentLines, pendingSectionContent].join('\n').length <= maxMessageLength) {
            logger.warn('my-nominations response truncated to fit Discord message limit', {
              userId: interaction.user.id,
              maxMessageLength,
              pendingNominationCount: pendingLines.length,
              displayedPendingNominationCount: shownCount,
              hiddenPendingNominationCount: hiddenCount,
            });
            break;
          }
        }
      }

      contentLines.push(pendingSectionContent);
    }

    let finalContent = contentLines.join('\n');
    if (finalContent.length > maxMessageLength) {
      if (maxMessageLength < discordMessageLimit && finalContent.length <= discordMessageLimit) {
        logger.warn('my-nominations response exceeded configured limit; falling back to Discord limit', {
          userId: interaction.user.id,
          configuredMaxMessageLength: maxMessageLength,
          fallbackMaxMessageLength: discordMessageLimit,
          finalContentLength: finalContent.length,
        });
      } else if (baseContent.length <= discordMessageLimit) {
        logger.warn('my-nominations response exceeded configured limit even after pending truncation; dropping pending section', {
          userId: interaction.user.id,
          configuredMaxMessageLength: maxMessageLength,
          fallbackMaxMessageLength: discordMessageLimit,
          finalContentLength: finalContent.length,
        });
        finalContent = baseContent;
      } else {
        logger.warn('my-nominations base response exceeded Discord message limit; hard truncating output', {
          userId: interaction.user.id,
          configuredMaxMessageLength: maxMessageLength,
          fallbackMaxMessageLength: discordMessageLimit,
          baseContentLength: baseContent.length,
        });
        finalContent = truncateToLimit(baseContent, discordMessageLimit);
      }
    }

    await interaction.editReply({
      content: finalContent,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`my-nominations command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    await interaction.editReply({
      content: i18n.__({ phrase, locale }),
      allowedMentions: { parse: [] },
    });
  }
}
