import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from 'discord.js';
import timezones, { type TimeZone } from 'timezones-list';
import type { DeepReadonly } from 'ts-essentials';

import type { ClipIndex } from '../../api/twitch/clip-index.ts';
import type { DatabaseManager } from '../../bot/database-manager.ts';
import { booleanToString, stringToBoolean } from '../../discord/boolean-labels.ts';
import { SLASH_COMMAND_NAMES } from '../../discord/command-names.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import type { EmoteCatalog } from '../../emotes/emote-catalog.ts';
import { platformStrings, platformToString, stringToPlatform } from '../../emotes/platforms.ts';
import type { AssetInfo, Platform, TwitchClip } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';
import { getShortestUniqueSubstrings } from '../commands/shortest-unique-substrings.ts';

type ReadonlyApplicationCommandOptionChoiceDataString = DeepReadonly<
  ApplicationCommandOptionChoiceData<string>
>;

// CommonJS interop exposes this package differently in Node and Vitest.
const timezoneList: readonly TimeZone[] = 'default' in timezones ? timezones.default : timezones;
const MAX_OPTIONS_LENGTH = 25 as const;

async function getHitsFromTwitchClipsMeilisearchIndex(
  twitchClipsMeilisearchIndex: ClipIndex,
  query: string
): Promise<readonly TwitchClip[]> {
  const { maxTotalHits } = await twitchClipsMeilisearchIndex.getPagination();
  if (maxTotalHits === null || maxTotalHits === undefined)
    throw new Error('pagination max total hits not set');

  const hits: readonly TwitchClip[] = (
    await twitchClipsMeilisearchIndex.search<TwitchClip>(query.trim(), {
      sort: ['created_at:desc'],
      limit: maxTotalHits,
      matchingStrategy: 'all'
    })
  ).hits;

  return hits;
}

function applicableSizes(platform: Platform | undefined): readonly number[] {
  if (platform === 'bttv' || platform === 'twitch') return [1, 2, 3];
  else if (platform === 'ffz') return [1, 2, 4];
  else return [1, 2, 3, 4];
}

export function autocompleteHandler(
  emoteCatalog: Readonly<EmoteCatalog>,
  twitchClipsMeilisearchIndex: ClipIndex | undefined,
  uniqueCreatorNames: readonly string[] | undefined,
  uniqueGameIds: readonly string[] | undefined,
  databaseManager: Readonly<DatabaseManager>
) {
  return async (interaction: AutocompleteInteraction): Promise<void> => {
    try {
      const interactionCommandName = interaction.commandName;
      const focusedOption = interaction.options.getFocused(true);
      const focusedOptionName = focusedOption.name;
      const focusedOptionValue = focusedOption.value;

      if (interactionCommandName === SLASH_COMMAND_NAMES.emote) {
        if (focusedOptionName === 'name') {
          const matches =
            emoteCatalog.matchSingleArray(
              focusedOptionValue.trim(),
              undefined,
              undefined,
              undefined,
              MAX_OPTIONS_LENGTH,
              process.env['AUTOCOMPLETE_ONLY_7TV_PERSONAL'] !== 'true',
              process.env['AUTOCOMPLETE_ONLY_7TV_PERSONAL'] === 'true',
              true
            ) ?? [];
          const options: readonly ApplicationCommandOptionChoiceData<string>[] = matches.map(
            (match) => {
              return { name: match.name, value: match.name };
            }
          );

          await interaction.respond(options);
        } else if (focusedOptionName === 'size') {
          const emote = getOptionValue(interaction, 'name') ?? '';
          const match = emote !== '' ? emoteCatalog.matchSingle(emote) : undefined;
          const availableSizes =
            match !== undefined ? applicableSizes(match.platform) : applicableSizes(undefined);

          const options: readonly ApplicationCommandOptionChoiceData<number>[] = availableSizes.map(
            (applicableSize) => {
              return { name: applicableSize.toString(), value: applicableSize };
            }
          );

          await interaction.respond(options);
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.emoteList) {
        if (focusedOptionName === 'query') {
          const platform = getOptionValue(interaction, 'platform', stringToPlatform);
          const animated = getOptionValue(interaction, 'animated', stringToBoolean);
          const overlaying = getOptionValue(interaction, 'overlaying', stringToBoolean);

          const matches =
            emoteCatalog.matchSingleArray(
              focusedOptionValue.trim(),
              platform,
              animated,
              overlaying,
              MAX_OPTIONS_LENGTH,
              true
            ) ?? [];
          const options: readonly ApplicationCommandOptionChoiceData<string>[] = matches.map(
            (match) => {
              return { name: match.name.trim(), value: match.name.trim() };
            }
          );

          await interaction.respond(options);
        } else if (focusedOptionName === 'platform') {
          const query = getOptionValue(interaction, 'query') ?? '';
          const animated = getOptionValue(interaction, 'animated', stringToBoolean);
          const overlaying = getOptionValue(interaction, 'overlaying', stringToBoolean);

          const matches =
            emoteCatalog.matchSingleArray(query, undefined, animated, overlaying)
            ?? emoteCatalog.matchSingleArray('');
          const platforms: readonly string[] =
            matches !== undefined ?
              [...new Set(matches.map((match) => platformToString(match.platform))).keys()]
            : platformStrings();

          const options: readonly ApplicationCommandOptionChoiceData<string>[] = platforms.map(
            (platform) => {
              return { name: platform, value: platform };
            }
          );

          await interaction.respond(options);
        } else if (focusedOptionName === 'animated' || focusedOptionName === 'overlaying') {
          const query = getOptionValue(interaction, 'query') ?? '';
          const matches = ((): readonly AssetInfo[] | undefined => {
            const platform = getOptionValue(interaction, 'platform', stringToPlatform);

            if (focusedOptionName === 'animated') {
              const overlaying = getOptionValue(interaction, 'overlaying', stringToBoolean);

              return emoteCatalog.matchSingleArray(query, platform, undefined, overlaying);
            } else {
              const animated = getOptionValue(interaction, 'animated', stringToBoolean);

              return emoteCatalog.matchSingleArray(query, platform, animated);
            }
          })();
          const bools = [
            ...new Set(
              matches !== undefined ?
                focusedOptionName === 'animated' ?
                  matches.map((match) => match.animated)
                : matches.map((match) => match.zeroWidth)
              : []
            ).keys()
          ];

          const options: readonly ApplicationCommandOptionChoiceData<string>[] = bools.map(
            (bool) => {
              return { name: booleanToString(bool), value: booleanToString(bool) };
            }
          );

          await interaction.respond(options);
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.clip) {
        if (
          twitchClipsMeilisearchIndex === undefined
          || uniqueCreatorNames === undefined
          || uniqueGameIds === undefined
        )
          return;
        if (focusedOptionName === 'title') {
          const category = getOptionValue(interaction, 'category');
          const clipper = getOptionValue(interaction, 'clipper');

          const hits = await (async (): Promise<readonly TwitchClip[]> => {
            let searchHits = await getHitsFromTwitchClipsMeilisearchIndex(
              twitchClipsMeilisearchIndex,
              focusedOptionValue.trim()
            );

            if (category !== undefined)
              searchHits = searchHits.filter((hit) => hit.game_id === category);
            if (clipper !== undefined)
              searchHits = searchHits.filter((hit) => hit.creator_name === clipper);

            return searchHits;
          })();

          const options: readonly ApplicationCommandOptionChoiceData<string>[] = hits.map(
            (clip) => {
              return { name: clip.title, value: clip.title };
            }
          );

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        } else if (focusedOptionName === 'clipper') {
          const title = getOptionValue(interaction, 'title') ?? '';
          const category = getOptionValue(interaction, 'category');

          const currentUniqueCreatorNames = await (async (): Promise<readonly string[]> => {
            if (title === '' && category === undefined) return uniqueCreatorNames;

            const hits = await getHitsFromTwitchClipsMeilisearchIndex(
              twitchClipsMeilisearchIndex,
              title
            );
            const hitsFiltered =
              category !== undefined ? hits.filter((hit) => hit.game_id === category) : hits;
            const creatorNames = new Set(hitsFiltered.map((hit) => hit.creator_name))
              .keys()
              .toArray();
            return creatorNames;
          })();

          const options: readonly ApplicationCommandOptionChoiceData<string>[] =
            currentUniqueCreatorNames
              .filter((uniqueCreatorName) =>
                uniqueCreatorName.toLowerCase().includes(focusedOptionValue.trim().toLowerCase())
              )
              .map((uniqueCreatorName) => {
                return { name: uniqueCreatorName, value: uniqueCreatorName };
              });

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        } else if (focusedOptionName === 'category') {
          const title = getOptionValue(interaction, 'title') ?? '';
          const clipper = getOptionValue(interaction, 'clipper');

          const currentUniqueGameIds = await (async (): Promise<readonly string[]> => {
            if (title === '' && clipper === undefined) return uniqueGameIds;

            const hits = await getHitsFromTwitchClipsMeilisearchIndex(
              twitchClipsMeilisearchIndex,
              title
            );
            const hitsFiltered =
              clipper !== undefined ? hits.filter((hit) => hit.creator_name === clipper) : hits;
            const gameIds = new Set(hitsFiltered.map((hit) => hit.game_id)).keys().toArray();
            return gameIds;
          })();

          const options: readonly ApplicationCommandOptionChoiceData<string>[] =
            currentUniqueGameIds
              .filter((uniqueGameId) =>
                uniqueGameId.toLowerCase().includes(focusedOptionValue.trim().toLowerCase())
              )
              .map((uniqueGameId) => {
                return { name: uniqueGameId, value: uniqueGameId };
              });

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.shortestUniqueSubstrings) {
        if (focusedOptionName === 'emotes') {
          const focusedOptionValueSplit: readonly string[] = focusedOptionValue.split(/\s+/u);
          const focusedOptionValueLast = focusedOptionValueSplit.at(-1) ?? '';
          const focusedOptionValueEverythingButLast = focusedOptionValueSplit
            .slice(0, -1)
            .map((emote) => {
              const [, shortestUniqueSubstrings] = getShortestUniqueSubstrings(emoteCatalog, emote);
              if (shortestUniqueSubstrings !== undefined) return shortestUniqueSubstrings[0];
              else return emote;
            })
            .join(' ');

          const matches =
            emoteCatalog.matchSingleArray(
              focusedOptionValueLast.trim(),
              undefined,
              undefined,
              undefined,
              MAX_OPTIONS_LENGTH,
              true
            ) ?? [];
          const options: readonly ApplicationCommandOptionChoiceData<string>[] = matches.map(
            (match) => {
              const [, shortestUniqueSubstrings] = getShortestUniqueSubstrings(
                emoteCatalog,
                match.name
              );
              const shortestUniqueSubstring =
                shortestUniqueSubstrings !== undefined ? shortestUniqueSubstrings[0] : match.name;

              return {
                name: `${focusedOptionValueEverythingButLast} ${match.name}`.trim(),
                value: `${focusedOptionValueEverythingButLast} ${shortestUniqueSubstring}`.trim()
              };
            }
          );

          if (
            options.some(
              (option: ReadonlyApplicationCommandOptionChoiceDataString) => option.name.length > 100
            )
          )
            return;

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.pingList) {
        if (focusedOptionName === 'timezone') {
          const matchingTimezones = timezoneList.filter((timezone: Readonly<TimeZone>) =>
            timezone.name.toLowerCase().includes(focusedOptionValue.trim().toLowerCase())
          );

          const options: readonly ApplicationCommandOptionChoiceData<string>[] =
            matchingTimezones.map((timezone: Readonly<TimeZone>) => {
              return { name: timezone.name, value: timezone.utc };
            });

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.media) {
        if (focusedOptionName === 'name') {
          const mediaNames: readonly string[] = databaseManager.mediaDatabase
            .getAllMedia(interaction.user.id)
            .map((media) => media.name)
            .filter((mediaName) =>
              mediaName.toLowerCase().includes(focusedOptionValue.trim().toLowerCase())
            );
          const options: readonly ApplicationCommandOptionChoiceData<string>[] = mediaNames.map(
            (mediaName) => {
              return { name: mediaName, value: mediaName };
            }
          );

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        }
      } else if (interactionCommandName === SLASH_COMMAND_NAMES.quote) {
        if (focusedOptionName === 'name') {
          const quoteNames: readonly string[] = databaseManager.quoteDatabase
            .getAllQuote(interaction.user.id)
            .map((quote) => quote.name)
            .filter((quoteName) =>
              quoteName.toLowerCase().includes(focusedOptionValue.trim().toLowerCase())
            );
          const options: readonly ApplicationCommandOptionChoiceData<string>[] = quoteNames.map(
            (quoteName) => {
              return { name: quoteName, value: quoteName };
            }
          );

          await interaction.respond(options.slice(0, MAX_OPTIONS_LENGTH));
        }
      }
    } catch (error) {
      logError(error, 'Error at autocompleteHandler');
    }
  };
}
