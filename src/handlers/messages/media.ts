import type { Message, OmitPartialGroupDMChannel } from 'discord.js';

import type { MediaDatabase } from '../../database/media-database.ts';
import { type Guild, GUILD_ID_CUTEDOG } from '../../discord/guild.ts';

export const MEDIA_COMMAND_IDENTIFIER = '.' as const;

export async function mediaMessageCreateHandler(
  message: OmitPartialGroupDMChannel<Message>,
  guild: Readonly<Guild>,
  mediaDatabase: Readonly<MediaDatabase>
): Promise<void> {
  const { member } = message;
  if (member === null) return;

  const mediaName = message.content.slice(MEDIA_COMMAND_IDENTIFIER.length).trim();
  if (mediaName === '') return;
  const mediaUrl = ((): string | undefined => {
    const memberId = member.id;

    const savedUrl = mediaDatabase.getMediaUrl(memberId, mediaName);
    if (savedUrl !== undefined) return savedUrl;

    return mediaDatabase.getMediaUrl(memberId, mediaName.toLowerCase());
  })();

  if (mediaUrl === undefined) {
    if (guild.id === GUILD_ID_CUTEDOG) {
      await message.react('<:HAH1:1236635745570127892>');
      await message.react('<:HAH2:1236635747449045003>');
      await message.react('<:HAH3:1236635749290610740>');
    } else await message.react('❌');

    return;
  }

  await message.reply({ content: mediaUrl, allowedMentions: { repliedUser: false } });
}
