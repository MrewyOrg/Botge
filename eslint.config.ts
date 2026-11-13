import js from '@eslint/js';
import tsdoc from 'eslint-plugin-tsdoc';
import { type Config, defineConfig, globalIgnores } from 'eslint/config';
import { configs } from 'typescript-eslint';

const globalConfig: readonly Readonly<Config>[] = defineConfig([
  {
    name: 'globalLanguageOptions',
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
  },
  { name: 'globalLinterOptions', linterOptions: { noInlineConfig: true } },
  globalIgnores(['activity/dist/', 'target/', 'coverage/'], 'globalIgnores')
]);

const config: readonly Readonly<Config>[] = defineConfig([
  ...globalConfig,
  {
    name: 'ts',
    files: ['**/*.ts'],
    plugins: { tsdoc },
    languageOptions: { parserOptions: { projectService: true } },
    extends: [
      js.configs.recommended,
      configs.all,
      configs.stylisticTypeChecked,
      configs.strictTypeChecked
    ], // later entries take precedence over earlier ones

    rules: {
      '@typescript-eslint/adjacent-overload-signatures': 'error', // Conflicts with member-ordering for getters/setters.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/max-params': 'off', // Existing constructors and handlers take many arguments.
      '@typescript-eslint/naming-convention': 'off', // Preserve external API names and existing conventions.
      '@typescript-eslint/no-magic-numbers': 'off', // Extracting existing literals requires a broader cleanup.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/no-type-alias': 'off', // Deprecated; consistent-type-definitions enforces type aliases.
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', reportUsedIgnorePattern: true }
      ],
      '@typescript-eslint/prefer-readonly-parameter-types': 'warn',
      // Numbers in URLs, component IDs, and user-facing counts have unambiguous string forms.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/strict-void-return': 'off', // Collection callbacks may intentionally discard ordinary return values.

      // TypeScript-aware replacements above handle the disabled core rules below.
      'array-callback-return': 'error',
      'block-scoped-var': 'error',
      'eqeqeq': 'error',
      'guard-for-in': 'error',
      'new-cap': 'error',

      'no-alert': 'error',
      'no-array-constructor': 'off',
      'no-await-in-loop': 'off', // Pagination and message deletion require sequential requests.
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-constructor-return': 'error',
      'no-duplicate-imports': 'error',
      'no-eq-null': 'error',
      'no-empty': 'error',
      'no-empty-function': 'off',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-implicit-globals': 'error',
      'no-implied-eval': 'off',
      'no-inner-declarations': 'error',
      'no-invalid-this': 'off',
      'no-iterator': 'error',
      'no-lone-blocks': 'error',
      'no-loop-func': 'off',
      'no-magic-numbers': 'off',
      'no-multi-assign': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-octal-escape': 'error',
      'no-param-reassign': 'error',
      'no-promise-executor-return': 'error',
      'no-proto': 'error',
      'no-restricted-exports': 'error',
      'no-restricted-globals': 'error',
      'no-restricted-imports': 'off', // No import restrictions configured.
      'no-restricted-properties': 'error',
      'no-restricted-syntax': 'error',
      'no-return-assign': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-shadow': 'off',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'off',
      'no-unassigned-vars': 'warn',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-use-before-define': 'off',
      'no-unused-expressions': 'off',
      'no-useless-assignment': 'warn',
      'no-useless-call': 'error',
      'no-useless-constructor': 'off',
      'no-useless-rename': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'no-with': 'error',

      'prefer-const': 'error',
      'prefer-named-capture-group': 'error',
      'prefer-object-has-own': 'error',
      'prefer-promise-reject-errors': 'off',
      'prefer-regex-literals': 'error',
      'prefer-rest-params': 'error',
      'preserve-caught-error': 'error',

      'radix': 'error',
      'require-await': 'off',
      'require-atomic-updates': 'error',
      'require-unicode-regexp': 'error',
      'strict': ['error', 'never'],
      'symbol-description': 'error',
      'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],

      'tsdoc/syntax': 'error'
    }
  },
  {
    name: 'optional-integration-tests',
    files: ['tests/integration/**/*.ts'],
    // This suite type-checks separately after its dependencies are installed.
    extends: [configs.disableTypeChecked]
  }
]);

export default config;
