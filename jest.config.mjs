// jest.config.mjs
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(.+)\\.js$': '$1.js',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: './tsconfig.test.json' }],
  },  
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
