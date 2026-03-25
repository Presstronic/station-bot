export interface StartupBannerOptions {
  version: string;
  nodeVersion: string;
  environment: string;
  logLevel: string;
  readOnlyMode: boolean;
  dbConfigured: boolean;
  nominationWorkerActive: boolean;
  purgeJobsEnabled: boolean;
  guildCount: number;
  botTag: string;
  startedAt: string;
}

const INNER_WIDTH = 54;

function truncateToInner(text: string): string {
  const codepoints = [...text];
  if (codepoints.length <= INNER_WIDTH) return text;
  return codepoints.slice(0, INNER_WIDTH - 1).join('') + '…';
}

function row(label: string, value: string): string {
  const content = `  ${label.padEnd(17)}: ${value}`;
  return `║${truncateToInner(content).padEnd(INNER_WIDTH)}║`;
}

function centered(text: string): string {
  const safe = truncateToInner(text);
  const totalPadding = INNER_WIDTH - [...safe].length;
  const left = Math.floor(totalPadding / 2);
  return safe.padStart(left + safe.length).padEnd(INNER_WIDTH);
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
    row('Guilds', String(guildCount)),
    row('Logged in as', botTag),
    row('Started at', startedAt),
    `╚${hr}╝`,
  ].join('\n');
}
