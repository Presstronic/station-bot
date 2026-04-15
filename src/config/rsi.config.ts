const DEFAULT_CITIZEN_URL_PATTERN = 'https://robertsspaceindustries.com/en/citizens/{handle}';
const DEFAULT_PROFILE_EDIT_URL = 'https://robertsspaceindustries.com/en/account/profile';

export function getRsiConfig() {
  const citizenUrlPattern = process.env.RSI_CITIZEN_URL_PATTERN?.trim() || DEFAULT_CITIZEN_URL_PATTERN;
  return {
    citizenUrlPattern,
    bioParentSelector: 'div.entry.bio',
    bioChildSelector: 'div.value',
  };
}

export function getRsiProfileEditUrl(): string {
  return process.env.RSI_PROFILE_EDIT_URL?.trim() || DEFAULT_PROFILE_EDIT_URL;
}

export function buildCitizenUrl(handle: string): string {
  const { citizenUrlPattern } = getRsiConfig();
  if (!citizenUrlPattern.includes('{handle}')) {
    throw new Error(
      'Invalid RSI_CITIZEN_URL_PATTERN configuration: expected the pattern to contain the "{handle}" placeholder.',
    );
  }
  return citizenUrlPattern.replace('{handle}', encodeURIComponent(handle.trim()));
}
