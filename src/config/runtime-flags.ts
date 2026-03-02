const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

function envFlag(name: string, defaultValue = false): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();

  if (trueValues.has(normalizedValue)) {
    return true;
  }

  if (falseValues.has(normalizedValue)) {
    return false;
  }

  return defaultValue;
}

export function isReadOnlyMode(): boolean {
  return envFlag('BOT_READ_ONLY_MODE', true);
}
