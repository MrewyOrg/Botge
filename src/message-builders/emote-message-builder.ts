import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageActionRowComponentBuilder
} from 'discord.js';

import { booleanToString } from '../discord/boolean-labels.ts';
import { addedEmoteApiUrl, emotePageUrl, platformToString } from '../emotes/platforms.ts';
import type {
  AddedEmote,
  AssetInfo,
  EmoteMessageBuilderTransformFunctionReturnType,
  ReadonlyActionRowBuilderMessageActionRowComponentBuilder
} from '../types.ts';
import { BaseMessageBuilder, getCustomId } from './base.ts';

export const DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID = 'deleteEmoteButton' as const;

export class EmoteMessageBuilder extends BaseMessageBuilder<
  AssetInfo,
  EmoteMessageBuilderTransformFunctionReturnType
> {
  static readonly #messageBuilderType = 'Emote' as const;
  static #staticCounter = 0;
  readonly #extraRow: ReadonlyActionRowBuilderMessageActionRowComponentBuilder | undefined =
    undefined;
  readonly #shortestUniqueSubstrings: readonly string[] | undefined;
  readonly #markedAsDeletedArray: number[] | undefined = undefined;

  public constructor(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    emotes: readonly AssetInfo[],
    shortestUniqueSubstrings?: readonly string[],
    isAddedEmoteDeleteMode = false
  ) {
    const transformFunction = (
      assetInfo: AssetInfo
    ): EmoteMessageBuilderTransformFunctionReturnType => {
      const { name, url, zeroWidth, platform, width, height } = assetInfo;

      const embed = new EmbedBuilder();

      if (this.#shortestUniqueSubstrings !== undefined) {
        const substrings = this.#shortestUniqueSubstrings[this.currentIndex];
        embed.addFields({
          name: 'Shortest Unique Substrings',
          value: substrings === undefined || substrings === '' ? '-' : substrings
        });
      }

      if (
        this.#markedAsDeletedArray !== undefined
        && this.#markedAsDeletedArray.includes(this.currentIndex)
      )
        embed.setDescription('❌ DELETED ❌');

      embed
        .setColor('DarkButNotBlack')
        .setTitle(name)
        .setURL(emotePageUrl(assetInfo))
        .addFields(
          { name: 'Platform', value: platformToString(platform) },
          { name: 'Zero width', value: booleanToString(zeroWidth), inline: true },
          { name: 'Width', value: width?.toString() ?? 'N/A', inline: true },
          { name: 'Height', value: height?.toString() ?? 'N/A', inline: true }
        )
        .setImage(url)
        .setFooter({
          text: `${this.currentIndex + 1}/${this.arrayLength}.${
            isAddedEmoteDeleteMode ? ' Sorted alphabetically.'
            : shortestUniqueSubstrings === undefined ? ' Sorted by date added(newest first).'
            : ''
          }`
        });

      return {
        embeds: [embed],
        components: this.#extraRow !== undefined ? [this.row, this.#extraRow] : [this.row]
      };
    };

    const getIdentifierFunction = (assetInfo: AssetInfo): string => {
      return assetInfo.name;
    };

    super(
      EmoteMessageBuilder.#staticCounter++,
      EmoteMessageBuilder.messageBuilderType,
      interaction,
      emotes,
      transformFunction,
      getIdentifierFunction,
      'name'
    );

    if (isAddedEmoteDeleteMode) {
      this.#extraRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            getCustomId(
              DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID,
              EmoteMessageBuilder.messageBuilderType,
              this.counter
            )
          )
          .setLabel('Remove emote')
          .setStyle(ButtonStyle.Danger)
      );
      this.#markedAsDeletedArray = [];
    }

    this.#shortestUniqueSubstrings = shortestUniqueSubstrings;
  }

  public static get messageBuilderType(): string {
    return EmoteMessageBuilder.#messageBuilderType;
  }

  public get currentAddedEmote(): AddedEmote | undefined {
    if (this.#markedAsDeletedArray === undefined) return undefined;
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    const currentEmote = this.currentItem;
    if (currentEmote?.platform !== 'sevenNotInSet') return undefined;

    const apiUrl = addedEmoteApiUrl(currentEmote);
    if (apiUrl === undefined) return undefined;

    return { alias: currentEmote.name, url: apiUrl };
  }

  public markCurrentAsDeleted(): EmoteMessageBuilderTransformFunctionReturnType | undefined {
    if (this.currentItem === undefined) return undefined;
    if (this.#markedAsDeletedArray === undefined) return undefined;
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    this.#markedAsDeletedArray.push(this.currentIndex);
    return this.current();
  }
}
