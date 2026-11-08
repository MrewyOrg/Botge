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
  Quote,
  QuoteMessageBuilderTransformFunctionReturnType,
  ReadonlyActionRowBuilderMessageActionRowComponentBuilder
} from '../types.ts';
import { BaseMessageBuilder, getCustomId } from './base.ts';
import { textToEmbedFields } from './embed-fields.ts';

export const DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID = 'deleteQuoteButton' as const;
export const RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID = 'renameQuoteButton' as const;

export class QuoteMessageBuilder extends BaseMessageBuilder<
  Quote,
  QuoteMessageBuilderTransformFunctionReturnType
> {
  static readonly #messageBuilderType = 'Quote' as const;
  static #staticCounter = 0;
  readonly #extraRow: ReadonlyActionRowBuilderMessageActionRowComponentBuilder;
  readonly #markedAsDeletedArray: number[] = [];
  readonly #sortedByText: string;

  public constructor(
    interaction: ChatInputCommandInteraction,
    quoteArray: readonly Quote[],
    sortedBy: string | undefined
  ) {
    const transformFunction = (quote: Quote): QuoteMessageBuilderTransformFunctionReturnType => {
      const { name, content, dateAdded } = quote;

      const embed = new EmbedBuilder();

      if (this.#markedAsDeletedArray.includes(this.currentIndex))
        embed.setDescription('❌ DELETED ❌');

      embed
        .setColor('DarkButNotBlack')
        .setTitle(name)
        .addFields({ name: 'Date Added (UTC)', value: dateAdded.toUTCString() })
        .addFields(...textToEmbedFields('Content', content))
        .setFooter({
          text: `${this.currentIndex + 1}/${this.arrayLength}. ${this.#sortedByText === MEDIA_LIST_AND_QUOTE_LIST.sortBy.alphabetical ? 'Sorted alphabetically' : `Sorted by ${this.#sortedByText}`}.`
        });

      return { embeds: [embed], components: [this.row, this.#extraRow] };
    };

    const getIdentifierFunction = (quote: Quote): string => {
      return quote.name;
    };

    super(
      QuoteMessageBuilder.#staticCounter++,
      QuoteMessageBuilder.messageBuilderType,
      interaction,
      quoteArray,
      transformFunction,
      getIdentifierFunction,
      'name'
    );

    this.#sortedByText = sortedBy ?? 'date added (newest first)';
    this.#extraRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID,
            QuoteMessageBuilder.messageBuilderType,
            this.counter
          )
        )
        .setLabel('Delete quote')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID,
            QuoteMessageBuilder.messageBuilderType,
            this.counter
          )
        )
        .setLabel('Rename quote')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  public static get messageBuilderType(): string {
    return QuoteMessageBuilder.#messageBuilderType;
  }

  public get currentQuote(): Quote | undefined {
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    const currentQuote = this.currentItem;
    return currentQuote;
  }

  public markCurrentAsDeleted(): QuoteMessageBuilderTransformFunctionReturnType | undefined {
    if (this.currentItem === undefined) return undefined;
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    this.#markedAsDeletedArray.push(this.currentIndex);
    return this.current();
  }
}
