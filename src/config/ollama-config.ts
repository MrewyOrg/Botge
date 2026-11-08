import type { OllamaConfig } from '../types.ts';
import { botgeConfig } from './botge-config.ts';

function loadOllamaConfig(): OllamaConfig | { readonly enabled: false } {
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
