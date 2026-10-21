import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Test code that app code must never pull into the bundle: the Store contract suite (it imports
// vitest) and vitest itself.
const TEST_ONLY = "Test code only: app code must not import the Store contract suite or vitest.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs}"],
    ignores: [
      "**/*.test.*",
      "e2e/**",
      "lib/store/contract.ts",
      "lib/store/*.test.ts",
      "vitest.config.mts",
      "vitest.setup.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "vitest", message: TEST_ONLY }],
          patterns: [{ group: ["vitest/*", "@vitest/*", "**/store/contract", "./contract"], message: TEST_ONLY }],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated reports
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
