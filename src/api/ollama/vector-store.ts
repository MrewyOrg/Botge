// cspell:words hnsw metadatas

import { ChromaClient, type Collection, type GetResult } from 'chromadb';
import type { DeepReadonly } from 'ts-essentials';

import { DATABASE_DIR } from '../../config/directory-paths.ts';
import { ollamaConfig } from '../../config/ollama-config.ts';
import { embed } from './client.ts';
import { SequenceNumbers } from './sequence-numbers.ts';

type ReadonlyCollection = DeepReadonly<Collection>;

type StoreMessageParams = {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly channelId: string;
  readonly timestamp: number | Readonly<Date>;
  readonly seqNum?: number;
};
type Range = { readonly lo: number; hi: number };

const sequences = new SequenceNumbers(`${DATABASE_DIR}/seqNums.json`);
const pendingWrites = new Map<string, Promise<void>>();
const MAX_PENDING_WRITES = 100;
let pendingWriteCount = 0;
let collectionPromise: Promise<ReadonlyCollection> | undefined;

function sequenceFrom(
  metadata: Readonly<Record<string, unknown>> | null | undefined
): number | undefined {
  const value = metadata?.['seqNum'];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

async function loadCollection(): Promise<ReadonlyCollection> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');
  const url = new URL(ollamaConfig.chroma.url);
  const client = new ChromaClient({
    ssl: url.protocol === 'https:',
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  });
  // Preserve existing model-specific collection names and cosine distance configuration.
  const safe = ollamaConfig.embeddingModel
    .replace(/[^a-zA-Z0-9_-]/gu, (character) => '_'.repeat(character.length))
    .replace(/[_-]+$/u, '');
  const name = `messages_${safe}`.slice(0, 63).replace(/[_-]+$/u, '');
  return client.getOrCreateCollection({
    name,
    metadata: { 'hnsw:space': 'cosine' },
    // An explicit function also avoids loading a recorded default embedding model in legacy collections.
    embeddingFunction: {
      generate: async (texts: readonly string[]): Promise<number[][]> =>
        Promise.all(texts.map(async (text) => [...(await embed(text))]))
    }
  });
}

async function getCollection(): Promise<ReadonlyCollection> {
  collectionPromise ??= loadCollection().catch((error: unknown) => {
    collectionPromise = undefined;
    throw error;
  });
  return collectionPromise;
}

/** Recover the high-water mark if the sequence file is missing a previously indexed channel. */
async function recoverSequence(collection: ReadonlyCollection, channelId: string): Promise<void> {
  if (sequences.has(channelId)) return;
  let maximum = 0;
  let offset = 0;
  let more: boolean;
  do {
    const page = await collection.get({
      where: { channelId },
      include: ['metadatas'],
      limit: 1000,
      offset
    });
    for (const metadata of page.metadatas) maximum = Math.max(maximum, sequenceFrom(metadata) ?? 0);
    offset += page.ids.length;
    more = page.ids.length === 1000;
  } while (more);
  sequences.reserve(channelId, maximum);
}

/** Serialize writes per channel, preserving arrival order and existing sequences on re-indexing. */
export async function storeMessage(params: StoreMessageParams): Promise<void> {
  const timestamp =
    typeof params.timestamp === 'number' ? params.timestamp : params.timestamp.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Invalid message timestamp.');
  if (pendingWriteCount >= MAX_PENDING_WRITES) throw new Error('Vector-store write queue is full.');
  pendingWriteCount++;
  const { id, author, content, channelId, seqNum } = params;
  const pending = (pendingWrites.get(channelId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const collection = await getCollection();
      await recoverSequence(collection, channelId);
      const existing = await collection.get({ ids: [id], include: ['metadatas'] });
      const [metadata] = existing.metadatas;
      const existingSequence =
        metadata?.['channelId'] === channelId ? sequenceFrom(metadata) : undefined;
      const sequence = sequences.reserve(channelId, seqNum ?? existingSequence);
      const text = `${author}: ${content}`;
      const vector = await embed(text);
      await collection.upsert({
        ids: [id],
        embeddings: [[...vector]],
        documents: [text],
        metadatas: [{ author, channelId, seqNum: sequence, timestamp }]
      });
    });
  pendingWrites.set(channelId, pending);
  try {
    await pending;
  } finally {
    pendingWriteCount--;
    if (pendingWrites.get(channelId) === pending) pendingWrites.delete(channelId);
  }
}

/** Merge nearby search hits into chronological, channel-scoped conversation windows. */
export async function findSimilarWithContext(
  queryText: string,
  channelId: string,
  nResults = 5,
  windowSize = 2
): Promise<readonly string[]> {
  if (
    !Number.isSafeInteger(nResults)
    || nResults < 0
    || !Number.isSafeInteger(windowSize)
    || windowSize < 0
  )
    throw new Error('Context result count and window size must be nonnegative integers.');
  if (nResults === 0) return [];
  const collection = await getCollection();
  const total = await collection.count();
  if (total === 0) return [];
  const vector = await embed(queryText);
  const hits = await collection.query({
    queryEmbeddings: [[...vector]],
    nResults: Math.min(nResults, total),
    where: { channelId }
  });
  const ranges: Range[] = [];
  for (const metadata of hits.metadatas[0] ?? []) {
    const sequence = sequenceFrom(metadata);
    if (sequence !== undefined)
      ranges.push({ lo: Math.max(0, sequence - windowSize), hi: sequence + windowSize });
  }
  ranges.sort((a: Readonly<Range>, b: Readonly<Range>) => a.lo - b.lo);
  const merged: Range[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.lo <= previous.hi + 1)
      previous.hi = Math.max(previous.hi, range.hi);
    else merged.push({ ...range });
  }
  const results = await Promise.all(
    merged.map(async ({ lo, hi }: Readonly<Range>) =>
      collection.get({
        where: {
          $and: [
            { channelId: { $eq: channelId } },
            { seqNum: { $gte: lo } },
            { seqNum: { $lte: hi } }
          ]
        },
        include: ['documents', 'metadatas']
      })
    )
  );
  return results
    .map((result: DeepReadonly<GetResult>) => {
      const messages: { readonly text: string; readonly sequence: number }[] = [];
      for (const [index, text] of result.documents.entries()) {
        const sequence = sequenceFrom(result.metadatas[index]);
        if (text !== null && text !== '' && sequence !== undefined)
          messages.push({ text, sequence });
      }
      messages.sort((a, b) => a.sequence - b.sequence);
      return messages.map((message) => message.text).join('\n');
    })
    .filter((block) => block !== '');
}
