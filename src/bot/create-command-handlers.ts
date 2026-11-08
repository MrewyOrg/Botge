import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Job } from 'node-schedule';

import { SLASH_COMMAND_NAMES } from '../discord/command-names.ts';
import type { Guild } from '../discord/guild.ts';
import { addEmoteHandler } from '../handlers/commands/add-emote.ts';
import { chatGptHandler } from '../handlers/commands/chat-gpt.ts';
import { clearHandler } from '../handlers/commands/clear.ts';
import { clipHandler } from '../handlers/commands/clip.ts';
import { emoteListHandler } from '../handlers/commands/emote.ts';
import { findTheEmojiHandler } from '../handlers/commands/find-the-emoji.ts';
import { mediaListHandler } from '../handlers/commands/media-list.ts';
import { mediaHandler } from '../handlers/commands/media.ts';
import { pingListHandler } from '../handlers/commands/ping-list.ts';
import { pingMeHandler } from '../handlers/commands/ping-me.ts';
import { quoteListHandler } from '../handlers/commands/quote-list.ts';
import { quoteHandler } from '../handlers/commands/quote.ts';
import { shortestUniqueSubstringsHandler } from '../handlers/commands/shortest-unique-substrings.ts';
import { steamHandler } from '../handlers/commands/steam.ts';
import { transientHandler } from '../handlers/commands/transient.ts';
import { translateHandler } from '../handlers/commands/translate.ts';
import type { MutableArray } from '../types.ts';
import type { ApiManager } from './api-manager.ts';
import type { DatabaseManager } from './database-manager.ts';
import type { MessageBuilderManager } from './message-builder-manager.ts';

export type CommandHandler = (
  interaction: ChatInputCommandInteraction,
  guild: Readonly<Guild>
) => Promise<void>;

export function createCommandHandlers(
  scheduledJobs: MutableArray<Readonly<Job>>,
  client: Client,
  messageBuilderManager: Readonly<MessageBuilderManager>,
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>
): ReadonlyMap<string, CommandHandler> {
  return new Map<string, CommandHandler>([
    [
      SLASH_COMMAND_NAMES.shortestUniqueSubstrings,
      shortestUniqueSubstringsHandler(messageBuilderManager.emoteMessageBuilders)
    ],
    [SLASH_COMMAND_NAMES.addEmote, addEmoteHandler(databaseManager.addedEmotesDatabase)],
    [SLASH_COMMAND_NAMES.emoteList, emoteListHandler(messageBuilderManager.emoteMessageBuilders)],
    [SLASH_COMMAND_NAMES.findTheEmoji, findTheEmojiHandler()],
    [
      SLASH_COMMAND_NAMES.mediaList,
      mediaListHandler(databaseManager.mediaDatabase, messageBuilderManager.mediaMessageBuilders)
    ],
    [
      SLASH_COMMAND_NAMES.quoteList,
      quoteListHandler(databaseManager.quoteDatabase, messageBuilderManager.quoteMessageBuilders)
    ],
    [SLASH_COMMAND_NAMES.transient, transientHandler()],
    [SLASH_COMMAND_NAMES.translate, translateHandler(apiManager.deepLClient)],
    [
      SLASH_COMMAND_NAMES.pingList,
      pingListHandler(
        databaseManager.pingsDatabase,
        messageBuilderManager.pingForPingListMessageBuilders,
        client,
        scheduledJobs
      )
    ],
    [SLASH_COMMAND_NAMES.chatGpt, chatGptHandler(apiManager.openai)],
    [
      SLASH_COMMAND_NAMES.pingMe,
      pingMeHandler(
        databaseManager.pingsDatabase,
        messageBuilderManager.pingForPingMeMessageBuilders,
        client,
        scheduledJobs
      )
    ],
    [SLASH_COMMAND_NAMES.media, mediaHandler(databaseManager.mediaDatabase)],
    [SLASH_COMMAND_NAMES.quote, quoteHandler(databaseManager.quoteDatabase)],
    [SLASH_COMMAND_NAMES.poe2, steamHandler('2694490')],
    [SLASH_COMMAND_NAMES.clip, clipHandler(messageBuilderManager.twitchClipMessageBuilders)],
    [SLASH_COMMAND_NAMES.clear, clearHandler(client)]
  ]);
}
