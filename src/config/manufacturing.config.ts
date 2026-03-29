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

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

export interface ManufacturingConfig {
  forumChannelId: string;
  manufacturingRoleId: string;
  organizationMemberRoleId: string;
  orderLimit: number;
  maxItemsPerOrder: number;
}

export function isManufacturingEnabled(): boolean {
  return envFlag('MANUFACTURING_ENABLED', false);
}

export function getManufacturingConfig(): ManufacturingConfig {
  return {
    forumChannelId: (process.env.MANUFACTURING_FORUM_CHANNEL_ID ?? '').trim(),
    manufacturingRoleId: (process.env.MANUFACTURING_ROLE_ID ?? '').trim(),
    organizationMemberRoleId: (process.env.ORGANIZATION_MEMBER_ROLE_ID ?? '').trim(),
    orderLimit: envInt('MANUFACTURING_ORDER_LIMIT', 5),
    maxItemsPerOrder: envInt('MANUFACTURING_MAX_ITEMS_PER_ORDER', 10),
  };
}

/**
 * Validates manufacturing config when the feature is enabled.
 * Returns an array of error messages — empty array means valid.
 */
export function validateManufacturingConfig(): string[] {
  if (!isManufacturingEnabled()) return [];

  const errors: string[] = [];

  if (!(process.env.MANUFACTURING_FORUM_CHANNEL_ID ?? '').trim()) {
    errors.push('MANUFACTURING_FORUM_CHANNEL_ID is required when MANUFACTURING_ENABLED=true');
  }
  if (!(process.env.MANUFACTURING_ROLE_ID ?? '').trim()) {
    errors.push('MANUFACTURING_ROLE_ID is required when MANUFACTURING_ENABLED=true');
  }
  if (!(process.env.ORGANIZATION_MEMBER_ROLE_ID ?? '').trim()) {
    errors.push('ORGANIZATION_MEMBER_ROLE_ID is required when MANUFACTURING_ENABLED=true');
  }

  return errors;
}
