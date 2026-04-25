import type { Client } from 'discord.js';
import { getGuildConfig, upsertGuildConfig, type GuildConfigPatch } from './guild-config.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

function envStr(name: string): string | undefined {
  const val = process.env[name]?.trim();
  return val || undefined;
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (trueValues.has(raw)) return true;
  if (falseValues.has(raw)) return false;
  return undefined;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) {
    logger.warn(`[guild-config seeder] Ignoring invalid positive integer env var ${name}.`, { value: raw });
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    logger.warn(`[guild-config seeder] Ignoring invalid positive integer env var ${name}.`, { value: raw });
    return undefined;
  }
  return parsed;
}

function buildPatchFromEnv(): GuildConfigPatch {
  const patch: GuildConfigPatch = {};

  const verificationEnabled = envBool('VERIFICATION_ENABLED');
  if (verificationEnabled !== undefined) patch.verificationEnabled = verificationEnabled;

  const defaultRolesRaw = envStr('DEFAULT_ROLES');
  if (defaultRolesRaw !== undefined) {
    const roles = defaultRolesRaw.split(',').map((r) => r.trim());
    if (roles[0]) patch.verifiedRoleName = roles[0];
    if (roles[1]) patch.tempMemberRoleName = roles[1];
    if (roles[2]) patch.potentialApplicantRoleName = roles[2];
  }

  const orgMemberRoleId = envStr('ORGANIZATION_MEMBER_ROLE_ID');
  if (orgMemberRoleId !== undefined) patch.orgMemberRoleId = orgMemberRoleId;

  const orgMemberRoleName = envStr('ORGANIZATION_MEMBER_ROLE_NAME');
  if (orgMemberRoleName !== undefined) patch.orgMemberRoleName = orgMemberRoleName;

  const nominationDigestEnabled = envBool('NOMINATION_DIGEST_ENABLED');
  if (nominationDigestEnabled !== undefined) patch.nominationDigestEnabled = nominationDigestEnabled;

  const nominationDigestChannelId = envStr('NOMINATION_DIGEST_CHANNEL_ID');
  if (nominationDigestChannelId !== undefined) patch.nominationDigestChannelId = nominationDigestChannelId;

  const nominationDigestRoleId = envStr('NOMINATION_DIGEST_ROLE_ID');
  if (nominationDigestRoleId !== undefined) patch.nominationDigestRoleId = nominationDigestRoleId;

  const nominationDigestCronSchedule = envStr('NOMINATION_DIGEST_CRON_SCHEDULE');
  if (nominationDigestCronSchedule !== undefined) patch.nominationDigestCronSchedule = nominationDigestCronSchedule;

  const manufacturingEnabled = envBool('MANUFACTURING_ENABLED');
  if (manufacturingEnabled !== undefined) patch.manufacturingEnabled = manufacturingEnabled;

  const manufacturingForumChannelId = envStr('MANUFACTURING_FORUM_CHANNEL_ID');
  if (manufacturingForumChannelId !== undefined) patch.manufacturingForumChannelId = manufacturingForumChannelId;

  const manufacturingStaffChannelId = envStr('MANUFACTURING_STAFF_CHANNEL_ID');
  if (manufacturingStaffChannelId !== undefined) patch.manufacturingStaffChannelId = manufacturingStaffChannelId;

  const manufacturingRoleId = envStr('MANUFACTURING_ROLE_ID');
  if (manufacturingRoleId !== undefined) patch.manufacturingRoleId = manufacturingRoleId;

  const manufacturingCreateOrderThreadId = envStr('MANUFACTURING_CREATE_ORDER_THREAD_ID');
  if (manufacturingCreateOrderThreadId !== undefined) patch.manufacturingCreateOrderThreadId = manufacturingCreateOrderThreadId;

  const manufacturingOrderLimit = envInt('MANUFACTURING_ORDER_LIMIT');
  if (manufacturingOrderLimit !== undefined) patch.manufacturingOrderLimit = manufacturingOrderLimit;

  const manufacturingMaxItemsPerOrder = envInt('MANUFACTURING_MAX_ITEMS_PER_ORDER');
  if (manufacturingMaxItemsPerOrder !== undefined) patch.manufacturingMaxItemsPerOrder = manufacturingMaxItemsPerOrder;

  const manufacturingOrderRateLimitPer5Min = envInt('ORDER_RATE_LIMIT_PER_5MIN');
  if (manufacturingOrderRateLimitPer5Min !== undefined) patch.manufacturingOrderRateLimitPer5Min = manufacturingOrderRateLimitPer5Min;

  const manufacturingOrderRateLimitPerHour = envInt('ORDER_RATE_LIMIT_PER_HOUR');
  if (manufacturingOrderRateLimitPerHour !== undefined) patch.manufacturingOrderRateLimitPerHour = manufacturingOrderRateLimitPerHour;

  const manufacturingCreateOrderPostTitle = envStr('MANUFACTURING_CREATE_ORDER_POST_TITLE');
  if (manufacturingCreateOrderPostTitle !== undefined) patch.manufacturingCreateOrderPostTitle = manufacturingCreateOrderPostTitle;

  const manufacturingCreateOrderPostMessage = envStr('MANUFACTURING_CREATE_ORDER_POST_MESSAGE');
  if (manufacturingCreateOrderPostMessage !== undefined) patch.manufacturingCreateOrderPostMessage = manufacturingCreateOrderPostMessage;

  const manufacturingKeepaliveCronSchedule = envStr('MANUFACTURING_KEEPALIVE_CRON_SCHEDULE');
  if (manufacturingKeepaliveCronSchedule !== undefined) patch.manufacturingKeepaliveCronSchedule = manufacturingKeepaliveCronSchedule;

  const purgeJobsEnabled = envBool('PURGE_JOBS_ENABLED');
  if (purgeJobsEnabled !== undefined) patch.purgeJobsEnabled = purgeJobsEnabled;

  const tempMemberPurgeCronSchedule = envStr('TEMPORARY_MEMBER_PURGE_CRON_SCHEDULE');
  if (tempMemberPurgeCronSchedule !== undefined) patch.tempMemberPurgeCronSchedule = tempMemberPurgeCronSchedule;

  const birthdayEnabled = envBool('BIRTHDAY_ENABLED');
  if (birthdayEnabled !== undefined) patch.birthdayEnabled = birthdayEnabled;

  const birthdayChannelId = envStr('BIRTHDAY_CHANNEL_ID');
  if (birthdayChannelId !== undefined) patch.birthdayChannelId = birthdayChannelId;

  return patch;
}

export async function seedGuildConfigsFromEnv(client: Client): Promise<void> {
  const patch = buildPatchFromEnv();
  const guilds = [...client.guilds.cache.values()];

  const results = await Promise.allSettled(
    guilds.map(async (guild) => {
      const existing = await getGuildConfig(guild.id);
      if (existing) {
        logger.debug(`[guild-config seeder] Guild ${guild.id} (${guild.name}) already has a config row — skipping.`);
        return;
      }
      await upsertGuildConfig(guild.id, patch);
      logger.info(`[guild-config seeder] Seeded config for guild ${guild.id} (${guild.name}) from env.`);
    }),
  );

  const failedResults: PromiseRejectedResult[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const guild = guilds[index];
      failedResults.push(result);
      logger.warn(`[guild-config seeder] Failed to seed config for guild ${guild.id} (${guild.name}).`, {
        error: result.reason,
      });
    }
  });

  if (failedResults.length === guilds.length && failedResults.length > 0) {
    throw new AggregateError(
      failedResults.map((r) => r.reason),
      '[guild-config seeder] Failed to seed config for every guild. Check database connectivity and migrations.',
    );
  }
}
