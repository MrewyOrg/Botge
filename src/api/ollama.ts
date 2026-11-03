/** @format */

import { ollamaConfig } from './config/ollama-config.ts';

type OllamaChatResponse = { readonly message?: { readonly content?: string } };

type ScoreReplyOpportunityResult = {
  readonly score: number;
  readonly shouldReply: boolean;
  readonly reason: string;
};

type ScoreReplyOpportunityResponse = {
  readonly score?: number;
  readonly should_reply?: boolean;
  readonly reason?: string;
};

/**
 * Send a chat request to the local Ollama instance.
 */
async function ollamaChat(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const { baseUrl, model, options } = ollamaConfig;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!response.ok)
    throw new Error(`Ollama API error ${response.status}: ${await response.text()}`);

  const data = (await response.json()) as OllamaChatResponse;

  console.log(
    'systemPrompt: '
      + systemPrompt
      + '\nuserPrompt: '
      + userPrompt
      + '\nResponse'
      + (data.message?.content?.trim() ?? '')
  );
  return data.message?.content?.trim() ?? '';
}

/**
 * Ask the model to score whether a reply opportunity exists.
 * Returns an object with shouldReply, reason, and score fields.
 */
export async function scoreReplyOpportunity(
  chatHistory: string
): Promise<ScoreReplyOpportunityResult> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const { botName } = ollamaConfig;
  const systemPrompt = ollamaConfig.systemPrompts.scoreReplyOpportunity;
  const userPrompt = `Recent chat:\n${chatHistory}\n\nShould ${botName} reply? Respond with JSON only.`;
  const raw = await ollamaChat(systemPrompt, userPrompt);

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean) as ScoreReplyOpportunityResponse;

    return {
      score: parsed.score ?? 0,
      shouldReply: parsed.should_reply === true,
      // shouldReply: (parsed.score ?? 0) >= 7,
      reason: parsed.reason ?? ''
    };
  } catch {
    console.warn('⚠️  Failed to parse scoring JSON:', raw);

    return { score: 0, shouldReply: false, reason: 'parse error' };
  }
}

/**
 * Generate a reply given recent chat history and optionally retrieved past messages.
 *
 * @param recentHistory - Last N messages formatted as "Author: message"
 * @param retrievedContext - Semantically similar past messages from vector store
 */
export async function generateReply(
  recentHistory: string,
  retrievedContext: readonly string[] = []
): Promise<string> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const { botName } = ollamaConfig;
  const systemPrompt = ollamaConfig.systemPrompts.generateReply;
  // Each element of retrievedContext is a multi-line block of consecutive
  // messages. Separate blocks with a divider so the model understands they
  // are distinct conversation snippets, not one continuous thread.
  const ragSection =
    retrievedContext.length > 0 ?
      `[Relevant past conversations — use for context only, do not reference directly]\n${retrievedContext.join('\n---\n')}\n\n`
    : '';
  const userPrompt = `${ragSection}[Recent chat]\n${recentHistory}\n\nWrite your reply as ${botName}. One short message only.`;

  return await ollamaChat(systemPrompt, userPrompt);
}
