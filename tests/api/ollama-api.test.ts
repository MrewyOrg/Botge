import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { embed } from 'src/api/ollama/client.ts';
import { generateReply, scoreReplyOpportunity } from 'src/api/ollama/ollama.ts';
import { requireValue } from 'src/utils/validation.ts';

const { config } = vi.hoisted(() => ({
  config: {
    enabled: true,
    baseUrl: 'http://ollama:11434/',
    model: 'chat',
    embeddingModel: 'embedding',
    botName: 'Botge',
    options: {},
    systemPrompts: { scoreReplyOpportunity: 'Score', generateReply: 'Reply' }
  }
}));
vi.mock('src/config/ollama-config.ts', () => ({ ollamaConfig: config }));
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  config.enabled = true;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('embedding requests use the current endpoint and preserve the configured model', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ embeddings: [[1, 2, 3]] }));
  expect(await embed('text')).toEqual([1, 2, 3]);
  expect(requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[0]).toBe(
    'http://ollama:11434/api/embed'
  );
  expect(
    JSON.parse(
      requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]?.body as string
    ) as unknown
  ).toEqual({ model: 'embedding', input: 'text' });
});

test.each([{ embeddings: [] }, { embeddings: [['invalid']] }, { embedding: [1, 2] }])(
  'invalid embedding responses are rejected: %j',
  async (body: unknown) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await expect(embed('text')).rejects.toThrow(/embedding/u);
  }
);

test('scoring asks for JSON output and validates the result', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      message: { content: '```json\n{"score":8,"should_reply":true,"reason":"Relevant"}\n```' }
    })
  );
  expect(await scoreReplyOpportunity('history')).toEqual({
    score: 8,
    shouldReply: true,
    reason: 'Relevant'
  });
  expect(
    JSON.parse(
      requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]?.body as string
    ) as unknown
  ).toMatchObject({ format: 'json', stream: false });
});

test.each([
  'null',
  '{"score":"9","should_reply":true}',
  '{"score":99,"should_reply":true}',
  'invalid'
])('invalid scoring output cannot trigger a reply: %s', async (content) => {
  vi.spyOn(console, 'warn').mockImplementation(vi.fn());
  fetchMock.mockResolvedValueOnce(Response.json({ message: { content } }));
  expect(await scoreReplyOpportunity('history')).toEqual({
    score: 0,
    shouldReply: false,
    reason: 'parse error'
  });
});

test('chat output is trimmed, includes retrieved context, and rejects missing messages', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ message: { content: ' reply ' } }));
  expect(await generateReply('recent', ['older'])).toBe('reply');
  const body = requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]
    ?.body as string;
  expect(JSON.parse(body) as unknown).not.toHaveProperty('format');
  expect(body).toContain('older');
  expect(body).toContain('recent');
  fetchMock.mockResolvedValueOnce(Response.json(null));
  await expect(generateReply('recent')).rejects.toThrow('Ollama returned no chat message.');
});

test('disabled Ollama never makes a request', async () => {
  config.enabled = false;
  await expect(embed('text')).rejects.toThrow('Ollama is not enabled.');
  expect(fetchMock).not.toHaveBeenCalled();
});
