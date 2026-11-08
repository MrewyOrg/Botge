import type { EmoteMessageBuilder } from '../message-builders/emote-message-builder.ts';
import type { MediaMessageBuilder } from '../message-builders/media-message-builder.ts';
import type { PingForPingListMessageBuilder } from '../message-builders/ping-for-ping-list-message-builder.ts';
import type { PingForPingMeMessageBuilder } from '../message-builders/ping-for-ping-me-message-builder.ts';
import type { QuoteMessageBuilder } from '../message-builders/quote-message-builder.ts';
import type { TwitchClipMessageBuilder } from '../message-builders/twitch-clip-message-builder.ts';
import type { MutableArray } from '../types.ts';

const CLEANUP_MINUTES = 10 as const;

const MAX_MESSAGE_BUILDERS = 100;

/** Retain recent interactive menus without letting bursts grow the registries indefinitely. */
export function registerMessageBuilder<T>(builders: MutableArray<T>, builder: T): void {
  builders.splice(0, Math.max(0, builders.length - MAX_MESSAGE_BUILDERS + 1));
  builders.push(builder);
}

export class MessageBuilderManager {
  readonly #pingForPingListMessageBuilders: MutableArray<Readonly<PingForPingListMessageBuilder>> =
    [];
  readonly #pingForPingMeMessageBuilders: MutableArray<Readonly<PingForPingMeMessageBuilder>> = [];
  readonly #twitchClipMessageBuilders: MutableArray<Readonly<TwitchClipMessageBuilder>> = [];
  readonly #emoteMessageBuilders: MutableArray<Readonly<EmoteMessageBuilder>> = [];
  readonly #mediaMessageBuilders: MutableArray<Readonly<MediaMessageBuilder>> = [];
  readonly #quoteMessageBuilders: MutableArray<Readonly<QuoteMessageBuilder>> = [];

  public get pingForPingListMessageBuilders(): MutableArray<
    Readonly<PingForPingListMessageBuilder>
  > {
    return this.#pingForPingListMessageBuilders;
  }
  public get pingForPingMeMessageBuilders(): MutableArray<Readonly<PingForPingMeMessageBuilder>> {
    return this.#pingForPingMeMessageBuilders;
  }
  public get twitchClipMessageBuilders(): MutableArray<Readonly<TwitchClipMessageBuilder>> {
    return this.#twitchClipMessageBuilders;
  }
  public get emoteMessageBuilders(): MutableArray<Readonly<EmoteMessageBuilder>> {
    return this.#emoteMessageBuilders;
  }
  public get mediaMessageBuilders(): MutableArray<Readonly<MediaMessageBuilder>> {
    return this.#mediaMessageBuilders;
  }
  public get quoteMessageBuilders(): MutableArray<Readonly<QuoteMessageBuilder>> {
    return this.#quoteMessageBuilders;
  }

  static #cleanupMessageBuilders(
    messageBuilders: MutableArray<
      | Readonly<PingForPingMeMessageBuilder>
      | Readonly<PingForPingListMessageBuilder>
      | Readonly<TwitchClipMessageBuilder>
      | Readonly<EmoteMessageBuilder>
      | Readonly<MediaMessageBuilder>
      | Readonly<QuoteMessageBuilder>
    >,
    timeNow: number
  ): void {
    let retained = 0;
    for (const index of messageBuilders.keys()) {
      const messageBuilder = messageBuilders[index];
      if (messageBuilder === undefined) continue;
      const difference = timeNow - messageBuilder.interaction.createdAt.getTime();
      if (difference <= CLEANUP_MINUTES * 60000) {
        messageBuilders[retained++] = messageBuilder;
      }
    }
    messageBuilders.length = retained;
  }

  public cleanupMessageBuilders(): void {
    const timeNow = Date.now();

    MessageBuilderManager.#cleanupMessageBuilders(this.#pingForPingListMessageBuilders, timeNow);
    MessageBuilderManager.#cleanupMessageBuilders(this.#pingForPingMeMessageBuilders, timeNow);

    MessageBuilderManager.#cleanupMessageBuilders(this.#twitchClipMessageBuilders, timeNow);
    MessageBuilderManager.#cleanupMessageBuilders(this.#emoteMessageBuilders, timeNow);
    MessageBuilderManager.#cleanupMessageBuilders(this.#mediaMessageBuilders, timeNow);
    MessageBuilderManager.#cleanupMessageBuilders(this.#quoteMessageBuilders, timeNow);
  }
}
