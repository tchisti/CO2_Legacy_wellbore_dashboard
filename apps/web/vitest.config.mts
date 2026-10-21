import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig `paths` ("@/*" → "./*"), so tests import `@/lib/...` as the app does.
    alias: { "@": dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "out/**"],
    // `pnpm test` runs with coverage. The gate is the store (spec §10: store adapter >= 90 %);
    // the rest of the app is measured and reported, not gated. contract.ts is the Store contract
    // suite (test code that local-store.test.ts runs), so it is not measured.
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "lib/store/contract.ts"],
      reporter: ["text-summary"],
      thresholds: {
        "lib/store/**": { branches: 90, lines: 90 },
      },
    },
  },
});
