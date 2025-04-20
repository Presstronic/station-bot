import i18n from 'i18n';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isTest = process.env.NODE_ENV === 'test';

i18n.configure({
  locales: ['en'],
  directory: join(__dirname, '../locales'), // adjust path as needed
  defaultLocale: 'en',
  autoReload: !isTest,
  updateFiles: false,
  objectNotation: true,
  logDebugFn: isTest ? undefined : (msg) => console.log('debug:', msg),
  logWarnFn: isTest ? undefined : (msg) => console.warn('warn:', msg),
  logErrorFn: isTest ? undefined : (msg) => console.error('error:', msg),
});

export default i18n;

