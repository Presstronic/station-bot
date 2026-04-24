import { withClient, isDatabaseConfigured } from '../../services/nominations/db.js';

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for guild config');
  }
}

export interface GuildConfig {
  guildId: string;

  verificationEnabled: boolean;
  verifiedRoleName: string;
  tempMemberRoleName: string;
  potentialApplicantRoleName: string;
  orgMemberRoleId: string | null;
  orgMemberRoleName: string | null;

  nominationDigestEnabled: boolean;
  nominationDigestChannelId: string | null;
  nominationDigestRoleId: string | null;
  nominationDigestCronSchedule: string;

  manufacturingEnabled: boolean;
  manufacturingForumChannelId: string | null;
  manufacturingStaffChannelId: string | null;
  manufacturingRoleId: string | null;
  manufacturingCreateOrderThreadId: string | null;
  manufacturingOrderLimit: number;
  manufacturingMaxItemsPerOrder: number;
  manufacturingOrderRateLimitPer5Min: number;
  manufacturingOrderRateLimitPerHour: number;
  manufacturingCreateOrderPostTitle: string;
  manufacturingCreateOrderPostMessage: string;
  manufacturingKeepaliveCronSchedule: string;

  purgeJobsEnabled: boolean;
  tempMemberHoursToExpire: number;
  tempMemberPurgeCronSchedule: string;

  birthdayEnabled: boolean;
  birthdayChannelId: string | null;
  birthdayCronSchedule: string;

  createdAt: string;
  updatedAt: string;
}

export type GuildConfigPatch = Partial<Omit<GuildConfig, 'guildId' | 'createdAt' | 'updatedAt'>>;

const PATCH_COLUMN_MAP: Record<keyof GuildConfigPatch, string> = {
  verificationEnabled:              'verification_enabled',
  verifiedRoleName:                 'verified_role_name',
  tempMemberRoleName:               'temp_member_role_name',
  potentialApplicantRoleName:       'potential_applicant_role_name',
  orgMemberRoleId:                  'org_member_role_id',
  orgMemberRoleName:                'org_member_role_name',
  nominationDigestEnabled:          'nomination_digest_enabled',
  nominationDigestChannelId:        'nomination_digest_channel_id',
  nominationDigestRoleId:           'nomination_digest_role_id',
  nominationDigestCronSchedule:     'nomination_digest_cron_schedule',
  manufacturingEnabled:             'manufacturing_enabled',
  manufacturingForumChannelId:      'manufacturing_forum_channel_id',
  manufacturingStaffChannelId:      'manufacturing_staff_channel_id',
  manufacturingRoleId:              'manufacturing_role_id',
  manufacturingCreateOrderThreadId: 'manufacturing_create_order_thread_id',
  manufacturingOrderLimit:          'manufacturing_order_limit',
  manufacturingMaxItemsPerOrder:    'manufacturing_max_items_per_order',
  manufacturingOrderRateLimitPer5Min: 'manufacturing_order_rate_limit_per_5min',
  manufacturingOrderRateLimitPerHour: 'manufacturing_order_rate_limit_per_hour',
  manufacturingCreateOrderPostTitle:   'manufacturing_create_order_post_title',
  manufacturingCreateOrderPostMessage: 'manufacturing_create_order_post_message',
  manufacturingKeepaliveCronSchedule:  'manufacturing_keepalive_cron_schedule',
  purgeJobsEnabled:              'purge_jobs_enabled',
  tempMemberHoursToExpire:       'temp_member_hours_to_expire',
  tempMemberPurgeCronSchedule:   'temp_member_purge_cron_schedule',
  birthdayEnabled:               'birthday_enabled',
  birthdayChannelId:             'birthday_channel_id',
  birthdayCronSchedule:          'birthday_cron_schedule',
};

function mapGuildConfigRow(row: Record<string, unknown>): GuildConfig {
  return {
    guildId: String(row.guild_id),

    verificationEnabled:          Boolean(row.verification_enabled),
    verifiedRoleName:             String(row.verified_role_name),
    tempMemberRoleName:           String(row.temp_member_role_name),
    potentialApplicantRoleName:   String(row.potential_applicant_role_name),
    orgMemberRoleId:              row.org_member_role_id != null ? String(row.org_member_role_id) : null,
    orgMemberRoleName:            row.org_member_role_name != null ? String(row.org_member_role_name) : null,

    nominationDigestEnabled:      Boolean(row.nomination_digest_enabled),
    nominationDigestChannelId:    row.nomination_digest_channel_id != null ? String(row.nomination_digest_channel_id) : null,
    nominationDigestRoleId:       row.nomination_digest_role_id != null ? String(row.nomination_digest_role_id) : null,
    nominationDigestCronSchedule: String(row.nomination_digest_cron_schedule),

    manufacturingEnabled:                   Boolean(row.manufacturing_enabled),
    manufacturingForumChannelId:            row.manufacturing_forum_channel_id != null ? String(row.manufacturing_forum_channel_id) : null,
    manufacturingStaffChannelId:            row.manufacturing_staff_channel_id != null ? String(row.manufacturing_staff_channel_id) : null,
    manufacturingRoleId:                    row.manufacturing_role_id != null ? String(row.manufacturing_role_id) : null,
    manufacturingCreateOrderThreadId:       row.manufacturing_create_order_thread_id != null ? String(row.manufacturing_create_order_thread_id) : null,
    manufacturingOrderLimit:                Number(row.manufacturing_order_limit),
    manufacturingMaxItemsPerOrder:          Number(row.manufacturing_max_items_per_order),
    manufacturingOrderRateLimitPer5Min:     Number(row.manufacturing_order_rate_limit_per_5min),
    manufacturingOrderRateLimitPerHour:     Number(row.manufacturing_order_rate_limit_per_hour),
    manufacturingCreateOrderPostTitle:      String(row.manufacturing_create_order_post_title),
    manufacturingCreateOrderPostMessage:    String(row.manufacturing_create_order_post_message),
    manufacturingKeepaliveCronSchedule:     String(row.manufacturing_keepalive_cron_schedule),

    purgeJobsEnabled:            Boolean(row.purge_jobs_enabled),
    tempMemberHoursToExpire:     Number(row.temp_member_hours_to_expire),
    tempMemberPurgeCronSchedule: String(row.temp_member_purge_cron_schedule),

    birthdayEnabled:      Boolean(row.birthday_enabled),
    birthdayChannelId:    row.birthday_channel_id != null ? String(row.birthday_channel_id) : null,
    birthdayCronSchedule: String(row.birthday_cron_schedule),

    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | number | Date).toISOString(),
  };
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig | null> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT * FROM guild_configs WHERE guild_id = $1`,
      [guildId],
    );
    if (result.rows.length === 0) return null;
    return mapGuildConfigRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function upsertGuildConfig(guildId: string, patch: GuildConfigPatch): Promise<GuildConfig> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const rawEntries = Object.entries(patch).filter(([, val]) => val !== undefined);

    for (const [key] of rawEntries) {
      if (!Object.hasOwn(PATCH_COLUMN_MAP, key)) {
        throw new Error(`upsertGuildConfig: unknown patch key "${key}"`);
      }
    }

    const entries = rawEntries as [keyof GuildConfigPatch, unknown][];

    if (entries.length === 0) {
      const result = await client.query(
        `INSERT INTO guild_configs (guild_id)
         VALUES ($1)
         ON CONFLICT (guild_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [guildId],
      );
      return mapGuildConfigRow(result.rows[0] as Record<string, unknown>);
    }

    const columns = entries.map(([key]) => PATCH_COLUMN_MAP[key]);
    const values = entries.map(([, val]) => val);

    const insertCols = ['guild_id', ...columns].join(', ');
    const insertPlaceholders = ['$1', ...columns.map((_, i) => `$${i + 2}`)].join(', ');
    const setClauses = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');

    const result = await client.query(
      `INSERT INTO guild_configs (${insertCols})
       VALUES (${insertPlaceholders})
       ON CONFLICT (guild_id) DO UPDATE SET ${setClauses}, updated_at = NOW()
       RETURNING *`,
      [guildId, ...values],
    );
    return mapGuildConfigRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function getAllGuildConfigs(): Promise<GuildConfig[]> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const result = await client.query(`SELECT * FROM guild_configs ORDER BY guild_id`);
    return (result.rows as Record<string, unknown>[]).map(mapGuildConfigRow);
  });
}
