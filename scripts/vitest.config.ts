import { defineConfig } from 'vitest/config';

// The migration's logic lives in the engine (packages/engine/src/migrate-v2.ts) and is exercised
// here, against the real v2 register; `pnpm test` measures it from this run and fails below the
// gate. The engine's own coverage leaves that file out (packages/engine/vitest.config.ts).
const MIGRATE = '../packages/engine/src/migrate-v2.ts';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: [MIGRATE, 'migrate-v2.ts', 'build-enbridge-site.ts'],
      reporter: [['text', { skipFull: true }], 'text-summary'],
      thresholds: {
        [MIGRATE]: { branches: 95 },
      },
    },
  },
});
