// cspell:words metadatas hnsw

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { requireValue } from 'src/utils/validation.ts';

type StoredMessage = {
  readonly text: string;
  readonly metadata: Readonly<Record<string, string | number>>;
};
type Entry = readonly [string, StoredMessage];

type Upsert = {
  readonly ids: readonly string[];
  readonly documents: readonly string[];
  readonly metadatas: readonly Readonly<Record<string, string | number>>[];
};
const state = vi.hoisted(() => ({
  directory: '',
  getCollection: vi.fn<(options: unknown) => Promise<unknown>>(),
  get: vi.fn<(options: unknown) => Promise<unknown>>(),
  upsert: vi.fn<(options: unknown) => Promise<unknown>>(),
  query: vi.fn<(options: unknown) => Promise<unknown>>(),
  count: vi.fn<() => Promise<number>>()
}));
vi.mock('src/config/directory-paths.ts', () => ({
  get DATABASE_DIR(): string {
    return state.directory;
  }
}));
vi.mock('src/config/ollama-config.ts', () => ({
  ollamaConfig: {
    enabled: true,
    baseUrl: 'http://ollama:11434',
    embeddingModel: 'nomic-embed-text',
    chroma: { url: 'http://chroma:8000' }
  }
}));
vi.mock('chromadb', () => ({
  ChromaClient: class {
    readonly #load = state.getCollection;
    public async getOrCreateCollection(options: unknown): Promise<unknown> {
      return this.#load(options);
    }
  }
}));
const records = new Map<string, StoredMessage>();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  records.clear();
  state.directory = await mkdtemp(join(tmpdir(), 'botge-vectors-'));
  fetchMock.mockImplementation(async () => {
    await Promise.resolve();
    return Response.json({ embeddings: [[1, 2]] });
  });
  vi.stubGlobal('fetch', fetchMock);
  state.getCollection.mockResolvedValue({
    get: state.get,
    upsert: state.upsert,
    query: state.query,
    count: state.count
  });
  state.count.mockResolvedValue(10);
  state.get.mockImplementation(async (options: unknown) => {
    await Promise.resolve();
    const input = options as {
      readonly ids?: readonly string[];
      readonly where?: { readonly channelId?: string };
    };
    const selected =
      input.ids !== undefined ?
        [...records.entries()].filter(([id]: Entry) => input.ids?.includes(id) === true)
      : [...records.entries()].filter(
          ([, record]: Entry) => record.metadata['channelId'] === input.where?.channelId
        );
    return {
      ids: selected.map(([id]: Entry) => id),
      documents: selected.map(([, record]: Entry) => record.text),
      metadatas: selected.map(([, record]: Entry) => record.metadata)
    };
  });
  state.upsert.mockImplementation(async (options: unknown) => {
    await Promise.resolve();
    const value = options as Upsert;
    records.set(requireValue(value.ids[0], 'Expected indexed test value.'), {
      text: requireValue(value.documents[0], 'Expected indexed document.'),
      metadata: requireValue(value.metadatas[0], 'Expected indexed metadata.')
    });
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(state.directory, { recursive: true, force: true });
});

function message(id: string): {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly channelId: string;
  readonly timestamp: number;
} {
  return { id, author: 'Author', content: id, channelId: 'channel', timestamp: 1234 };
}

test('concurrent messages share one collection and repeated upserts preserve message sequence', async () => {
  const { storeMessage } = await import('src/api/ollama/vector-store.ts');
  await Promise.all([storeMessage(message('one')), storeMessage(message('two'))]);
  await storeMessage(message('one'));
  expect(state.getCollection).toHaveBeenCalledOnce();
  expect(
    requireValue(state.getCollection.mock.calls[0], 'Expected indexed test value.')[0]
  ).toMatchObject({ name: 'messages_nomic-embed-text', metadata: { 'hnsw:space': 'cosine' } });
  const options = requireValue(
    state.getCollection.mock.calls[0],
    'Expected indexed test value.'
  )[0] as {
    readonly embeddingFunction: {
      readonly generate: (texts: readonly string[]) => Promise<number[][]>;
    };
  };
  expect(await options.embeddingFunction.generate(['fallback'])).toEqual([[1, 2]]);
  expect(records.get('one')?.metadata['seqNum']).toBe(1);
  expect(records.get('two')?.metadata['seqNum']).toBe(2);
  expect(
    JSON.parse(await readFile(join(state.directory, 'seqNums.json'), 'utf8')) as unknown
  ).toEqual({ channel: 2 });
});

test('collection initialization and channel writes can retry after a failure', async () => {
  state.getCollection.mockRejectedValueOnce(new Error('Offline'));
  const { storeMessage } = await import('src/api/ollama/vector-store.ts');
  await expect(storeMessage(message('one'))).rejects.toThrow('Offline');
  await storeMessage(message('two'));
  expect(state.getCollection).toHaveBeenCalledTimes(2);
  expect(records.has('two')).toBe(true);
});

test('missing sequence state is recovered from stored records and explicit sequences advance the high-water mark', async () => {
  records.set('old', { text: 'old', metadata: { channelId: 'channel', seqNum: 9 } });
  const { storeMessage } = await import('src/api/ollama/vector-store.ts');
  await storeMessage(message('new'));
  expect(records.get('new')?.metadata['seqNum']).toBe(10);
  await storeMessage({ ...message('backfill'), seqNum: 50 });
  await storeMessage(message('next'));
  expect(records.get('next')?.metadata['seqNum']).toBe(51);
});

test('invalid sequence files are not silently overwritten and loading is lazy', async () => {
  const path = join(state.directory, 'seqNums.json');
  await writeFile(path, '{"channel":"bad"}');
  const { storeMessage } = await import('src/api/ollama/vector-store.ts');
  await expect(storeMessage(message('one'))).rejects.toThrow('Invalid message sequence file.');
  expect(await readFile(path, 'utf8')).toBe('{"channel":"bad"}');
  expect(state.upsert).not.toHaveBeenCalled();
  await writeFile(path, '{"channel":4}');
  await storeMessage(message('recovered'));
  expect(records.get('recovered')?.metadata['seqNum']).toBe(5);
});

test('context windows skip invalid metadata, merge adjacent hits, and return chronological text', async () => {
  state.query.mockResolvedValue({
    metadatas: [[{ seqNum: 4 }, { seqNum: 5 }, null, { seqNum: 'invalid' }]]
  });
  state.get.mockResolvedValueOnce({
    ids: ['later', 'earlier', 'null'],
    documents: ['later', 'earlier', null],
    metadatas: [{ seqNum: 6 }, { seqNum: 3 }, null]
  });
  const { findSimilarWithContext } = await import('src/api/ollama/vector-store.ts');
  expect(await findSimilarWithContext('query', 'channel')).toEqual(['earlier\nlater']);
  expect(state.get).toHaveBeenCalledOnce();
  expect(state.get).toHaveBeenCalledWith({
    where: {
      $and: [{ channelId: { $eq: 'channel' } }, { seqNum: { $gte: 2 } }, { seqNum: { $lte: 7 } }]
    },
    include: ['documents', 'metadatas']
  });
});

test('zero or invalid context parameters do not initialize external services', async () => {
  const { findSimilarWithContext } = await import('src/api/ollama/vector-store.ts');
  expect(await findSimilarWithContext('query', 'channel', 0)).toEqual([]);
  await expect(findSimilarWithContext('query', 'channel', 1, -1)).rejects.toThrow(
    'nonnegative integers'
  );
  expect(state.getCollection).not.toHaveBeenCalled();
});

test('a stalled vector service cannot retain an unbounded background-write backlog', async () => {
  const { storeMessage } = await import('src/api/ollama/vector-store.ts');
  const response = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(response.promise);
  const pending = Array.from({ length: 100 }, async (_, index) =>
    storeMessage({
      id: String(index),
      channelId: 'bounded',
      author: 'Author',
      content: 'message',
      timestamp: 0
    })
  );
  try {
    await expect(
      storeMessage({
        id: 'overflow',
        channelId: 'bounded',
        author: 'Author',
        content: 'message',
        timestamp: 0
      })
    ).rejects.toThrow('queue is full');
  } finally {
    response.resolve(Response.json({ embeddings: [[1, 2]] }));
    await Promise.all(pending);
  }
  await expect(
    storeMessage({
      id: 'after-drain',
      channelId: 'bounded',
      author: 'Author',
      content: 'message',
      timestamp: 0
    })
  ).resolves.toBeUndefined();
});
