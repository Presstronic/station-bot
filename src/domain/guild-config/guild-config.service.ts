import {
  getGuildConfig,
  getAllGuildConfigs as getAllGuildConfigsRepo,
  upsertGuildConfig as upsertGuildConfigRepo,
  ensureGuildConfigsSchema as ensureGuildConfigsSchemaRepo,
  type GuildConfig,
  type GuildConfigPatch,
} from './guild-config.repository.js';

export type { GuildConfig, GuildConfigPatch };

export type GuildFeature = 'verification' | 'nominationDigest' | 'manufacturing' | 'purgeJobs' | 'birthday';

type BooleanKeys<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T];

const FEATURE_FLAG_MAP: Record<GuildFeature, BooleanKeys<GuildConfig>> = {
  verification:    'verificationEnabled',
  nominationDigest:'nominationDigestEnabled',
  manufacturing:   'manufacturingEnabled',
  purgeJobs:       'purgeJobsEnabled',
  birthday:        'birthdayEnabled',
};

// Returns the config row or null when none exists. Throws on operational errors
// (DB down, DATABASE_URL not set) so callers can distinguish "not configured"
// from "temporarily unavailable" and surface the right message to users.
export async function getGuildConfigOrNull(guildId: string): Promise<GuildConfig | null> {
  return getGuildConfig(guildId);
}

export async function getAllGuildConfigs(): Promise<GuildConfig[]> {
  return getAllGuildConfigsRepo();
}

export async function upsertGuildConfig(guildId: string, patch: GuildConfigPatch): Promise<GuildConfig> {
  return upsertGuildConfigRepo(guildId, patch);
}

export async function ensureGuildConfigsSchema(): Promise<void> {
  return ensureGuildConfigsSchemaRepo();
}

export function isFeatureEnabledForGuild(
  botLevelEnabled: boolean,
  guildConfig: GuildConfig | null,
  feature: GuildFeature,
): boolean {
  if (!botLevelEnabled || guildConfig === null) return false;
  return guildConfig[FEATURE_FLAG_MAP[feature]] === true;
}
