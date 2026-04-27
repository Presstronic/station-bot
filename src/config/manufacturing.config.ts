const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (trueValues.has(normalized)) return true;
  if (falseValues.has(normalized)) return false;
  return defaultValue;
}

export function isManufacturingEnabled(): boolean {
  return envFlag('MANUFACTURING_ENABLED', false);
}
