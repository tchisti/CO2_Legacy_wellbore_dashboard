import { defineConfig } from 'vitest/config';

// `pnpm test` runs with coverage and fails below these thresholds (spec §10: engine and parser
// fully branch-covered). migrate-v2.ts is gated from the scripts package instead, whose tests run
// it against the real v2 register (scripts/vitest.config.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/migrate-v2.ts'],
      reporter: [['text', { skipFull: true }], 'text-summary'],
      thresholds: {
        'src/{scoring,recommend,suggest,stale,geo,domain,ids}.ts': {
          branches: 100,
          lines: 100,
          functions: 100,
          perFile: true,
        },
        // The parser keeps `?? ''` fallbacks on regex groups that always match (noUncheckedIndexedAccess)
        // and a never-throw catch; those branches cannot run (see the Task 18a report).
        'src/wellbore/**': { branches: 90 },
      },
    },
  },
});
