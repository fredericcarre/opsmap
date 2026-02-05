import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/db/migrate.ts',
        'src/db/seed.ts',
        'src/db/migrations/**',
        'src/config/**',
        'src/db/connection.ts',
        'src/db/repositories/**',
        'src/index.ts',
        'src/api/server.ts',
        'src/api/routes/**',
        'src/websocket/**',
        'src/types/**',
        'src/**/types.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
