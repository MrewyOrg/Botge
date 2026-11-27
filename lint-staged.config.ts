import type { Configuration } from 'lint-staged';

const configuration: Configuration = {
  '*.ts': ['prettier --write', 'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto'],
  '*.html': [
    'prettier --write',
    'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto'
  ],
  '*.scss': ['prettier --write', 'stylelint --max-warnings 0'],
  '*.md': ['prettier --write', 'markdownlint-cli2'],
  '*.sh': ['prettier --write', 'shellcheck'],
  // Format only the staged Rust files. rustfmt normally follows module declarations.
  '*.rs': ['rustfmt --config skip_children=true'],
  '*.go': 'gofmt -w',
  '*.py': ['.venv/bin/python -m ruff format', '.venv/bin/python -m ruff check'],
  // The iOS tools are pinned in ios/Tools; run `npm run setup:ios` once to link them.
  '*.swift': ['ios/Tools/bin/swiftformat', 'sh scripts/ios/lint-swift.sh'],
  '*.rego': 'regal lint',
  // lint-qsharp.ts takes the project directory, not individual `.qs` file paths.
  '*.qs': (): string => 'node scripts/quantum/lint-qsharp.ts',
  // chktex reads ./.chktexrc from the repository root on its own.
  '*.tex': 'chktex -eall -n22 -n30 -q',
  '*.lean': '.venv/bin/python scripts/quantum/check_proofs.py --scan-lean',
  '!(*.ts|*.html|*.scss|*.md|*.sh|*.rs|*.go|*.py|*.swift|*.rego|*.qs|*.tex|*.lean|*.webp|*.png|*.pdf)':
    ['prettier --write --ignore-unknown']
};

export default configuration;
