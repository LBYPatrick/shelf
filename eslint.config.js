import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules', 'release', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/{main,preload,utility,drivers}/**/*.ts', '*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Build configuration runs in CommonJS under Node, not as an ES module.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.commonjs },
    },
    /*
     * `require` is how a CommonJS file imports, and these are CommonJS because
     * the packager and Electron's own CLI load them that way. The rule is right
     * everywhere else and simply does not apply here — it was failing the
     * format gate on two files that cannot be written any other way.
     */
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      /*
       * Nothing is registered globally, so a component the template names but
       * the script never imported renders as *nothing at all* — no warning, no
       * error, no element. That is how the Export sheet shipped unopenable.
       */
      'vue/no-undef-components': 'error',
    },
  }
);
