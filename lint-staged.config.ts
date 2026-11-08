import type { Configuration } from 'lint-staged';

const configuration: Configuration = {
  '*.ts': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto',
    'cspell'
  ],
  '*.md': ['prettier --write', 'markdownlint-cli2', 'cspell'],
  '!(*.ts|*.md|*.webp|*.png)': ['prettier --write --ignore-unknown', 'cspell']
};

export default configuration;
