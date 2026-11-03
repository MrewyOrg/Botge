/** @format */

import type { OmitPartialGroupDMChannel, Message } from 'discord.js';

import { storeMessage, findSimilarWithContext } from '../../api/vector-store.ts';
import { scoreReplyOpportunity, generateReply } from '../../api/ollama.ts';
import { logError } from '../../utils/public/log-error.ts';
import { ollamaConfig } from '../../api/config/ollama-config.ts';

type BufferEntry = {
  readonly author: string;
  readonly content: string;
  readonly timestamp: string;
};

// Map of channelId → array of message objects
const buffers = new Map<string, BufferEntry[]>();
const lastReplyTime = new Map<string, number>();

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

  buffer.push({ author: authorName, content, timestamp: new Date().toISOString() });

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

  // console.log('got message: ' + channelId + ' ' + content);

  // 1. Add to in-memory rolling buffer (fast, synchronous)
  addMessage(channelId, authorName, content);

  // 2. Persist to vector store in the background (async, non-blocking)
  //    This ensures all messages are indexed even when the bot doesn't reply
  void persistToVectorStore(message, authorName);

  // 3. Need a few messages of context before chiming in
  if (getBufferSize(channelId) < 3) return;

  // 4. Check per-channel cooldown / direct mention
  const direct_mention = content.includes(`<@${clientUserId}>`);
  if (!direct_mention && isOnCooldown(channelId)) return;
  setLastReplyTime(channelId);

  // 5. Random gate — skip most messages to avoid being annoying
  if (!direct_mention && Math.random() > ollamaConfig.behavior.evaluationChance) return;

  // 6. Score the opportunity using the recent buffer
  const recentHistory = getFormattedHistory(channelId);
  const channelName = 'name' in message.channel ? message.channel.name : channelId;
  // skip scoring for direct mention
  let shouldReply: boolean = direct_mention;
  if (!direct_mention) {
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
  // if (retrievedContext.length > 0) {
  console.log(`🔍 Retrieved ${retrievedContext.length} relevant past messages`);
  // }

  // 8. Generate reply and show typing indicator concurrently.
  //    sendTyping() expires after 10s, so we pulse it every 8s until the
  //    model finishes. This way the user sees "Alex is typing..." the whole
  //    time without any extra wait after the reply is ready.
  let typingTimer: ReturnType<typeof setInterval> | undefined = undefined;

  async function startTyping(): Promise<void> {
    try {
      await message.channel.sendTyping();
      typingTimer = setInterval(async () => {
        try {
          await message.channel.sendTyping();
        } catch {
          /* ignore */
        }
      }, 8000);
    } catch {
      // Missing Send Typing permission — not fatal
    }
  }

  function stopTyping(): void {
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
    await message.reply(reply);
    // console.log('OLLAMA: ' + reply);

    // Add own reply to the in-memory buffer
    addMessage(channelId, ollamaConfig.botName, reply);

    // And index own reply in the vector store
    void storeMessage({
      id: `bot_${Date.now()}`,
      author: ollamaConfig.botName,
      content: reply,
      channelId,
      timestamp: new Date()
    });

    console.log(`✅ Sent: "${reply}"`);
  } catch (error) {
    logError(error, 'Failed to send');
  }
}
