import js from '@eslint/js';

// Deliberately minimal: catches the class of mistake that's easy to introduce without anyone
// noticing until it's in production (an unused import left behind, a variable shadowing a
// business-logic name, a stray console.log where the structured logger should be used) — not a
// full style/formatting rulebook. See docs/AUDIT.md: this didn't exist before, and the log-
// redaction gap (High #4) is exactly the kind of thing a lint rule catches for free going forward.
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        __dirname: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error'] }],
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // CLI scripts (db:init, db:migrate-*) — console output is the actual UI here, not
    // something that should go through the structured request logger.
    files: ['sql/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    ignores: ['node_modules/**', 'uploads/**', 'payment-proofs/**', 'coverage/**'],
  },
];
