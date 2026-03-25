import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { toDateString } from '../utils/date.js';
import {
  ensureCanManageReviewProcessing,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import {
  getLatestNominationCheckJob,
  getNominationCheckJobById,
} from '../services/nominations/job-queue.repository.js';
import { getLogger } from '../utils/logger.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const jobIdOptionKey = 'commands.nominationJobStatus.options.jobId.name';

export const NOMINATION_JOB_STATUS_COMMAND_NAME = 'nomination-job-status';

export const nominationJobStatusCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_JOB_STATUS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationJobStatus.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: jobIdOptionKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominationJobStatus.options.jobId.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

export async function handleNominationJobStatusCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    // Defer immediately — permission checks below involve async Discord/DB work.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    const rawJobId = interaction.options.getString(
      i18n.__({ phrase: jobIdOptionKey, locale: defaultLocale })
    );
    if (rawJobId !== null && rawJobId.trim().length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationJobStatus.responses.invalidJobId', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const requestedJobId = rawJobId ? Number(rawJobId.trim()) : null;
    if (rawJobId && (!Number.isInteger(requestedJobId) || requestedJobId === null || requestedJobId <= 0)) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationJobStatus.responses.invalidJobId', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const job = requestedJobId
      ? await getNominationCheckJobById(requestedJobId)
      : await getLatestNominationCheckJob();

    if (!job) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationJobStatus.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.editReply({
      content: i18n.__mf(
        { phrase: 'commands.nominationJobStatus.responses.summary', locale },
        {
          jobId: String(job.id),
          status: job.status,
          scope: job.requestedScope,
          requestedHandle: job.requestedHandle ?? 'n/a',
          totalCount: String(job.totalCount),
          pendingCount: String(job.pendingCount),
          runningCount: String(job.runningCount),
          completedCount: String(job.completedCount),
          failedCount: String(job.failedCount),
          createdAt: toDateString(job.createdAt),
          startedAt: toDateString(job.startedAt),
          finishedAt: toDateString(job.finishedAt),
          errorSummary: job.errorSummary ?? 'none',
        }
      ),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-job-status command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: i18n.__({ phrase, locale }),
        allowedMentions: { parse: [] },
      });
    }
  }
}
