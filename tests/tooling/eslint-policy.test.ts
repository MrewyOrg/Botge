import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

import config from '../../eslint.config.ts';

const eslint = new ESLint({ overrideConfig: [...config], overrideConfigFile: true });
const rule = '@typescript-eslint/prefer-readonly-parameter-types';

async function assertRule(code: string, ruleId: string, expected: number): Promise<void> {
  // Use an existing file in the root TypeScript project for type-aware linting.
  const [result] = await eslint.lintText(code, { filePath: 'eslint.config.ts' });
  assert.ok(result, 'Expected a lint result');
  assert.equal(result.fatalErrorCount, 0);
  assert.equal(
    result.messages.filter(
      (message: Readonly<{ ruleId: string | null }>) => message.ruleId === ruleId
    ).length,
    expected
  );
}

for (const { name, code, expected } of [
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
    name: 'deeply readonly snapshot',
    code: "import type { DeepReadonly } from 'ts-essentials'; export function check(values: DeepReadonly<{ items: number[] }>): number { return values.items.length; }",
    expected: 0
  },
  {
    name: 'nested mutable array',
    code: 'export function check(values: Readonly<{ items: number[] }>): number { return values.items.length; }',
    expected: 1
  }
]) {
  test(`readonly parameter policy: ${name}`, async () => {
    await assertRule(code, rule, expected);
  }, 15_000);
}

for (const { name, code, ruleId, expected } of [
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
    name: 'bitwise operations are rejected',
    ruleId: 'no-bitwise',
    code: 'export const masked = 3 & 1;',
    expected: 1
  }
]) {
  test(`ESLint policy: ${name}`, async () => {
    await assertRule(code, ruleId, expected);
  }, 15_000);
}

test('global language options keep typed linting scoped to TypeScript', async () => {
  const source: unknown = await eslint.calculateConfigForFile('eslint.config.ts');
  const javascript: unknown = await eslint.calculateConfigForFile('policy-check.js');
  expect(source).toMatchObject({
    languageOptions: { sourceType: 'module', parserOptions: { projectService: true } }
  });
  expect(source).not.toHaveProperty('languageOptions.parserOptions.ecmaFeatures.impliedStrict');
  expect(javascript).not.toHaveProperty('languageOptions.parserOptions.projectService');
  expect(javascript).not.toHaveProperty('languageOptions.parserOptions.ecmaFeatures.impliedStrict');
});
