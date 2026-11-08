import { afterEach, expect, test, vi } from 'vitest';

import { loadConfig } from 'src/config/load-config.ts';

import { loadEnabledExampleConfig } from './example-config.ts';

afterEach(() => {
  vi.doUnmock('src/config/load-config.ts');
  vi.resetModules();
});

test.each([false, true])(
  'loaded config resolves Ollama prompts only when enabled: %s',
  async (enabled) => {
    vi.resetModules();
    const config = enabled ? loadEnabledExampleConfig() : loadConfig('botge.example.config.jsonc');
    vi.doMock('src/config/load-config.ts', () => ({ loadConfig: (): typeof config => config }));
    const { botgeConfig } = await import('src/config/botge-config.ts');
    const { ollamaConfig } = await import('src/config/ollama-config.ts');
    expect(botgeConfig).toBe(config);
    expect(ollamaConfig.enabled).toBe(enabled);
    if (ollamaConfig.enabled && config.ollama.enabled) {
      expect(ollamaConfig.systemPrompts.generateReply).toBe(
        config.ollama.systemPrompts.generateReply
          .join('\n')
          .replaceAll('{name}', config.ollama.botName)
      );
      expect(ollamaConfig.systemPrompts.scoreReplyOpportunity).not.toContain('{name}');
    }
  }
);
