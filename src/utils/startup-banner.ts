export interface StartupBannerOptions {
  version: string;
  nodeVersion: string;
  environment: string;
  logLevel: string;
  readOnlyMode: boolean;
  dbConfigured: boolean;
  nominationWorkerActive: boolean;
  purgeJobsEnabled: boolean;
  rsiVerificationEnabled: boolean;
  manufacturingOrdersEnabled: boolean;
  guildCount: number;
  botTag: string;
  startedAt: string;
}

const INNER_WIDTH = 54;

function cpLength(s: string): number {
  return [...s].length;
}

function cpPadEnd(s: string, width: number): string {
  const len = cpLength(s);
  return len >= width ? s : s + ' '.repeat(width - len);
}

function truncateToInner(text: string): string {
  const codepoints = [...text];
  if (codepoints.length <= INNER_WIDTH) return text;
  return codepoints.slice(0, INNER_WIDTH - 1).join('') + '…';
}

function row(label: string, value: string): string {
  const content = `  ${label.padEnd(17)}: ${value}`;
  return `║${cpPadEnd(truncateToInner(content), INNER_WIDTH)}║`;
}

function centered(text: string): string {
  const safe = truncateToInner(text);
  const totalPadding = INNER_WIDTH - cpLength(safe);
  const left = Math.floor(totalPadding / 2);
  return cpPadEnd(' '.repeat(left) + safe, INNER_WIDTH);
}

export function buildStartupBanner(options: StartupBannerOptions): string {
  const {
    version,
    nodeVersion,
    environment,
    logLevel,
    readOnlyMode,
    dbConfigured,
    nominationWorkerActive,
    purgeJobsEnabled,
    rsiVerificationEnabled,
    manufacturingOrdersEnabled,
    guildCount,
    botTag,
    startedAt,
  } = options;

  const hr = '═'.repeat(INNER_WIDTH);

  return [
    `╔${hr}╗`,
    `║${centered('S T A T I O N   B O T')}║`,
    `╠${hr}╣`,
    row('Version', version),
    row('Node.js', nodeVersion),
    row('Environment', environment),
    row('Log level', logLevel),
    row('Read-only mode', String(readOnlyMode)),
    row('DB configured', String(dbConfigured)),
    row('Nom. worker', nominationWorkerActive ? 'enabled' : 'disabled'),
    row('Purge jobs', purgeJobsEnabled ? 'enabled' : 'disabled'),
    row('RSI Verification', rsiVerificationEnabled ? 'enabled' : 'disabled'),
    row('Mfg. Orders', manufacturingOrdersEnabled ? 'enabled' : 'disabled'),
    row('Guilds', String(guildCount)),
    row('Logged in as', botTag),
    row('Started at', startedAt),
    `╚${hr}╝`,
  ].join('\n');
}
