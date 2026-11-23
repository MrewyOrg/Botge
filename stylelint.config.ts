import scss from 'postcss-scss';
import type { Config } from 'stylelint';

/**
 * Stylelint settings for the Activity stylesheet. Prettier owns formatting; these rules add
 * correctness and consistency checks on top of the standard SCSS configuration.
 */
const config: Config = {
  extends: ['stylelint-config-standard-scss'],
  ignoreFiles: ['**/node_modules/**', 'activity/dist/**', 'coverage/**'],
  // The partials compile into one stylesheet, so custom properties and keyframes defined in any of
  // them are known in all of them.
  referenceFiles: [{ files: ['activity/src/**/*.scss'], customSyntax: scss }],
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  reportUnscopedDisables: true,
  rules: {
    'color-named': 'never',
    'declaration-no-important': true,
    'declaration-property-value-no-unknown': true,
    'font-weight-notation': 'numeric',
    'max-nesting-depth': 4,
    'no-unknown-animations': true,
    'no-unknown-custom-properties': true,
    'selector-max-compound-selectors': 5,
    // Classes and attributes style the page; IDs are only script and fragment hooks.
    'selector-max-id': 0,
    'selector-max-specificity': '0,4,1',

    'scss/at-mixin-no-risky-nesting-selector': true,
    'scss/at-use-no-unnamespaced': true,
    'scss/block-no-redundant-nesting': true,
    'scss/declaration-nested-properties': 'never',
    'scss/dimension-no-non-numeric-values': true,
    'scss/no-duplicate-mixins': true,
    'scss/no-global-function-names': true,
    'scss/property-no-unknown': true,
    'scss/selector-no-redundant-nesting-selector': true
  }
};

export default config;
