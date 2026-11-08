import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';

import { logError } from 'src/utils/log-error.ts';
import { writeFileAtomically } from 'src/utils/write-file-atomically.ts';

test('atomic writes replace existing contents and clean temporary files after failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'botge-utils-'));
  try {
    const path = join(directory, 'nested', 'state.json');
    writeFileAtomically(path, 'old');
    writeFileAtomically(path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(join(directory, 'nested'))).toEqual(['state.json']);
    const blocked = join(directory, 'blocked');
    mkdirSync(blocked);
    expect(() => {
      writeFileAtomically(blocked, 'cannot replace directory');
    }).toThrow();
    expect(readdirSync(directory).sort()).toEqual(['blocked', 'nested']);
    expect(readdirSync(blocked)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('error logging preserves the original error and its cause on stderr', () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const error = new Error('outer', { cause: new Error('inner') });
    logError(error, 'Failed operation');
    expect(output).toHaveBeenCalledWith('Failed operation:', error);
    const rejection = { code: 'failed' };
    logError(rejection, 'Rejected');
    expect(output).toHaveBeenLastCalledWith('Rejected:', rejection);
  } finally {
    output.mockRestore();
  }
});
