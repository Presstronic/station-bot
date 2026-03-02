import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { getUnprocessedNominations, updateOrgCheckStatus } from '../services/nominations/nominations.repository.ts';
import { checkHasAnyOrgMembership } from '../services/nominations/org-check.service.ts';
import type { OrgCheckStatus } from '../services/nominations/types.ts';
import { ensureAdmin, formatNominationsAsTable, getCommandLocale } from './nomination.helpers.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export const REVIEW_NOMINATIONS_COMMAND_NAME = 'review-nominations';

export const reviewNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(REVIEW_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.reviewNominations.description', locale: defaultLocale }))
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function handleReviewNominationsCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  if (!(await ensureAdmin(interaction))) {
    return;
  }

  const nominations = getUnprocessedNominations();
  if (nominations.length === 0) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.reviewNominations.responses.none', locale }),
      ephemeral: true,
    });
    return;
  }

  for (const nomination of nominations) {
    let status: OrgCheckStatus = 'unknown';
    try {
      status = await checkHasAnyOrgMembership(nomination.displayHandle);
    } catch {
      status = 'unknown';
    }
    updateOrgCheckStatus(nomination.normalizedHandle, status);
    nomination.lastOrgCheckStatus = status;
  }

  const table = formatNominationsAsTable(nominations);
  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.summary', locale },
      { table }
    ),
    ephemeral: true,
  });
}
