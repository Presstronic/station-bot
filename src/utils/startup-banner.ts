import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json') as { version: string };

export interface StartupBannerOptions {
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

function row(label: string, value: string): string {
  const content = `  ${label.padEnd(17)}: ${value}`;
  return `║${content.padEnd(INNER_WIDTH)}║`;
}

function centered(text: string): string {
  const totalPadding = INNER_WIDTH - text.length;
  const left = Math.floor(totalPadding / 2);
  return text.padStart(left + text.length).padEnd(INNER_WIDTH);
}

export function buildStartupBanner(options: StartupBannerOptions): string {
  const {
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
    row('Node.js', process.version),
    row('Environment', process.env.NODE_ENV ?? 'development'),
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
