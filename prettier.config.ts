import type { Config } from 'prettier';
import * as prettierPluginSh from 'prettier-plugin-sh';

const config: Readonly<Config> = {
  endOfLine: 'lf',
  experimentalOperatorPosition: 'start',
  experimentalTernaries: true,
  objectWrap: 'collapse',
  plugins: [prettierPluginSh],
  printWidth: 100,
  proseWrap: 'always',
  quoteProps: 'consistent',
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'none',
  useTabs: false
};

export default config;
