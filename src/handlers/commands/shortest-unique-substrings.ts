import type { ChatInputCommandInteraction } from 'discord.js';

import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import { getOptionValue, getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import type { Guild } from '../../discord/guild.ts';
import type { EmoteCatalog } from '../../emotes/emote-catalog.ts';
import { EmoteMessageBuilder } from '../../message-builders/emote-message-builder.ts';
import type { MutableArray } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function getShortestUniqueSubstrings(
  catalog: Readonly<EmoteCatalog>,
  text: string
): readonly [string | undefined, readonly string[] | undefined] {
  const match = catalog.matchSingle(text);
  if (match === undefined) return [undefined, undefined];
  // Search by length so longer substrings are never allocated or scanned unnecessarily.
  for (let length = 1; length <= match.name.length; length++) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (let start = 0; start <= match.name.length - length; start++) {
      const substring = match.name.slice(start, start + length);
      if (seen.has(substring)) continue;
      seen.add(substring);
      if (catalog.matchSingleUnique(substring, match.name)) unique.push(substring);
    }
    if (unique.length > 0) return [match.name, unique];
  }
  return [match.name, undefined];
}

export function shortestUniqueSubstringsHandler(
  emoteMessageBuilders: MutableArray<Readonly<EmoteMessageBuilder>>
) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    const { emoteCatalog } = guild;
    const ephemeral = getOptionValue(interaction, 'ephemeral', Boolean) ?? false;
    const defer =
      ephemeral ? interaction.deferReply({ flags: 'Ephemeral' }) : interaction.deferReply();
    try {
      const emotesOption: readonly string[] = getOptionValueWithoutUndefined(
        interaction,
        'emotes'
      ).split(/\s+/u);
      const format = getOptionValue(interaction, 'format');

      const substringMatches: readonly (readonly [
        string | undefined,
        readonly string[] | undefined
      ])[] = emotesOption.map((emoteOption) =>
        getShortestUniqueSubstrings(emoteCatalog, emoteOption)
      );

      if (format !== undefined) {
        const emotes = emotesOption
          .map((emoteOption) => emoteCatalog.matchSingle(emoteOption))
          .filter((emote) => emote !== undefined);
        if (emotes.length === 0) return;

        const descriptions: readonly string[] = substringMatches
          .filter((substringMatch) => substringMatch[0] !== undefined)
          .map((substringMatch) => substringMatch[1])
          .map((shortestUniqueSubstring) => {
            if (shortestUniqueSubstring === undefined) return '-';
            return shortestUniqueSubstring.join(', ');
          });
        if (descriptions.length === 0) return;

        const emoteMessageBuilder = new EmoteMessageBuilder(interaction, emotes, descriptions);
        const reply = emoteMessageBuilder.first();
        if (reply === undefined) return;

        await defer;
        await interaction.editReply(reply);
        registerMessageBuilder(emoteMessageBuilders, emoteMessageBuilder);
        return;
      }

      let message = '';
      substringMatches.forEach(
        (i: readonly [string | undefined, readonly string[] | undefined], j) => {
          const [original, shortestUniqueSubstrings] = i;
          if (original === undefined) {
            message += `Could not find emote '${emotesOption[j]}'.\n`;
            return;
          }

          if (shortestUniqueSubstrings !== undefined) {
            if (shortestUniqueSubstrings.length === 1)
              message += `${original}: ${shortestUniqueSubstrings[0]}\n`;
            else message += `${original}: ${shortestUniqueSubstrings.join(', ')}\n`;
          } else {
            message += `${original}: -\n`;
          }
        }
      );

      await defer;
      await interaction.editReply(message.trim());
    } catch (error) {
      logError(error, 'Error at shortestUniqueSubstringsHandler');

      await defer;
      await interaction.editReply('failed to provide shortest unique substrings.');
    }
  };
}
