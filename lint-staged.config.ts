import type { Configuration } from 'lint-staged';

const configuration: Configuration = {
  '*.ts': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto',
    'cspell'
  ],
  '*.html': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto',
    'cspell'
  ],
  '*.scss': ['prettier --write', 'stylelint --max-warnings 0', 'cspell'],
  '*.md': ['prettier --write', 'markdownlint-cli2', 'cspell'],
  // Format only the staged Rust files. rustfmt normally follows module declarations.
  '*.rs': ['rustfmt --config skip_children=true', 'cspell'],
  '*.py': ['.venv/bin/python -m ruff format', '.venv/bin/python -m ruff check', 'cspell'],
  '!(*.ts|*.html|*.scss|*.md|*.rs|*.py|*.webp|*.png)': [
    'prettier --write --ignore-unknown',
    'cspell'
  ]
};

export default configuration;
