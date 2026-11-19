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
  // The iOS tools are pinned in ios/Tools; run `npm run setup:ios` once to link them.
  '*.swift': ['ios/Tools/bin/swiftformat', 'sh scripts/lint-swift.sh', 'cspell'],
  '!(*.ts|*.html|*.scss|*.md|*.rs|*.py|*.swift|*.webp|*.png)': [
    'prettier --write --ignore-unknown',
    'cspell'
  ]
};

export default configuration;
