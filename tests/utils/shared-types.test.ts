import { expect, expectTypeOf, test } from 'vitest';

import { ffzToAsset } from 'src/emotes/emote-to-asset.ts';
import type { BotgeConfig, OllamaConfig, OllamaConfigJson } from 'src/types.ts';

test('stored Ollama prompts are lines, while runtime prompts are strings', () => {
  type EnabledConfig = Extract<BotgeConfig['ollama'], { readonly enabled: true }>;

  expectTypeOf<EnabledConfig>().toEqualTypeOf<OllamaConfigJson>();
  expectTypeOf<EnabledConfig['systemPrompts']['generateReply']>().toEqualTypeOf<
    readonly string[]
  >();
  expectTypeOf<OllamaConfig['systemPrompts']['generateReply']>().toEqualTypeOf<string>();
});

test('FFZ API numeric IDs become string IDs for internal matching', () => {
  const asset = ffzToAsset({
    id: 25927,
    name: 'CatBag',
    urls: { '2': 'https://cdn.frankerfacez.com/emoticon/25927/2' }
  });

  expect(asset.id).toBe('25927');
  expect(asset.platform).toBe('ffz');
});
