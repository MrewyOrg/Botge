import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder
} from 'discord.js';

import type {
  ReadonlyActionRowBuilderMessageActionRowComponentBuilder,
  TwitchClip,
  TwitchClipMessageBuilderTransformFunctionReturnType
} from '../types.ts';
import { BaseMessageBuilder, getCustomId } from './base.ts';
import { getPingableUserId } from './get-pingable-user-id.ts';

export const SEND_CLIP_BUTTON_BASE_CUSTOM_ID = 'sendClipButton' as const;

export class TwitchClipMessageBuilder extends BaseMessageBuilder<
  TwitchClip,
  TwitchClipMessageBuilderTransformFunctionReturnType
> {
  static readonly #messageBuilderType = 'Clip' as const;
  static #staticCounter = 0;
  readonly #extraRow: ReadonlyActionRowBuilderMessageActionRowComponentBuilder | undefined =
    undefined;

  public constructor(
    interaction: ChatInputCommandInteraction,
    twitchClips: readonly TwitchClip[],
    ephemeral: boolean
  ) {
    const embedServer = process.env['EMBED_SERVER_TWITCH']?.trim();

    const transformFunction = (
      twitchClip: TwitchClip
    ): TwitchClipMessageBuilderTransformFunctionReturnType => {
      const { id, url } = twitchClip;
      const clipUrl =
        embedServer !== undefined && embedServer !== '' ?
          `${embedServer.replace(/\/$/u, '')}/${id}`
        : url;
      const content = `${clipUrl}\n${this.currentIndex + 1}/${this.arrayLength}`;

      return {
        content: content,
        components: this.#extraRow !== undefined ? [this.row, this.#extraRow] : [this.row]
      };
    };

    const getIdentifierFunction = (twitchClip: TwitchClip): string => {
      return twitchClip.title;
    };

    super(
      TwitchClipMessageBuilder.#staticCounter++,
      TwitchClipMessageBuilder.messageBuilderType,
      interaction,
      twitchClips,
      transformFunction,
      getIdentifierFunction,
      'title'
    );

    if (ephemeral) {
      this.#extraRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            getCustomId(
              SEND_CLIP_BUTTON_BASE_CUSTOM_ID,
              TwitchClipMessageBuilder.messageBuilderType,
              this.counter
            )
          )
          .setLabel('Share clip')
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  public static get messageBuilderType(): string {
    return TwitchClipMessageBuilder.#messageBuilderType;
  }

  public currentWithSentBy(): TwitchClipMessageBuilderTransformFunctionReturnType {
    const current = this.current();
    const [contentUrl] = current.content.split('\n');

    return { content: `${contentUrl}\nSent by: ${getPingableUserId(this.interaction.user.id)}` };
  }
}
