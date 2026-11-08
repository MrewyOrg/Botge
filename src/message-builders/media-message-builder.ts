import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageActionRowComponentBuilder
} from 'discord.js';

import { MEDIA_LIST_AND_QUOTE_LIST } from '../discord/command-names.ts';
import type {
  Media,
  MediaMessageBuilderTransformFunctionReturnType,
  ReadonlyActionRowBuilderMessageActionRowComponentBuilder
} from '../types.ts';
import { BaseMessageBuilder, getCustomId } from './base.ts';

export const DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID = 'deleteMediaButton' as const;
export const RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID = 'renameMediaButton' as const;

export class MediaMessageBuilder extends BaseMessageBuilder<
  Media,
  MediaMessageBuilderTransformFunctionReturnType
> {
  static readonly #messageBuilderType = 'Media' as const;
  static #staticCounter = 0;
  readonly #extraRow: ReadonlyActionRowBuilderMessageActionRowComponentBuilder;
  readonly #markedAsDeletedArray: number[] = [];
  readonly #sortedByText: string;

  public constructor(
    interaction: ChatInputCommandInteraction,
    mediaArray: readonly Media[],
    sortedBy: string | undefined
  ) {
    const transformFunction = (media: Media): MediaMessageBuilderTransformFunctionReturnType => {
      const { name, url, dateAdded } = media;

      const embed = new EmbedBuilder();

      if (this.#markedAsDeletedArray.includes(this.currentIndex))
        embed.setDescription('❌ DELETED ❌');

      embed
        .setColor('DarkButNotBlack')
        .setTitle(name)
        .setURL(url)
        .addFields({ name: 'Date Added (UTC)', value: dateAdded.toUTCString() })
        .setFooter({
          text: `${this.currentIndex + 1}/${this.arrayLength}. ${this.#sortedByText === MEDIA_LIST_AND_QUOTE_LIST.sortBy.alphabetical ? 'Sorted alphabetically' : `Sorted by ${this.#sortedByText}`}.`
        });

      const { tenorUrl } = media;
      if (tenorUrl !== undefined) embed.setThumbnail(tenorUrl);
      else embed.setThumbnail(url);

      return { embeds: [embed], components: [this.row, this.#extraRow] };
    };

    const getIdentifierFunction = (media: Media): string => {
      return media.name;
    };

    super(
      MediaMessageBuilder.#staticCounter++,
      MediaMessageBuilder.messageBuilderType,
      interaction,
      mediaArray,
      transformFunction,
      getIdentifierFunction,
      'name'
    );

    this.#sortedByText = sortedBy ?? 'date added (newest first)';
    this.#extraRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID,
            MediaMessageBuilder.messageBuilderType,
            this.counter
          )
        )
        .setLabel('Delete media')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID,
            MediaMessageBuilder.messageBuilderType,
            this.counter
          )
        )
        .setLabel('Rename media')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  public static get messageBuilderType(): string {
    return MediaMessageBuilder.#messageBuilderType;
  }

  public get currentMedia(): Media | undefined {
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    const currentMedia = this.currentItem;
    return currentMedia;
  }

  public markCurrentAsDeleted(): MediaMessageBuilderTransformFunctionReturnType | undefined {
    if (this.currentItem === undefined) return undefined;
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    this.#markedAsDeletedArray.push(this.currentIndex);
    return this.current();
  }
}
