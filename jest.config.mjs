/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  resolver: 'ts-jest-resolver',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true
    }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.integration\\.test\\.ts$'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  forceExit: true,
};
