import type { DeepLClient } from 'deepl-node';
import type { ActionRowBuilder, EmbedBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import type OpenAI from 'openai';
import type { DeepReadonly } from 'ts-essentials';

/** An array intentionally modified by its consumer, such as a shared registry or shuffle input. */
export type MutableArray<T> = T[];

export type ReadonlyOpenAI = DeepReadonly<OpenAI>;
export type ReadonlyDeepLClient = DeepReadonly<DeepLClient>;
type ReadonlyEmbedBuilder = DeepReadonly<EmbedBuilder>;
export type ReadonlyActionRowBuilderMessageActionRowComponentBuilder = DeepReadonly<
  ActionRowBuilder<MessageActionRowComponentBuilder>
>;

export type BotgeConfig = {
  readonly general: {
    readonly updateClipsOnStartup: boolean;
    readonly autoCompleteOnly7TVPersonal: boolean;
    readonly use7TVGlobalEmotes: boolean;
    readonly use7TVPersonalEmotes: boolean;
    readonly use7TVAddedEmotes: boolean;
    readonly useBTTVEmotes: boolean;
    readonly useFFZEmotes: boolean;
    readonly useTwitchEmotes: boolean;
    readonly activeSlashCommands: readonly string[];
    readonly activeContextMenuCommands: readonly string[];
  };
  readonly ollama: { readonly enabled: false } | OllamaConfigJson;
};

/** Ollama configuration as stored in JSON, before prompt lines are joined and substituted. */
export type OllamaConfigJson = Omit<OllamaConfig, 'systemPrompts'> & {
  readonly systemPrompts: {
    readonly scoreReplyOpportunity: readonly string[];
    readonly generateReply: readonly string[];
  };
};

/** Enabled Ollama configuration with resolved system prompts, ready for API requests. */
export type OllamaConfig = {
  readonly enabled: true;
  readonly botName: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly embeddingModel: string;
  readonly options: {
    readonly temperature: number;
    readonly num_ctx: number;
    readonly top_p: number;
  };
  readonly systemPrompts: {
    readonly scoreReplyOpportunity: string;
    readonly generateReply: string;
  };
  readonly behavior: {
    readonly replyScoreThreshold: number;
    readonly contextWindow: number;
    readonly evaluationChance: number;
    readonly cooldownSeconds: number;
    readonly ragResults: number;
    readonly ragWindowSize: number;
  };
  readonly chroma: { readonly url: string };
  readonly activeChatChannels: readonly string[];
};

export type OpenAIResponseInput = OpenAI.Responses.ResponseInput;

export type Platform = 'sevenInSet' | 'sevenNotInSet' | 'bttv' | 'ffz' | 'twitch';

export type SevenTVEmoteFile = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frame_count: number;
  readonly format: string;
};
export type SevenTVEmoteInSet = {
  readonly id: string;
  readonly name: string;
  readonly flags: number;
  readonly timestamp: number;
  readonly data: {
    readonly animated: boolean;
    readonly host: { readonly url: string; readonly files: readonly SevenTVEmoteFile[] };
  };
};
export type SevenTVEmoteNotInSet = {
  readonly id: string;
  readonly name: string;
  readonly flags: number;
  readonly animated: boolean;
  readonly host: { readonly url: string; readonly files: readonly SevenTVEmoteFile[] };
  readonly error?: string;
};

export type BTTVEmote = { readonly id: string; readonly code: string; readonly animated: boolean };
export type FFZEmote = {
  readonly id: number;
  readonly name: string;
  readonly urls: Readonly<Partial<Record<string, string>>>;
};
export type TwitchEmote = {
  readonly id: string;
  readonly name: string;
  readonly format: readonly string[];
  readonly theme_mode: readonly string[];
};

export type SevenTVEmotes = {
  readonly id: string;
  readonly error?: string;
  readonly emotes: readonly SevenTVEmoteInSet[];
  readonly owner: { readonly username: string } | null;
};
export type BTTVPersonalEmotes = {
  readonly message?: string;
  readonly channelEmotes: readonly BTTVEmote[];
  readonly sharedEmotes: readonly BTTVEmote[];
};
export type FFZPersonalEmotes = {
  readonly error?: string;
  readonly room: { readonly set: number };
  readonly sets: Readonly<Record<string, { readonly emoticons: readonly FFZEmote[] }>>;
};
export type FFZGlobalEmotes = {
  readonly sets: Readonly<Record<string, { readonly emoticons: readonly FFZEmote[] }>>;
};
export type TwitchGlobalEmotes = { readonly data: readonly TwitchEmote[] };

export type AddedEmote = { readonly url: string; readonly alias: string | null };

export type AssetInfo = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly zeroWidth: boolean;
  readonly animated: boolean;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly frameCount: number | undefined;
  readonly platform: Platform;
  readonly timestamp: number | undefined;
  readonly isSevenTVPersonal: boolean;
};
export type DownloadedAsset = {
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly animated: boolean;
};

export type TwitchClip = {
  readonly id: string;
  readonly url: string;
  readonly creator_name: string;
  readonly game_id: string;
  readonly title: string;
  readonly view_count: number;
  readonly created_at: string;
  readonly thumbnail_url: string;
};

export type TwitchClips = {
  readonly data: readonly TwitchClip[];
  readonly pagination: { readonly cursor?: string };
};

export type Ping = {
  readonly time: number;
  readonly days: number | null;
  readonly hours: number | null;
  readonly minutes: number | null;
  readonly userId: string;
  readonly channelId: string;
  readonly message: string | null;
  readonly userIds: readonly string[] | null;
  readonly userIdRemoved: boolean | null;
};

export type Media = {
  readonly url: string;
  readonly name: string;
  readonly dateAdded: Readonly<Date>;
  readonly tenorUrl?: string;
};

export type Quote = {
  readonly content: string;
  readonly name: string;
  readonly dateAdded: Readonly<Date>;
};

export type EmoteMessageBuilderTransformFunctionReturnType = {
  readonly embeds: readonly ReadonlyEmbedBuilder[];
  readonly components: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type TwitchClipMessageBuilderTransformFunctionReturnType = {
  readonly content: string;
  readonly components?: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type PingForPingMeMessageBuilderTransformFunctionReturnType = {
  readonly content: string;
  readonly components: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type PingForPingListMessageBuilderTransformFunctionReturnType = {
  readonly embeds: readonly ReadonlyEmbedBuilder[];
  readonly components: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type MediaMessageBuilderTransformFunctionReturnType = {
  readonly embeds: readonly ReadonlyEmbedBuilder[];
  readonly components: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type QuoteMessageBuilderTransformFunctionReturnType = {
  readonly embeds: readonly ReadonlyEmbedBuilder[];
  readonly components: readonly ReadonlyActionRowBuilderMessageActionRowComponentBuilder[];
};

export type PingForPingMeMessageBuilderReplies = {
  readonly reply: PingForPingMeMessageBuilderTransformFunctionReturnType | undefined;
  readonly buttonReply: string | undefined;
  readonly deletionEvent: boolean;
};

// The upstream declaration references a DOM type, but this Node project only parses strings.
// Keep the workaround scoped to @twemoji/api rather than adding the DOM library globally.
declare module '@twemoji/api' {
  type HTMLElement = string;
}
