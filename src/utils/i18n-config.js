// src/utils/i18n-config.js
import i18n from 'i18n';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

i18n.configure({
  locales: ['en'],
  directory: join(__dirname, '../../locales'), // adjust path as needed
  defaultLocale: 'en',
  autoReload: true,
  updateFiles: false,
  objectNotation: true,
  logDebugFn: function (msg) {
    console.log('debug:', msg);
  },
  logWarnFn: function (msg) {
    console.warn('warn:', msg);
  },
  logErrorFn: function (msg) {
    console.error('error:', msg);
  },
});

export default i18n;

