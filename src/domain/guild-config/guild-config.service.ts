import {
  getGuildConfig,
  getAllGuildConfigs as getAllGuildConfigsRepo,
  upsertGuildConfig as upsertGuildConfigRepo,
  type GuildConfig,
  type GuildConfigPatch,
} from './guild-config.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

export type { GuildConfig, GuildConfigPatch };

export type GuildFeature = 'verification' | 'nominationDigest' | 'manufacturing' | 'purgeJobs' | 'birthday';

const FEATURE_FLAG_MAP: Record<GuildFeature, keyof GuildConfig> = {
  verification:    'verificationEnabled',
  nominationDigest:'nominationDigestEnabled',
  manufacturing:   'manufacturingEnabled',
  purgeJobs:       'purgeJobsEnabled',
  birthday:        'birthdayEnabled',
};

export async function getGuildConfigOrNull(guildId: string): Promise<GuildConfig | null> {
  try {
    return await getGuildConfig(guildId);
  } catch (error) {
    logger.error('[guild-config] Failed to load guild config', { guildId, error });
    return null;
  }
}

export async function getAllGuildConfigs(): Promise<GuildConfig[]> {
  return getAllGuildConfigsRepo();
}

export async function upsertGuildConfig(guildId: string, patch: GuildConfigPatch): Promise<GuildConfig> {
  return upsertGuildConfigRepo(guildId, patch);
}

export function isFeatureEnabledForGuild(
  botLevelEnabled: boolean,
  guildConfig: GuildConfig | null,
  feature: GuildFeature,
): boolean {
  if (!botLevelEnabled || guildConfig === null) return false;
  return guildConfig[FEATURE_FLAG_MAP[feature]] === true;
}
