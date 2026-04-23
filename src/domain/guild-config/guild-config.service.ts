import { getGuildConfig, type GuildConfig } from './guild-config.repository.js';

export type { GuildConfig };

export type GuildFeature = 'verification' | 'nominationDigest' | 'manufacturing' | 'purgeJobs' | 'birthday';

const FEATURE_FLAG_MAP: Record<GuildFeature, keyof GuildConfig> = {
  verification:    'verificationEnabled',
  nominationDigest:'nominationDigestEnabled',
  manufacturing:   'manufacturingEnabled',
  purgeJobs:       'purgeJobsEnabled',
  birthday:        'birthdayEnabled',
};

export async function getGuildConfigOrNull(guildId: string): Promise<GuildConfig | null> {
  return getGuildConfig(guildId);
}

export function isFeatureEnabledForGuild(
  botLevelEnabled: boolean,
  guildConfig: GuildConfig | null,
  feature: GuildFeature,
): boolean {
  if (!botLevelEnabled || guildConfig === null) return false;
  return guildConfig[FEATURE_FLAG_MAP[feature]] === true;
}
