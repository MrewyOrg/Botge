import { ollamaConfig } from '../../config/ollama-config.ts';
import { isArrayOf } from '../../utils/validation.ts';
import { requestJson } from '../http.ts';

export async function requestOllama(
  path: string,
  body: Readonly<Record<string, unknown>>
): Promise<unknown> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');
  return requestJson(`${ollamaConfig.baseUrl.replace(/\/+$/u, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function embed(text: string): Promise<readonly number[]> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');
  const data = await requestOllama('/api/embed', {
    model: ollamaConfig.embeddingModel,
    input: text
  });
  if (
    typeof data !== 'object'
    || data === null
    || !('embeddings' in data)
    || !Array.isArray(data.embeddings)
  )
    throw new Error('Ollama returned no embeddings.');
  const vector: unknown = data.embeddings[0];
  if (
    !isArrayOf(
      vector,
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    )
    || vector.length === 0
  )
    throw new Error('Ollama returned an invalid embedding vector.');
  return vector;
}
