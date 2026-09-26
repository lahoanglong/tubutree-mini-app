/**
 * Integration race tests — chạy trên Postgres THẬT (không mock Prisma).
 * Chạy: DATABASE_URL=<.../tubutree_it> npx jest -c test/integration-race/jest.config.js --runInBand
 * setup-env.ts từ chối chạy nếu DATABASE_URL không trỏ DB throwaway `tubutree_it`.
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.race-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@tubutree/shared-types$': '<rootDir>/../../../../packages/shared-types/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../../tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 60000,
};
