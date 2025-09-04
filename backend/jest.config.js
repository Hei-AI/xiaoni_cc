module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // 为不同类型的测试设置不同的运行模式
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*.test.ts'],
      testPathIgnorePatterns: [
        '<rootDir>/tests/end-to-end-conversation.test.ts',
        '<rootDir>/tests/websocket-message-simulator.test.ts',
        '<rootDir>/tests/performance-stress.test.ts'
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
      },
      testTimeout: 30000
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/tests/end-to-end-conversation.test.ts',
        '<rootDir>/tests/websocket-message-simulator.test.ts'
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
      },
      testTimeout: 60000
    },
    {
      displayName: 'performance',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/performance-stress.test.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
      },
      testTimeout: 120000
    }
  ]
};