import type { Config } from 'prettier';
import * as prettierPluginNginx from 'prettier-plugin-nginx';
import * as prettierPluginSh from 'prettier-plugin-sh';
import prettierPluginToml from 'prettier-plugin-toml';

const config: Readonly<Config> = {
  endOfLine: 'lf',
  experimentalOperatorPosition: 'start',
  experimentalTernaries: true,
  htmlWhitespaceSensitivity: 'strict',
  objectWrap: 'collapse',
  plugins: [prettierPluginNginx, prettierPluginSh, prettierPluginToml],
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
