import type { Message, OmitPartialGroupDMChannel } from 'discord.js';

import { generateReply, scoreReplyOpportunity } from '../../api/ollama/ollama.ts';
import { findSimilarWithContext, storeMessage } from '../../api/ollama/vector-store.ts';
import { ollamaConfig } from '../../config/ollama-config.ts';
import { logError } from '../../utils/log-error.ts';

type BufferEntry = { readonly author: string; readonly content: string };

// Map of channelId → array of message objects
const buffers = new Map<string, BufferEntry[]>();
const lastReplyTime = new Map<string, number>();
const activeReplies = new Set<string>();
const MAX_ACTIVE_REPLIES = 2;

async function persistToVectorStore(
  message: OmitPartialGroupDMChannel<Message>,
  author: string
): Promise<void> {
  try {
    await storeMessage({
      id: message.id,
      author,
      content: message.content,
      channelId: message.channel.id,
      timestamp: message.createdAt
    });
  } catch (error) {
    logError(error, 'Vector store write failed');
  }
}

async function retrieveContext(
  channelId: string,
  recentHistory: string
): Promise<readonly string[]> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  try {
    const { ragResults, ragWindowSize } = ollamaConfig.behavior;

    return await findSimilarWithContext(recentHistory, channelId, ragResults, ragWindowSize);
  } catch (error) {
    logError(error, 'Vector store query failed');
    return [];
  }
}

/**
 * Format a channel's chat history as a readable string for the prompt.
 */
function getFormattedHistory(channelId: string): string {
  const buffer = buffers.get(channelId) ?? [];

  return buffer.map((msg: BufferEntry) => `${msg.author}: ${msg.content}`).join('\n');
}

/**
 * Add a message to a channel's rolling buffer.
 */
function addMessage(channelId: string, authorName: string, content: string): void {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const buffer = buffers.get(channelId) ?? [];

  buffer.push({ author: authorName, content });

  const { contextWindow } = ollamaConfig.behavior;

  if (buffer.length > contextWindow) buffer.splice(0, buffer.length - contextWindow);
  buffers.set(channelId, buffer);
}

/**
 * How many messages are buffered for a channel.
 */
function getBufferSize(channelId: string): number {
  return buffers.get(channelId)?.length ?? 0;
}
function isOnCooldown(channelId: string): boolean {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  const last = lastReplyTime.get(channelId) ?? 0;
  return (Date.now() - last) / 1000 < ollamaConfig.behavior.cooldownSeconds;
}
function setLastReplyTime(channelId: string): void {
  lastReplyTime.set(channelId, Date.now());
}

export async function ollamaMessageCreateHandler(
  message: OmitPartialGroupDMChannel<Message>,
  clientUserId: string
): Promise<void> {
  if (!ollamaConfig.enabled) throw new Error('Ollama is not enabled.');

  if (!ollamaConfig.activeChatChannels.includes(message.channel.id)) return;

  const channelId = message.channel.id;
  const authorName = message.author.displayName;
  const content = message.content.trim();

  // 1. Add to in-memory rolling buffer (fast, synchronous)
  addMessage(channelId, authorName, content);

  // 2. Persist to vector store in the background (async, non-blocking)
  //    This ensures all messages are indexed even when the bot doesn't reply
  void persistToVectorStore(message, authorName);

  // 3. Need a few messages of context before chiming in
  if (getBufferSize(channelId) < 3) return;

  // Coalesce bursts before starting more model requests or typing timers.
  if (activeReplies.has(channelId) || activeReplies.size >= MAX_ACTIVE_REPLIES) return;

  // 4. Check per-channel cooldown / direct mention
  const directMention = content.includes(`<@${clientUserId}>`);
  if (!directMention && isOnCooldown(channelId)) return;
  setLastReplyTime(channelId);

  // 5. Random gate — skip most messages to avoid being annoying
  if (!directMention && Math.random() > ollamaConfig.behavior.evaluationChance) return;

  activeReplies.add(channelId);
  try {
    // 6. Score the opportunity using the recent buffer
    const recentHistory = getFormattedHistory(channelId);
    const channelName = 'name' in message.channel ? message.channel.name : channelId;
    // skip scoring for direct mention
    let shouldReply: boolean = directMention;
    if (!directMention) {
      shouldReply = await (async (): Promise<boolean> => {
        console.log(`🎲 Evaluating reply in #${channelName}...`);
        const scoring = await scoreReplyOpportunity(recentHistory).catch((err: unknown) => {
          console.error('❌ Scoring failed:', err instanceof Error ? err.message : String(err));
          return null;
        });
        if (scoring === null) return false;

        console.log(
          `📊 Score: ${scoring.score}/10 | Reply: ${scoring.shouldReply} | ${scoring.reason}`
        );

        if (!scoring.shouldReply) return false;
        return scoring.score >= ollamaConfig.behavior.replyScoreThreshold;
      })();
    }
    if (!shouldReply) return;

    // 7. Retrieve relevant past messages from vector store
    //    Use the recent chat as the semantic query to find topically relevant history
    const retrievedContext = await retrieveContext(channelId, recentHistory);
    console.log(`🔍 Retrieved ${retrievedContext.length} relevant past messages`);

    // 8. Generate reply and show typing indicator concurrently.
    //    sendTyping() expires after 10s, so we pulse it every 8s until the
    //    model finishes. This way the user sees "Botge is typing..." the whole
    //    time without any extra wait after the reply is ready.
    let typingTimer: ReturnType<typeof setInterval> | undefined = undefined;
    let typingStopped = false;
    let typingPending = false;

    async function startTyping(): Promise<void> {
      try {
        await message.channel.sendTyping();
        if (typingStopped) return;
        typingTimer = setInterval(() => {
          if (typingPending) return;
          typingPending = true;
          void message.channel
            .sendTyping()
            .catch(() => undefined)
            .finally(() => {
              typingPending = false;
            });
        }, 8000);
      } catch {
        // Missing Send Typing permission — not fatal
      }
    }

    function stopTyping(): void {
      typingStopped = true;
      clearInterval(typingTimer);
    }

    let reply: string | undefined;
    try {
      const [, generatedReply] = await Promise.all([
        startTyping(),
        generateReply(recentHistory, retrievedContext)
      ]);
      reply = generatedReply;
    } catch (error) {
      logError(error, 'Reply generation failed:');

      stopTyping();
      return;
    }

    stopTyping();
    if (!reply) return;

    // 9. Send the message and persist it too
    try {
      const sentContent = reply.slice(0, 2000);
      const sentMessage = await message.reply(sentContent);

      // Add own reply to the in-memory buffer
      addMessage(channelId, ollamaConfig.botName, sentContent);

      // And index own reply in the vector store
      void persistToVectorStore(sentMessage, ollamaConfig.botName);

      console.log(`✅ Sent: "${sentContent}"`);
    } catch (error) {
      logError(error, 'Failed to send');
    }
  } finally {
    activeReplies.delete(channelId);
  }
}
