/** @format */

import { existsSync, readFileSync } from 'node:fs';

import type { OllamaConfig } from '../../types.ts';

// Shape of botge.config.json: everything except secrets, with system prompts
// stored as arrays of lines where "{name}" is replaced by the bot name.
type OllamaConfigJson = Omit<OllamaConfig, 'systemPrompts'> & {
  readonly systemPrompts: {
    readonly scoreReplyOpportunity: readonly string[];
    readonly generateReply: readonly string[];
  };
};
type BotgeConfigJson = { readonly ollama: { readonly enabled: false } | OllamaConfigJson };

function loadOllamaConfig(): OllamaConfig | { readonly enabled: false } {
  const BOTGE_CONFIG_PATH = 'botge.config.json' as const;
  if (!existsSync(BOTGE_CONFIG_PATH)) throw new Error(`No ${BOTGE_CONFIG_PATH} found.`);

  const botgeConfig = JSON.parse(readFileSync(BOTGE_CONFIG_PATH, 'utf8')) as BotgeConfigJson;

  const ollamaConfig = botgeConfig.ollama;

  if (!ollamaConfig.enabled) return { enabled: false };

  const prompt = (lines: readonly string[]): string =>
    lines.join('\n').replaceAll('{name}', ollamaConfig.botName);

  return {
    ...ollamaConfig,
    systemPrompts: {
      scoreReplyOpportunity: prompt(ollamaConfig.systemPrompts.scoreReplyOpportunity),
      generateReply: prompt(ollamaConfig.systemPrompts.generateReply)
    }
  };
}

export const ollamaConfig: OllamaConfig | { readonly enabled: false } = loadOllamaConfig();
