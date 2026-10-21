// ESLint for the migration CLI and its tests: typescript-eslint's type-checked recommended rules.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['coverage/**', 'fixtures/**']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['*.config.mjs'] }, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      // `const { a: _a, ...rest } = x` drops a field on purpose; an underscore marks it unused.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  { files: ['**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
]);
