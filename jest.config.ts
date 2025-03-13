// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Remap local relative imports ending in ".js" to ".ts"
    // but do NOT remap if the import path includes:
    // - "cjs/" 
    // - ends with "identifier.js", "keyword.js", or "react-is.development.js"
    '^(\\.{1,2}/(?!cjs/|.*(?:version|nil|sha1|v5|v4|md5|v35|v3|regex|validate|stringify|rng|v1|comparator|range|compare|satisfies|parse|clone|legacy-streams|polyfills|identifier|keyword|react-is\\.development)\\.js$).*)\\.js$': '$1.ts',
  },
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
