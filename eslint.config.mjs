import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vite/**',
      // Python virtualenv and model weights ship vendored JS we don't own.
      'ai-service/.venv/**',
      'ai-service/models/**',
      '**/site-packages/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain JS config files run in Node.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The server runs on Node.
    files: ['server/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The client runs in the browser; React hooks rules apply.
    files: ['client/**/*.ts', 'client/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Match the project's tsconfig (noUnusedLocals is off) so lint stays a
    // signal for real mistakes instead of duplicating the compiler.
    // Plugins must be re-declared per config object in flat config.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      // These 6 hits are the async-data → local-editable-form-state hydration
      // pattern (Script/Storyboard/Settings editors, default workspace, palette
      // reset). React's own alternative is remounting via `key`, which changes
      // dirty-state semantics — deferred as debt; warn so it stays visible.
      'react-hooks/set-state-in-effect': 'warn',
    },
  }
);