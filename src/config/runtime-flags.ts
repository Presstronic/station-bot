const trueValues = new Set(['1', 'true', 'yes', 'on']);

function envFlag(name: string, defaultValue = false): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  return trueValues.has(rawValue.trim().toLowerCase());
}

export function isReadOnlyMode(): boolean {
  return envFlag('BOT_READ_ONLY_MODE', true);
}
