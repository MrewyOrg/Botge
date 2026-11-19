import { expect, test } from 'vitest';

import commitlint from '../../commitlint.config.ts';
import spelling from '../../cspell.config.ts';
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

test('commit checks skip only commits signed off by Dependabot', () => {
  const [ignore] = commitlint.ignores ?? [];
  const body = `chore(deps): bump a pinned workflow\n\nUpdates it from ${'a'.repeat(40)} to ${'b'.repeat(40)}`;
  expect(ignore?.(`${body}\n\nSigned-off-by: dependabot[bot] <support@github.com>`)).toBe(true);
  expect(ignore?.(`${body}\n\nSigned-off-by: Someone <someone@example.com>`)).toBe(false);
  expect(ignore?.(`${body} dependabot[bot]`)).toBe(false);
});

test('staged Rust uses rustfmt without following unstaged child modules', () => {
  expect(staged).toMatchObject({
    '*.rs': ['rustfmt --config skip_children=true', 'cspell'],
    '*.ts': expect.arrayContaining(['prettier --write']) as unknown,
    '!(*.ts|*.html|*.scss|*.md|*.rs|*.py|*.swift|*.webp|*.png)': expect.arrayContaining([
      'prettier --write --ignore-unknown'
    ]) as unknown
  });
});

test('staged Swift is formatted and linted with the pinned iOS tools', () => {
  expect(staged).toMatchObject({
    '*.swift': ['ios/Tools/bin/swiftformat', 'sh scripts/lint-swift.sh', 'cspell']
  });
});

test('staged HTML and SCSS are linted after formatting', () => {
  expect(staged).toMatchObject({
    '*.html': [
      'prettier --write',
      'eslint --flag unstable_native_nodejs_ts_config --concurrency=auto',
      'cspell'
    ],
    '*.scss': ['prettier --write', 'stylelint --max-warnings 0', 'cspell']
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

test('spelling ignores Git objects while keeping commit messages checkable', () => {
  expect(spelling.useGitignore).toBe(true);
  expect(spelling.ignorePaths).toContain('.git/objects');
  expect(spelling.ignorePaths).not.toContain('.git');
  expect(spelling.ignorePaths).not.toContain('.git/COMMIT_EDITMSG');
});
