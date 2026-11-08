import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from 'src/config/load-config.ts';
import type { BotgeConfig } from 'src/types.ts';

/** Exercise enabling the commented Ollama example through the real config loader. */
export function loadEnabledExampleConfig(): BotgeConfig {
  const directory = mkdtempSync(join(tmpdir(), 'botge-example-'));
  try {
    const path = join(directory, 'botge.config.json');
    const example = readFileSync('botge.example.config.jsonc', 'utf8');
    writeFileSync(
      path,
      example.replace('/*', '').replace('*/', '').replace('"enabled": false', '"enabled": true')
    );
    return loadConfig(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
