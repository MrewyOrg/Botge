import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import type { DeepReadonly } from 'ts-essentials';

import type { ReadonlyActionRowBuilderMessageActionRowComponentBuilder } from '../types.ts';

type ReadonlyModalBuilder = DeepReadonly<ModalBuilder>;

export const PREVIOUS_BUTTON_BASE_CUSTOM_ID = 'previousButton' as const;
export const NEXT_BUTTON_BASE_CUSTOM_ID = 'nextButton' as const;
export const FIRST_BUTTON_BASE_CUSTOM_ID = 'firstButton' as const;
export const LAST_BUTTON_BASE_CUSTOM_ID = 'lastButton' as const;
export const JUMP_TO_BUTTON_BASE_CUSTOM_ID = 'jumpToButton' as const;
export const JUMP_TO_MODAL_BASE_CUSTOM_ID = 'jumpToModal' as const;
export const JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID = 'jumpToTextInput' as const;
export const JUMP_TO_IDENTIFIER_TEXT_INPUT_BASE_CUSTOM_ID = 'jumpToIdentifierTextInput' as const;

const BUTTON_CUSTOM_ID_SPLITTER = '-' as const;

/**
 * Get the base custom ID of the {@link ButtonBuilder} or {@link ModalBuilder}.
 *
 * @remarks
 * The base custom ID is the ID for the functionality of the Builder.
 *
 * @example
 * getBaseCustomIdFromCustomId('previousButton-Emote-7') = 'previousButton'
 *
 * @param customId - The full custom ID
 * @returns The base custom ID
 */
export function getBaseCustomIdFromCustomId(customId: string): string {
  return customId.split(BUTTON_CUSTOM_ID_SPLITTER)[0] ?? '';
}

/**
 * Get the messageBuilder type of the {@link ButtonBuilder} or {@link ModalBuilder}.
 *
 * @remarks
 * The messageBuilder type is the type of the Builder.
 *
 * @example
 * getMessageBuilderTypeFromCustomId('previousButton-Emote-7') = 'Emote'
 *
 * @param customId - The full custom ID
 * @returns The messageBuilder type, or undefined when missing
 */
export function getMessageBuilderTypeFromCustomId(customId: string): string | undefined {
  const [, type] = customId.split(BUTTON_CUSTOM_ID_SPLITTER);
  return type === '' ? undefined : type;
}

/**
 * Get the counter of the {@link ButtonBuilder} or {@link ModalBuilder}.
 *
 * @remarks
 * The counter identifies the builder instance. Malformed counters return NaN.
 *
 * @example
 * getCounterFromCustomId('previousButton-Emote-7') = '7'
 *
 * @param customId - The full custom ID
 * @returns The counter
 */
export function getCounterFromCustomId(customId: string): number {
  const [, , counter] = customId.split(BUTTON_CUSTOM_ID_SPLITTER);
  if (counter === undefined || !/^\d+$/u.test(counter)) return NaN;
  const value = Number(counter);
  return Number.isSafeInteger(value) ? value : NaN;
}

/**
 * Constructs the full custom ID of the {@link ButtonBuilder} or {@link ModalBuilder}.
 *
 * @remarks
 * The full custom ID is an always unique identifier.
 *
 * @example
 * getCustomId('previousButton', 'Emote', 7) = 'previousButton-Emote-7'
 *
 * @see the functions above.
 *
 * @param baseCustomId - The base custom ID of the Builder
 * @param messageBuilderType - The messageBuilder type of the Builder
 * @param counter - The counter of the Builder
 * @returns The full custom ID
 */
export function getCustomId(
  baseCustomId: string,
  messageBuilderType: string,
  counter: number
): string {
  return `${baseCustomId}${BUTTON_CUSTOM_ID_SPLITTER}${messageBuilderType}${BUTTON_CUSTOM_ID_SPLITTER}${counter}`;
}

/**
 * A class to manage building list-like messages.
 *
 * @remarks The class defines the common parts of message builders, such as navigation buttons and navigation popups.
 *
 * @typeParam ArrayItemType - The type of the objects in the list.
 * @typeParam TransformFunctionReturnType - The Discord-sendable, display-form type of the objects in the list.
 */
export abstract class BaseMessageBuilder<ArrayItemType, TransformFunctionReturnType> {
  readonly #counter: number;
  readonly #interaction: ChatInputCommandInteraction | ButtonInteraction;
  readonly #array: readonly ArrayItemType[];
  /** The navigation buttons */
  readonly #row: ReadonlyActionRowBuilderMessageActionRowComponentBuilder;
  /** The navigation popups */
  readonly #modal: ReadonlyModalBuilder;
  readonly #transformFunction: (arrayItem: ArrayItemType) => TransformFunctionReturnType;
  readonly #getIdentifierFunction: ((arrayItem: ArrayItemType) => string) | undefined;
  #currentIndex: number;

  protected constructor(
    counter: number,
    messageBuilderType: string,
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    array: readonly ArrayItemType[],
    transformFunction: (arrayItem: ArrayItemType) => TransformFunctionReturnType,
    getIdentifierFunction: ((arrayItem: ArrayItemType) => string) | undefined,
    identifierName: string | undefined
  ) {
    this.#counter = counter;
    this.#interaction = interaction;
    this.#array = [...array];
    this.#transformFunction = transformFunction;
    this.#getIdentifierFunction = getIdentifierFunction;
    this.#currentIndex = -1; // ! -1 because of first element

    this.#row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(getCustomId(FIRST_BUTTON_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
        .setLabel('First')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(getCustomId(PREVIOUS_BUTTON_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(getCustomId(JUMP_TO_BUTTON_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
        .setLabel('Go to item')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(getCustomId(NEXT_BUTTON_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(getCustomId(LAST_BUTTON_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
        .setLabel('Last')
        .setStyle(ButtonStyle.Secondary)
    );

    this.#modal = new ModalBuilder()
      .setCustomId(getCustomId(JUMP_TO_MODAL_BASE_CUSTOM_ID, messageBuilderType, this.#counter))
      .setTitle('Go to item')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Item number')
          .setDescription(
            `Enter 1–${array.length}. Leave ${identifierName === undefined ? 'this field' : 'both fields'} blank for a random item.`
          )
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(
                getCustomId(JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID, messageBuilderType, this.#counter)
              )
              .setMaxLength(6)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g. 1')
              .setRequired(false)
          )
      );

    if (identifierName !== undefined && getIdentifierFunction !== undefined) {
      this.#modal.addLabelComponents(
        new LabelBuilder()
          .setLabel(`Item ${identifierName}`)
          .setDescription(`Full or partial ${identifierName}; leave the item number blank.`)
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(
                getCustomId(
                  JUMP_TO_IDENTIFIER_TEXT_INPUT_BASE_CUSTOM_ID,
                  messageBuilderType,
                  this.#counter
                )
              )
              .setMaxLength(256)
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
      );
    }
  }

  public get counter(): number {
    return this.#counter;
  }
  public get interaction(): ChatInputCommandInteraction | ButtonInteraction {
    return this.#interaction;
  }
  public get modal(): ReadonlyModalBuilder {
    return this.#modal;
  }

  protected get row(): ReadonlyActionRowBuilderMessageActionRowComponentBuilder {
    return this.#row;
  }
  protected get currentIndex(): number {
    return this.#currentIndex;
  }
  protected get currentItem(): ArrayItemType | undefined {
    return this.#array[this.#currentIndex];
  }
  protected get arrayLength(): number {
    return this.#array.length;
  }

  public previous(): TransformFunctionReturnType | undefined {
    return this.jumpTo(this.#currentIndex - 1);
  }

  public next(): TransformFunctionReturnType | undefined {
    return this.jumpTo(this.#currentIndex + 1);
  }

  public first(): TransformFunctionReturnType | undefined {
    return this.jumpTo(0);
  }

  public last(): TransformFunctionReturnType | undefined {
    return this.jumpTo(this.#array.length - 1);
  }

  public random(): TransformFunctionReturnType | undefined {
    const { length } = this.#array;
    if (length === 0) return undefined;
    if (this.#currentIndex < 0) return this.jumpTo(Math.floor(Math.random() * length));
    if (length === 1) return undefined;

    // Draw from all other pages without retrying when the current page is selected.
    const index = Math.floor(Math.random() * (length - 1));
    return this.jumpTo(index >= this.#currentIndex ? index + 1 : index);
  }

  public jumpTo(jumpTo: number): TransformFunctionReturnType | undefined {
    if (!Number.isInteger(jumpTo) || jumpTo < 0 || jumpTo >= this.#array.length) return undefined;
    if (this.#currentIndex === jumpTo) return undefined;

    this.#currentIndex = jumpTo;
    return this.current();
  }

  public jumpToIdentifier(jumpTo: string): TransformFunctionReturnType | undefined {
    if (jumpTo === '' || this.#getIdentifierFunction === undefined) return undefined;

    for (const [index, arrayItem] of this.#array.entries()) {
      const identifier = this.#getIdentifierFunction(arrayItem);

      if (identifier === jumpTo) {
        if (this.#currentIndex === index) return undefined;

        this.#currentIndex = index;
        return this.current();
      }
    }

    for (const [index, arrayItem] of this.#array.entries()) {
      const identifier = this.#getIdentifierFunction(arrayItem);

      if (identifier.toLowerCase() === jumpTo.toLowerCase()) {
        if (this.#currentIndex === index) return undefined;

        this.#currentIndex = index;
        return this.current();
      }
    }

    for (const [index, arrayItem] of this.#array.entries()) {
      const identifier = this.#getIdentifierFunction(arrayItem);

      if (identifier.toLowerCase().includes(jumpTo.toLowerCase())) {
        if (this.#currentIndex === index) return undefined;

        this.#currentIndex = index;
        return this.current();
      }
    }

    return undefined;
  }

  /**
   * Gets the current element.
   *
   * @remarks Discord-sendable.
   *
   * @returns The current element transformed
   */
  protected current(): TransformFunctionReturnType {
    const item = this.currentItem;
    if (item === undefined) throw new RangeError('No current message builder item.');
    return this.#transformFunction(item);
  }
}
