// ESLint flat config — AGENTS.md rule set.
//
// Hand-rolled rather than via the typescript-eslint meta-package because the
// repo's pnpm tree carries @typescript-eslint/parser and eslint-plugin directly
// and adding the meta package means a fresh full-graph resolution the tree
// isn't ready for. Same rules, same shape.
//
// max-lines-per-function and prefer-readonly remain warnings until the
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
      'test/.stacki-test/**',
      '**/generated/**',
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
      // The migration ratchet is zero, so unchecked files cannot re-enter the tree.
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': true }],
      '@typescript-eslint/no-explicit-any': 'error',
      // `as const` is the canonical way to keep literal unions (§5). Reject all
      // other assertion syntax while allowing that one language construct.
      '@typescript-eslint/consistent-type-assertions': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
          message: 'Type assertions must be replaced with validation and narrowing.',
        },
        {
          selector: 'TSTypeAssertion',
          message: 'Type assertions must be replaced with validation and narrowing.',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
      'no-restricted-syntax': 'off',
    },
  },
  {
    // These adapters validate values from PostCSS, DOM storage, and the host
    // bridge before constructing trusted application values. AGENTS.md §2
    // permits assertions inside validated constructors and type guards.
    files: [
      'src/style-panel/lib/css.ts',
      'src/style-panel/lib/host.ts',
      'src/style-panel/lib/webflow.ts',
      'src/style-panel/shared/dom-safety.ts',
      'src/style-panel/shared/tool-prefs.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // These entrypoints compile to CommonJS because Electron Builder loads its
    // afterPack hook with require. Import assignments also keep direct Node
    // execution in CommonJS so __dirname and require.main have one meaning.
    files: ['scripts/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
