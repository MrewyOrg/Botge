import { expect, test } from 'vitest';

import commitlint from '../../commitlint.config.ts';
import spelling from '../../cspell.config.ts';
import staged from '../../lint-staged.config.ts';
import formatting from '../../prettier.config.ts';

test('commit messages require a meaningful subject and an explicit scope', () => {
  expect(commitlint.rules).toMatchObject({
    'scope-empty': [2, 'never'],
    'subject-min-length': [2, 'always', 3],
    'header-max-length': [2, 'always', 100]
  });
});

test('staged Rust uses rustfmt without following unstaged child modules', () => {
  expect(staged).toMatchObject({
    '*.rs': ['rustfmt --config skip_children=true', 'cspell'],
    '*.ts': expect.arrayContaining(['prettier --write']) as unknown,
    '!(*.ts|*.md|*.rs|*.webp|*.png)': expect.arrayContaining([
      'prettier --write --ignore-unknown'
    ]) as unknown
  });
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
