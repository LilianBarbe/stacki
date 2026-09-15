// ESLint flat config — AGENTS.md rule set.
//
// Hand-rolled rather than via the typescript-eslint meta-package because the
// repo's pnpm tree carries @typescript-eslint/parser and eslint-plugin directly
// and adding the meta package means a fresh full-graph resolution the tree
// isn't ready for. Same rules, same shape.
//
// Two ratchets, both scheduled for removal by docs/ts-migration-plan.md Phase 3:
// 1. src/style-panel/** is the legacy zone: it fails the type-aware and
//    assertion rules (the same 44 files as the tsc @ts-nocheck list). Rules
//    land at error level everywhere else; the zone is held by conversion.
// 2. max-lines-per-function and prefer-readonly are warnings until the
//    oversized legacy functions are split.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'shared/dist/**',
      'test/.stacki-test/**',
      '**/generated/**',
      // tsc-emit artifacts (side-by-side with their .ts sources; keep in sync
      // with the files list in electron/tsconfig.json).
      'electron/htmlText.js',
      'electron/serialQueue.js',
      'electron/selfWrites.js',
      'electron/windowBounds.js',
      'electron/assetRefs.js',
      'electron/frontmatter.js',
      'electron/jsCollections.js',
      'electron/devProbe.js',
      'electron/injectedRoutes.js',
      'electron/projectWatcher.js',
      'electron/componentFile.js',
      'electron/gitSnapshot.js',
      'electron/starter.js',
      'electron/cmsRefs.js',
      'electron/componentUsage.js',
      'electron/previewWorktree.js',
      'electron/scaffold.js',
      'electron/contentRefs.js',
      'electron/formats/transplant.js',
      'electron/formats/ndjson.js',
      'electron/formats/csv.js',
      'electron/formats/yaml.js',
      'electron/formats/frontmatter.js',
    ],
  },
  {
    // Renderer JS/JSX is ESM with JSX. Electron main, scripts, and tests are
    // CommonJS (top-level return is legal in the CJS module wrapper).
    files: ['src/**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      curly: ['error', 'all'],
      'react-hooks/exhaustive-deps': 'warn',
      // Legacy JSX calls hooks conditionally (PropsPanel.jsx, VariablesView.jsx)
      // — real crash-on-flip bugs, fixed as part of those files' Phase 3
      // conversions. Error level stands for all TS.
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
  {
    files: ['electron/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
    rules: {
      curly: ['error', 'all'],
    },
  },
  {
    // morphClient runs as an ESM bundle in the preview frame, not as CJS main.
    files: ['electron/morphClient.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      curly: ['error', 'all'],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    rules: {
      ...tsPlugin.configs['eslint-recommended'].rules,
      ...tsPlugin.configs.recommended.rules,
      // AGENTS.md non-negotiables.
      // @ts-nocheck headers carry a description; require it rather than ban the directive.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': 'allow-with-description' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      curly: ['error', 'all'],
      // Hooks deps were the author's own suppressed warnings; keep them visible.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      // Type-aware safety. Error — the compiler-adjacent bug class.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Scale rules: legacy functions violate these at volume. Warn now, tighten on conversion.
      '@typescript-eslint/prefer-readonly': 'warn',
      'max-lines-per-function': ['warn', { max: 70, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // shared/ is the validated-constructor layer (AGENTS.md §2): assertions
    // are permitted here immediately after validation. Everywhere else the
    // rule stands at error.
    files: ['shared/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  {
    // Legacy zone — same 44 files as the tsc @ts-nocheck ratchet. These rules
    // land as errors the moment each file converts; the zone block then shrinks.
    files: ['src/style-panel/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
];
