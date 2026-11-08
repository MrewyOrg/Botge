import type { Message, OmitPartialGroupDMChannel } from 'discord.js';

import type { CachedUrl } from '../../api/cached-url.ts';
import { ollamaConfig } from '../../config/ollama-config.ts';
import type { MediaDatabase } from '../../database/media-database.ts';
import type { Guild } from '../../discord/guild.ts';
import type { User } from '../../discord/user.ts';
import { logError } from '../../utils/log-error.ts';
import { EMOTE_COMMAND_IDENTIFIER, emotesHandler } from '../commands/emote.ts';
import { MEDIA_COMMAND_IDENTIFIER, mediaMessageCreateHandler } from './media.ts';
import { ollamaMessageCreateHandler } from './ollama.ts';

export function messageCreateHandler(clientUserId: string | null) {
  return async (
    cachedUrl: Readonly<CachedUrl>,
    message: OmitPartialGroupDMChannel<Message>,
    guild: Readonly<Guild>,
    users: readonly Readonly<User>[],
    mediaDatabase: Readonly<MediaDatabase>
  ): Promise<void> => {
    try {
      const { content } = message;
      if (
        content.startsWith(EMOTE_COMMAND_IDENTIFIER)
        && content[EMOTE_COMMAND_IDENTIFIER.length] === ' '
      )
        return;

      if (content.startsWith(EMOTE_COMMAND_IDENTIFIER)) {
        await emotesHandler(cachedUrl)(guild, users, false, undefined, message);
      } else if (content.startsWith(MEDIA_COMMAND_IDENTIFIER)) {
        await mediaMessageCreateHandler(message, guild, mediaDatabase);
      }

      if (clientUserId !== null && ollamaConfig.enabled)
        await ollamaMessageCreateHandler(message, clientUserId);
    } catch (error) {
      logError(error, 'Error at messageCreateHandler');
    }
  };
}
