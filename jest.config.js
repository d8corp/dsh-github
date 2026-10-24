// jest.config.ts
export default {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['.*.speed.test.ts$', 'speed-test'],
  coverageDirectory: 'docs/coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: { ignoreCodes: [1343] },
        astTransformers: {
          before: [
            {
              path: 'node_modules/ts-jest-mock-import-meta',
              options: {
                metaObjectReplacement: {},
              },
            },
          ],
        },
      },
    ],
  },
}
