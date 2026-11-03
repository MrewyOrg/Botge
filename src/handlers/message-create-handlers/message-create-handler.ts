/** @format */

import type { OmitPartialGroupDMChannel, Message } from 'discord.js';

import type { MediaDatabase } from '../../database/media-database.ts';
import { ollamaConfig } from '../../api/config/ollama-config.ts';
import type { CachedUrl } from '../../api/cached-url.ts';
import { EMOTE_COMMAND_IDENTIFIER, emotesHandler } from '../command-handlers/emote.ts';
import { logError } from '../../utils/public/log-error.ts';
import type { Guild } from '../../modules/discord/guild.ts';
import type { User } from '../../modules/discord/user.ts';

import {
  MEDIA_COMMAND_IDENTIFIER,
  mediaMessageCreateHandler
} from './media-message-create-handler.ts';
import { ollamaMessageCreateHandler } from './ollama-message-create-handler.ts';

export function messageCreateHandler(clientUserId: string | null) {
  return async (
    cachedUrl: Readonly<CachedUrl>,
    message: OmitPartialGroupDMChannel<Message>,
    guild: Readonly<Guild>,
    users: readonly Readonly<User>[],
    mediaDataBase: Readonly<MediaDatabase>
  ): Promise<void> => {
    try {
      const { content } = message;
      if (content[EMOTE_COMMAND_IDENTIFIER.length] === ' ') return;

      if (content.startsWith(EMOTE_COMMAND_IDENTIFIER)) {
        await emotesHandler(cachedUrl)(guild, users, undefined, message);
      } else if (content.startsWith(MEDIA_COMMAND_IDENTIFIER)) {
        await mediaMessageCreateHandler(message, guild, mediaDataBase);
      }

      if (clientUserId !== null && ollamaConfig.enabled)
        await ollamaMessageCreateHandler(message, clientUserId);
    } catch (error) {
      logError(error, 'Error at messageCreateHandler');
    }
  };
}
