/** @type {import('jest').Config} */
import baseConfig from './jest.config.mjs';

export default {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testRegex: '\\.integration\\.test\\.ts$',
};
