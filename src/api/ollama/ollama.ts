import { ollamaConfig } from '../../config/ollama-config.ts';
import { requestOllama } from './client.ts';

type ScoreReplyOpportunityResult = {
  readonly score: number;
  readonly shouldReply: boolean;
  readonly reason: string;
};

/**
 * Send a chat request to the local Ollama instance.
 */
async function ollamaChat(systemPrompt: string, userPrompt: string, json = false): Promise<string> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const { model, options } = ollamaConfig;
  const data = await requestOllama('/api/chat', {
    model,
    stream: false,
    options,
    ...(json ? { format: 'json' } : {}),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  });
  if (
    typeof data !== 'object'
    || data === null
    || !('message' in data)
    || typeof data.message !== 'object'
    || data.message === null
    || !('content' in data.message)
    || typeof data.message.content !== 'string'
  )
    throw new Error('Ollama returned no chat message.');

  return data.message.content.trim();
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
  const raw = await ollamaChat(systemPrompt, userPrompt, true);

  try {
    const clean = raw
      .replace(/^```(?:json)?\s*/u, '')
      .replace(/\s*```$/u, '')
      .trim();
    const parsed: unknown = JSON.parse(clean);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('score' in parsed)
      || typeof parsed.score !== 'number'
      || !Number.isFinite(parsed.score)
      || parsed.score < 0
      || parsed.score > 10
    )
      throw new Error('Invalid reply score.');
    return {
      score: parsed.score,
      shouldReply: 'should_reply' in parsed && parsed.should_reply === true,
      reason: 'reason' in parsed && typeof parsed.reason === 'string' ? parsed.reason : ''
    };
  } catch {
    console.warn('Failed to parse Ollama scoring response.');
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
