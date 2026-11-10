import type { Configuration } from 'lint-staged';

const configuration: Configuration = {
  '*.ts': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto',
    'cspell'
  ],
  '*.md': ['prettier --write', 'markdownlint-cli2', 'cspell'],
  // Format only the staged Rust files. rustfmt normally follows module declarations.
  '*.rs': ['rustfmt --config skip_children=true', 'cspell'],
  '!(*.ts|*.md|*.rs|*.webp|*.png)': ['prettier --write --ignore-unknown', 'cspell']
};

export default configuration;
