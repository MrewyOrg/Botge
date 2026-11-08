import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

import { requireValue } from 'src/utils/validation.ts';

const eslint = new ESLint({ flags: ['unstable_native_nodejs_ts_config'] });
const rule = '@typescript-eslint/prefer-readonly-parameter-types';

test.each([
  {
    name: 'ordinary mutable array',
    code: 'export function check(values: number[]): void { values.push(1); }',
    expected: 1
  },
  {
    name: 'readonly array',
    code: 'export function check(values: readonly number[]): number { return values.length; }',
    expected: 0
  },
  {
    name: 'explicit mutable array',
    code: "import type { MutableArray } from '../types.ts'; export function check(values: MutableArray<number>): void { values.push(1); }",
    expected: 0
  },
  {
    name: 'nested mutable array',
    code: 'export function check(values: Readonly<{ items: number[] }>): number { return values.items.length; }',
    expected: 1
  },
  {
    name: 'unrelated type with the same name',
    code: 'type MutableArray<T> = T[]; export function check(values: MutableArray<number>): void { values.push(1); }',
    expected: 1
  }
])(
  'readonly parameter policy: $name',
  async ({ code, expected }: Readonly<{ code: string; expected: number }>) => {
    // Use a file in the source project so the parser can supply type information.
    // lintText changes only the parser's in-memory document.
    const result = requireValue(
      (await eslint.lintText(code, { filePath: 'src/utils/log-error.ts' }))[0],
      'Expected result fixture.'
    );
    expect(result.fatalErrorCount).toBe(0);
    expect(
      result.messages.filter(
        (message: Readonly<{ ruleId: string | null }>) => message.ruleId === rule
      )
    ).toHaveLength(expected);
  },
  15_000
);

test('explicit mutable arrays are recognized from the separate test project', async () => {
  const result = requireValue(
    (
      await eslint.lintText(
        "import type { MutableArray } from 'src/types.ts'; export function check(values: MutableArray<number>): void { values.push(1); }",
        { filePath: 'tests/utils/shared-types.test.ts' }
      )
    )[0],
    'Expected result fixture.'
  );
  expect(result.fatalErrorCount).toBe(0);
  expect(
    result.messages.filter(
      (message: Readonly<{ ruleId: string | null }>) => message.ruleId === rule
    )
  ).toEqual([]);
}, 15_000);

test.each([
  {
    name: 'async callbacks cannot be passed to a void callback argument',
    ruleId: '@typescript-eslint/no-misused-promises',
    code: 'function run(callback: () => void): void { callback(); } run(async () => { await Promise.resolve(); });',
    expected: 1
  },
  {
    name: 'unused guild parameters have no special exemption',
    ruleId: '@typescript-eslint/no-unused-vars',
    code: 'export function check(guild: string): void {}',
    expected: 1
  },
  {
    name: 'positional placeholders must be explicitly marked',
    ruleId: '@typescript-eslint/no-unused-vars',
    code: 'export function check(_placeholder: string, value: string): string { return value; }',
    expected: 0
  },
  {
    name: 'used parameters cannot hide behind a placeholder name',
    ruleId: '@typescript-eslint/no-unused-vars',
    code: 'export function check(_value: string): string { return _value; }',
    expected: 1
  },
  {
    name: 'numeric template interpolation is allowed',
    ruleId: '@typescript-eslint/restrict-template-expressions',
    code: `export function check(value: number): string { return \`count: \${value}\`; }`,
    expected: 0
  },
  {
    name: 'object interpolation is rejected',
    ruleId: '@typescript-eslint/restrict-template-expressions',
    code: `export function check(value: Readonly<{ id: string }>): string { return \`value: \${value}\`; }`,
    expected: 1
  },
  {
    name: 'unsafe narrowing is rejected in source',
    ruleId: '@typescript-eslint/no-unsafe-type-assertion',
    code: 'export function check(value: unknown): string { return value as string; }',
    expected: 1
  },
  {
    name: 'runtime narrowing is accepted',
    ruleId: '@typescript-eslint/no-unsafe-type-assertion',
    code: "export function check(value: unknown): string { if (typeof value === 'string') return value; throw new Error('Expected string'); }",
    expected: 0
  },
  {
    name: 'bitwise operations outside the provider decoder are rejected',
    ruleId: 'no-bitwise',
    code: 'export const masked = 3 & 1;',
    expected: 1
  }
])(
  'ESLint policy: $name',
  async ({
    code,
    ruleId,
    expected
  }: Readonly<{ code: string; ruleId: string; expected: number }>) => {
    const result = requireValue(
      (await eslint.lintText(code, { filePath: 'src/utils/log-error.ts' }))[0],
      'Expected result fixture.'
    );
    expect(result.fatalErrorCount).toBe(0);
    expect(
      result.messages.filter(
        (message: Readonly<{ ruleId: string | null }>) => message.ruleId === ruleId
      )
    ).toHaveLength(expected);
  },
  15_000
);

test('the provider decoder only permits the bitwise AND operation', async () => {
  const result = requireValue(
    (
      await eslint.lintText('export const masked = 3 & 1; export const combined = 3 | 1;', {
        filePath: 'src/emotes/emote-to-asset.ts'
      })
    )[0],
    'Expected result fixture.'
  );
  expect(result.fatalErrorCount).toBe(0);
  expect(
    result.messages.filter(
      (message: Readonly<{ ruleId: string | null }>) => message.ruleId === 'no-bitwise'
    )
  ).toHaveLength(1);
}, 15_000);

test('global language options keep typed linting scoped to TypeScript', async () => {
  const source: unknown = await eslint.calculateConfigForFile('src/utils/log-error.ts');
  const javascript: unknown = await eslint.calculateConfigForFile('policy-check.js');
  expect(source).toMatchObject({
    languageOptions: { sourceType: 'module', parserOptions: { projectService: true } }
  });
  expect(javascript).not.toHaveProperty('languageOptions.parserOptions.projectService');
  expect(source).not.toHaveProperty('languageOptions.parserOptions.ecmaFeatures.impliedStrict');
});
