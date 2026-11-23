import type { Configuration } from 'lint-staged';

const configuration: Configuration = {
  '*.ts': ['prettier --write', 'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto'],
  '*.html': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto'
  ],
  '*.scss': ['prettier --write', 'stylelint --max-warnings 0'],
  '*.md': ['prettier --write', 'markdownlint-cli2'],
  // Format only the staged Rust files. rustfmt normally follows module declarations.
  '*.rs': ['rustfmt --config skip_children=true'],
  '*.go': 'gofmt -w',
  '*.py': ['.venv/bin/python -m ruff format', '.venv/bin/python -m ruff check'],
  // The iOS tools are pinned in ios/Tools; run `npm run setup:ios` once to link them.
  '*.swift': ['ios/Tools/bin/swiftformat', 'sh scripts/ios/lint-swift.sh'],
  '!(*.ts|*.html|*.scss|*.md|*.rs|*.go|*.py|*.swift|*.webp|*.png)': [
    'prettier --write --ignore-unknown'
  ]
};

export default configuration;
