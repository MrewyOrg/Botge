import { expect, test } from 'vitest';

import commitlint from '../../commitlint.config.ts';
import staged from '../../lint-staged.config.ts';
import formatting from '../../prettier.config.ts';
import styles from '../../stylelint.config.ts';

test('commit messages require a meaningful subject and an explicit scope', () => {
  expect(commitlint.rules).toMatchObject({
    'scope-empty': [2, 'never'],
    'subject-min-length': [2, 'always', 3],
    'header-max-length': [2, 'always', 100]
  });
});

test('commit checks skip only commits signed off or merged from Dependabot', () => {
  const [ignore] = commitlint.ignores ?? [];
  const body = `chore(deps): bump a pinned workflow\n\nUpdates it from ${'a'.repeat(40)} to ${'b'.repeat(40)}`;
  expect(ignore?.(`${body}\n\nSigned-off-by: dependabot[bot] <support@github.com>`)).toBe(true);
  expect(
    ignore?.(
      'chore(deps): bump the docker-images group across 2 directories with 5 updates (#294)\n\nBumps the docker-images group with 2 updates.'
    )
  ).toBe(true);
  expect(
    ignore?.(
      'chore(deps-dev): bump the npm-dependencies group across 1 directory with 5 updates (#292)\n\nBumps the npm-dependencies group with 5 updates.'
    )
  ).toBe(true);
  expect(ignore?.(`${body}\n\nSigned-off-by: Someone <someone@example.com>`)).toBe(false);
  expect(ignore?.(`${body} dependabot[bot]`)).toBe(false);
  expect(ignore?.('chore(deps): bump dependencies\n\nManual update.')).toBe(false);
});

test('staged Rust and Go format only the selected files', () => {
  expect(staged).toMatchObject({
    '*.rs': ['rustfmt --config skip_children=true'],
    '*.ts': expect.arrayContaining(['prettier --write']) as unknown,
    '*.go': 'gofmt -w',
    '!(*.ts|*.html|*.scss|*.md|*.sh|*.rs|*.go|*.py|*.swift|*.rego|*.qs|*.tex|*.lean|*.webp|*.png|*.pdf)':
      expect.arrayContaining(['prettier --write --ignore-unknown']) as unknown
  });
});

test('staged Shell, Rego, Q#, LaTeX, and Lean files run their dedicated checks', () => {
  expect(staged).toMatchObject({
    '*.sh': ['prettier --write', 'shellcheck'],
    '*.rego': 'regal lint',
    '*.tex': 'chktex -eall -n22 -n30 -q',
    '*.lean': '.venv/bin/python scripts/quantum/check_proofs.py --scan-lean'
  });
  expect(typeof staged).toBe('object');
  if (typeof staged !== 'function') {
    const qsharpTask = staged['*.qs'];
    expect(typeof qsharpTask).toBe('function');
    if (typeof qsharpTask === 'function') {
      expect(qsharpTask(['quantum/src/BotgeQuantum.qs'])).toBe(
        'node scripts/quantum/lint-qsharp.ts'
      );
    }
  }
});

test('staged Swift is formatted and linted with the pinned iOS tools', () => {
  expect(staged).toMatchObject({
    '*.swift': ['ios/Tools/bin/swiftformat', 'sh scripts/ios/lint-swift.sh']
  });
});

test('staged HTML and SCSS are linted after formatting', () => {
  expect(staged).toMatchObject({
    '*.html': [
      'prettier --write',
      'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto'
    ],
    '*.scss': ['prettier --write', 'stylelint --max-warnings 0']
  });
});

test('stylesheets ban IDs and require explained, scoped disables across the partials', () => {
  expect(styles).toMatchObject({
    extends: ['stylelint-config-standard-scss'],
    reportDescriptionlessDisables: true,
    reportInvalidScopeDisables: true,
    reportNeedlessDisables: true,
    reportUnscopedDisables: true,
    rules: { 'selector-max-id': 0, 'declaration-no-important': true }
  });
  // Tokens defined in one partial are known in the others.
  expect(styles.referenceFiles).toEqual([
    expect.objectContaining({ files: ['activity/src/**/*.scss'] }) as unknown
  ]);
});

test('formatting preserves the shared TypeScript and documentation conventions', () => {
  expect(formatting).toMatchObject({
    tabWidth: 2,
    singleQuote: true,
    semi: true,
    endOfLine: 'lf',
    proseWrap: 'always'
  });
});
