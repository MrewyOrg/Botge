/** @format */

import type { Job } from 'node-schedule';

import type { ChatInputCommandInteraction, Client } from 'discord.js';

import { shortestUniqueSubstringsHandler } from '../../../handlers/command-handlers/shortest-unique-substrings.ts';
import { addEmoteHandlerSevenTVNotInSet } from '../../../handlers/command-handlers/add-emote.ts';
import { emoteListHandler } from '../../../handlers/command-handlers/emote.ts';
import { findTheEmojiHandler } from '../../../handlers/command-handlers/find-the-emoji.ts';
import { mediaListHandler } from '../../../handlers/command-handlers/media-list.ts';
import { quoteListHandler } from '../../../handlers/command-handlers/quote-list.ts';
import { transientHandler } from '../../../handlers/command-handlers/transient.ts';
import { translateHandler } from '../../../handlers/command-handlers/translate.ts';
import { pingListHandler } from '../../../handlers/command-handlers/ping-list.ts';
import { chatgptHandler } from '../../../handlers/command-handlers/openai.ts';
import { pingMeHandler } from '../../../handlers/command-handlers/ping-me.ts';
import { mediaHandler } from '../../../handlers/command-handlers/media.ts';
import { quoteHandler } from '../../../handlers/command-handlers/quote.ts';
import { steamHandler } from '../../../handlers/command-handlers/steam.ts';
import { clearHandler } from '../../../handlers/command-handlers/clear.ts';
import { clipHandler } from '../../../handlers/command-handlers/clip.ts';

import type { MessageBuilderManager } from '../../../modules/bot/message-builder-manager.ts';
import type { DatabaseManager } from '../../../modules/bot/database-manager.ts';
import type { ApiManager } from '../../../modules/bot/api-manager.ts';

import { SLASH_COMMAND_NAMES } from '../../../modules/discord/commands.ts';
import type { Guild } from '../../../modules/discord/guild.ts';

export type CommandHandler = (
  interaction: ChatInputCommandInteraction,
  guild: Readonly<Guild>
) => Promise<void>;

export function createCommandHandlers(
  scheduledJobs: Readonly<Job>[],
  client: Client,
  messageBuilderManager: Readonly<MessageBuilderManager>,
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>
): Map<string, CommandHandler> {
  return new Map<string, CommandHandler>([
    [
      SLASH_COMMAND_NAMES.shortestUniqueSubstrings,
      shortestUniqueSubstringsHandler(messageBuilderManager.emoteMessageBuilders)
    ],
    [
      SLASH_COMMAND_NAMES.addEmote,
      addEmoteHandlerSevenTVNotInSet(databaseManager.addedEmotesDatabase)
    ],
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
    [SLASH_COMMAND_NAMES.chatGpt, chatgptHandler(apiManager.openai)],
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
