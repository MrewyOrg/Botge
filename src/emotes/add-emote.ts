import type { AddedEmotesDatabase } from '../database/added-emotes-database.ts';
import type { Guild } from '../discord/guild.ts';
import { globalAdministrator, owner, permitted } from '../discord/permissions.ts';
import type { AddedEmote } from '../types.ts';
import { SEVEN_TV_EMOTES_URL, sevenTVUrlToSevenTVNotInSet } from './provider-urls.ts';

export function canAddEmote(
  guild: Readonly<Pick<Guild, 'allowEveryoneToAddEmote' | 'addEmotePermittedRoleIds'>>,
  discordGuild: Readonly<{ ownerId: string }>,
  member: Readonly<{ user: Readonly<{ id: string; username: string }> }>,
  roles: readonly (readonly [string, unknown])[]
): boolean {
  return (
    guild.allowEveryoneToAddEmote
    || permitted(roles, guild.addEmotePermittedRoleIds)
    || owner(member, discordGuild)
    || globalAdministrator(member)
  );
}

export async function addSevenTVEmote(
  database: Readonly<AddedEmotesDatabase>,
  guild: Readonly<Guild>,
  url: string,
  alias: string | null
): Promise<Readonly<{ status: number; message: string }>> {
  const emote = await sevenTVUrlToSevenTVNotInSet(url);
  if (emote === undefined) return { status: 400, message: 'Invalid URL.' };

  const name = alias ?? emote.name;
  if (guild.emoteCatalog.matchSingleExact(name))
    return { status: 409, message: 'There is already an emote with the same name.' };

  const record: AddedEmote = { url: `${SEVEN_TV_EMOTES_URL}/${emote.id}`, alias };
  if (database.getAll(guild.id).some((existing) => existing.url === record.url))
    return { status: 409, message: 'There is already an emote with the same URL.' };

  database.insert(record, guild.id);
  guild.personalEmoteStore.addSevenTVEmoteNotInSet({ ...emote, name });
  return {
    status: 201,
    message: `Added emote ${emote.name}${alias !== null ? ` with the name ${alias}` : ''}.`
  };
}
