import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.js';
import {
  getUnprocessedNominationByHandle,
  getUnprocessedNominations,
} from '../services/nominations/nominations.repository.js';
import { enqueueNominationCheckJob } from '../services/nominations/job-queue.repository.js';
import {
  ensureCanManageReviewProcessing,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import { recordAuditEvent } from '../services/nominations/audit.repository.js';
import { getLogger } from '../utils/logger.js';
import { sanitizeForInlineText } from '../utils/sanitize.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const rsiHandleKey = 'commands.nominationRefresh.options.rsiHandle.name';

export const NOMINATION_REFRESH_COMMAND_NAME = 'nomination-refresh';

export const nominationRefreshCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_REFRESH_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationRefresh.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: rsiHandleKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominationRefresh.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

export async function handleNominationRefreshCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  // Defer immediately — permission checks below involve async Discord/DB work.
  // Placed before try so a 10062 (expired token) bubbles to the router rather than
  // being swallowed and logged at ERROR here.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {

    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    const rawRequestedHandle = interaction.options.getString(
      i18n.__({ phrase: rsiHandleKey, locale: defaultLocale })
    );
    if (rawRequestedHandle !== null && rawRequestedHandle.trim().length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationRefresh.responses.invalidHandle', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const requestedHandle = rawRequestedHandle?.trim() ?? null;

    let targets: Awaited<ReturnType<typeof getUnprocessedNominations>> = [];
    if (requestedHandle) {
      const nomination = await getUnprocessedNominationByHandle(requestedHandle);
      targets = nomination ? [nomination] : [];
    } else {
      targets = await getUnprocessedNominations();
    }

    if (requestedHandle && targets.length === 0) {
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominationRefresh.responses.singleNotFound', locale },
          { rsiHandle: sanitizeForInlineText(requestedHandle) }
        ),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (targets.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationRefresh.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const requestedScope = requestedHandle ? 'single' : 'all';
    let queueResult: Awaited<ReturnType<typeof enqueueNominationCheckJob>>;
    try {
      queueResult = await enqueueNominationCheckJob(
        interaction.user.id,
        requestedScope,
        targets.map((target) => target.normalizedHandle),
        requestedHandle ? requestedHandle.toLowerCase() : null
      );
      recordAuditEvent({
        eventType: 'nomination_check_refresh_triggered',
        actorUserId: interaction.user.id,
        actorUserTag: interaction.user.tag,
        payloadJson: {
          jobId: queueResult.job.id,
          targetCount: queueResult.job.totalCount,
          scope: requestedScope,
        },
        result: 'success',
      }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
    } catch (err) {
      recordAuditEvent({
        eventType: 'nomination_check_refresh_triggered',
        actorUserId: interaction.user.id,
        actorUserTag: interaction.user.tag,
        payloadJson: { scope: requestedScope },
        result: 'failure',
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
      throw err;
    }

    const summaryContent = i18n.__mf(
      { phrase: 'commands.nominationRefresh.responses.queued', locale },
      {
        jobId: String(queueResult.job.id),
        targetCount: String(queueResult.job.totalCount),
        reused: queueResult.reused ? 'yes' : 'no',
      }
    );
    await interaction.editReply({
      content: summaryContent,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-refresh command failed: ${sanitizeForInlineText(errorMessage)}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    await interaction.editReply({
      content: i18n.__({ phrase, locale }),
      allowedMentions: { parse: [] },
    });
  }
}
