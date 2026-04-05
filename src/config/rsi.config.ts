const DEFAULT_CITIZEN_URL_PATTERN = 'https://robertsspaceindustries.com/en/citizens/{handle}';

export function getRsiConfig() {
  const citizenUrlPattern = process.env.RSI_CITIZEN_URL_PATTERN?.trim() || DEFAULT_CITIZEN_URL_PATTERN;
  return {
    citizenUrlPattern,
    bioParentSelector: 'div.entry.bio',
    bioChildSelector: 'div.value',
  };
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
