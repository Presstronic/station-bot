const DEFAULT_CITIZEN_URL_PATTERN = 'https://robertsspaceindustries.com/en/citizens/{handle}';

export function getRsiConfig() {
  return {
    citizenUrlPattern: process.env.RSI_CITIZEN_URL_PATTERN ?? DEFAULT_CITIZEN_URL_PATTERN,
    bioParentSelector: 'div.entry.bio',
    bioChildSelector: 'div.value',
  };
}

export function buildCitizenUrl(handle: string): string {
  const { citizenUrlPattern } = getRsiConfig();
  return citizenUrlPattern.replace('{handle}', encodeURIComponent(handle));
}
