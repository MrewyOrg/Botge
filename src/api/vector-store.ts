/** @format */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ChromaClient, type Collection, type GetResult } from 'chromadb';

import { DATABASE_DIR } from '../directory-paths.ts';

import type { ReadonlyMetaData } from '../types.ts';

import { ollamaConfig } from './config/ollama-config.ts';

type StoreMessageParams = {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly channelId: string;
  readonly timestamp: number | Readonly<Date>;
  readonly seqNum?: number;
};

type OllamaEmbeddingsResponse = { readonly embedding?: readonly number[] };

type SeqNums = Record<string, number>;

const SEQ_FILE_PATH: 'data/seqNums.json' = `${DATABASE_DIR}/seqNums.json`;
const client = ((): ChromaClient | undefined => {
  if (!ollamaConfig.enabled) return undefined;

  const chromaUrl = new URL(ollamaConfig.chroma.url);
  return new ChromaClient({
    ssl: chromaUrl.protocol === 'https:',
    host: chromaUrl.hostname,
    port: Number(chromaUrl.port) || (chromaUrl.protocol === 'https:' ? 443 : 80)
  });
})();

/**
 * Generate a vector embedding for a piece of text using the local Ollama model.
 * Returns a float array representing the text's position in semantic space.
 */
async function embed(text: string): Promise<readonly number[]> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const { baseUrl, embeddingModel } = ollamaConfig;
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel, prompt: text })
  });
  if (!res.ok) throw new Error(`Ollama embeddings error ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as OllamaEmbeddingsResponse;
  if (!data.embedding) throw new Error('Ollama returned no embedding. Is the model pulled?');

  return data.embedding;
}

// ─── Collection naming ────────────────────────────────────────────────────────
//
// Each embedding model gets its own collection. This is critical because vectors
// from different models are incompatible — they live in different semantic spaces.
//
// Example:
//   nomic-embed-text       → messages_nomic-embed-text
//   mxbai-embed-large      → messages_mxbai-embed-large
//
// When you upgrade your embedding model, run: node backfill.js reset <channelId>
// This wipes the old collection and rebuilds it. The raw text is fetched from
// Discord history — nothing is lost.

function getCollectionName(): string {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  // ChromaDB rules: 3–63 chars, alphanumeric + hyphens/underscores,
  // must start and end with alphanumeric.
  const model = ollamaConfig.embeddingModel;
  const safe = model
    .replace(/[^a-zA-Z0-9_-]/g, '_') // sanitize special chars
    .replace(/[_-]+$/, ''); // strip trailing separators

  return `messages_${safe}`.slice(0, 63);
}

// Cached collection promise — avoids race conditions on concurrent first calls
async function getCollection(): Promise<Collection> {
  if (client === undefined) throw new Error('Ollama is not enabled.');

  let _collectionPromise: Promise<Collection> | null = null;
  _collectionPromise ??= client.getOrCreateCollection({
    name: getCollectionName(),
    metadata: { 'hnsw:space': 'cosine' } // cosine similarity for chat text
  });

  return _collectionPromise;
}

// ─── Per-channel sequence numbers ────────────────────────────────────────────
//
// Each message gets a monotonically increasing integer seqNum per channel.
// This is the key that makes contextual retrieval possible: once we find a
// relevant hit at seqNum N, we can fetch [N-k … N … N+k] to get surrounding
// messages, turning a single retrieved message into a full conversation snippet.
//
// Sequence numbers are persisted to disk so they survive restarts and stay
// consistent with what's already stored in ChromaDB.

function loadSeqNums(): SeqNums {
  if (!existsSync(SEQ_FILE_PATH)) return {};

  try {
    return JSON.parse(readFileSync(SEQ_FILE_PATH, 'utf8')) as SeqNums;
  } catch {
    return {};
  }
}

function saveSeqNums(seqNums: Readonly<SeqNums>): void {
  writeFileSync(SEQ_FILE_PATH, JSON.stringify(seqNums, null, 2));
}

// In-memory cache, synced to disk on every write
const seqNums = loadSeqNums();

function nextSeqNum(channelId: string): number {
  const next = (seqNums[channelId] ?? 0) + 1;
  seqNums[channelId] = next;
  saveSeqNums(seqNums);

  return next;
}

/**
 * Store a message. Uses upsert so re-indexing is safe and idempotent.
 * Assigns a per-channel sequence number used for contextual window expansion.
 */
export async function storeMessage(storeMessageParams: StoreMessageParams): Promise<void> {
  const { id, author, content, channelId, seqNum } = storeMessageParams;
  const timestamp_: number | Date = storeMessageParams.timestamp;

  const collection = await getCollection();
  const text = `${author}: ${content}`;
  const vector = await embed(text);
  const seq = seqNum ?? nextSeqNum(channelId);

  await collection.upsert({
    ids: [id],
    embeddings: [[...vector]],
    documents: [text],
    metadatas: [
      {
        author,
        channelId,
        seqNum: seq,
        timestamp: timestamp_ instanceof Date ? timestamp_.getTime() : timestamp_
      }
    ]
  });
}

/**
 * Find past messages semantically similar to the query, then expand each hit
 * into a window of surrounding messages so the model gets full conversational
 * context rather than orphaned one-liners.
 *
 * Example with windowSize=2 and a hit at seqNum 42:
 *   Returns messages at seqNums [40, 41, 42, 43, 44], formatted as a block.
 *
 * Overlapping windows are merged automatically so the same messages aren't
 * repeated if two hits are close together.
 */
export async function findSimilarWithContext(
  queryText: string,
  channelId: string,
  nResults = 5,
  windowSize = 2
): Promise<readonly string[]> {
  const collection = await getCollection();

  const total = await collection.count();
  if (total === 0) return [];

  // 1. Semantic search — find the most relevant individual messages
  const queryVector = await embed(queryText);
  const hits = await collection.query({
    queryEmbeddings: [[...queryVector]],
    nResults: Math.min(nResults, total),
    where: { channelId }
  });

  const [hitMetadatas] = hits.metadatas;
  if (hitMetadatas.length === 0) return [];

  // 2. Expand each hit into a [seqNum-windowSize … seqNum+windowSize] range.
  //    Merge overlapping ranges so nearby hits don't produce duplicate messages.
  const ranges = hitMetadatas
    .map((m: ReadonlyMetaData | null) => ({
      lo: (m?.['seqNum'] as number) - windowSize,
      hi: (m?.['seqNum'] as number) + windowSize
    }))
    .sort(
      (a: Readonly<{ lo: number; hi: number }>, b: Readonly<{ lo: number; hi: number }>) =>
        a.lo - b.lo
    );

  const merged: { lo: number; hi: number }[] = [];
  for (const range of ranges) {
    const prev = merged.at(-1);

    if (prev !== undefined && range.lo <= prev.hi + 1) {
      // Overlapping or adjacent — extend the previous range
      prev.hi = Math.max(prev.hi, range.hi);
    } else {
      merged.push({ ...range });
    }
  }

  // 3. Fetch each merged range from ChromaDB using seqNum bounds.
  //    Run all range fetches concurrently.
  const windowFetches = merged.map(async ({ lo, hi }: Readonly<{ lo: number; hi: number }>) =>
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
  );

  // 4. Each range becomes one context block: messages sorted by seqNum,
  //    formatted as "Author: message" lines joined with newlines.
  const windowResults = await Promise.all(windowFetches);
  const blocks = windowResults.map((result: Readonly<GetResult>) => {
    const pairs = result.documents
      .map((doc: string | null, i: number) => ({
        doc,
        seq: (result.metadatas[i]?.['seqNum'] as number | undefined) ?? 0
      }))
      .sort(
        (
          a: Readonly<{ doc: string | null; seq: number }>,
          b: Readonly<{ doc: string | null; seq: number }>
        ) => a.seq - b.seq
      );

    return pairs.map((p: Readonly<{ doc: string | null; seq: number }>) => p.doc).join('\n');
  });

  return blocks.filter(Boolean);
}
