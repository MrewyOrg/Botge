/** @format */

import type { DeepReadonly } from 'ts-essentials';
import type OpenAI from 'openai';
import type { Hit, RecordAny } from 'meilisearch';
import type { Translator } from 'deepl-node';
import type { Metadata } from 'chromadb';

import type {
  SlashCommandOptionsOnlyBuilder,
  SlashCommandStringOption,
  SlashCommandBooleanOption,
  SlashCommandAttachmentOption,
  SlashCommandIntegerOption,
  EmbedBuilder,
  ActionRowBuilder,
  MessageActionRowComponentBuilder,
  ModalBuilder,
  ApplicationCommandOptionChoiceData,
  ContextMenuCommandBuilder,
  Embed,
  Attachment
} from 'discord.js';

export type ReadonlyOpenAI = DeepReadonly<OpenAI>;
export type ReadonlyTranslator = DeepReadonly<Translator>;
export type ReadonlyHit = DeepReadonly<Hit>;
export type ReadonlyRecordAny = DeepReadonly<RecordAny>;
export type ReadonlyRegExpExecArray = DeepReadonly<RegExpExecArray>;
export type ReadonlySlashCommandStringOption = DeepReadonly<SlashCommandStringOption>;
export type ReadonlySlashCommandBooleanOption = DeepReadonly<SlashCommandBooleanOption>;
export type ReadonlySlashCommandAttachmentOption = DeepReadonly<SlashCommandAttachmentOption>;
export type ReadonlySlashCommandIntegerOption = DeepReadonly<SlashCommandIntegerOption>;
export type ReadonlySlashCommandOptionsOnlyBuilder = DeepReadonly<SlashCommandOptionsOnlyBuilder>;
export type ReadonlyContextMenuCommandBuilder = DeepReadonly<ContextMenuCommandBuilder>;
export type ReadonlyEmbedBuilder = DeepReadonly<EmbedBuilder>;
export type ReadonlyActionRowBuilderMessageActionRowComponentBuilder = DeepReadonly<
  ActionRowBuilder<MessageActionRowComponentBuilder>
>;
export type ReadonlyModalBuilder = DeepReadonly<ModalBuilder>;
export type ReadonlyApplicationCommandOptionChoiceDataString = DeepReadonly<
  ApplicationCommandOptionChoiceData<string>
>;

export type BotgeConfig = {
  readonly general: {
    readonly updateClipsOnStartup: boolean;
    readonly joinVoiceChannels: boolean;
    readonly autoCompleteOnly7TVPersonal: boolean;
    readonly load7TVGlobalEmotes: boolean;
    readonly loadBTTVEmotes: boolean;
    readonly loadFFZEmotes: boolean;
    readonly loadTwitchEmotes: boolean;
    readonly activeSlashCommands: readonly string[];
    readonly activeContextMenuCommands: readonly string[];
  };
  readonly ollama: { readonly enabled: false } | OllamaConfig;
};

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

export type ReadonlyEmbed = DeepReadonly<Embed>;
export type ReadonlyAttachment = DeepReadonly<Attachment>;
export type OpenAIResponseInput = OpenAI.Responses.ResponseInput;
export type OpenAIResponseInputImage = OpenAI.Responses.ResponseInputImage;

export type ReadonlyMetaData = DeepReadonly<Metadata>;

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
  readonly id: string;
  readonly name: string;
  readonly urls: Readonly<Record<string, string>>;
};
export type TwitchEmote = {
  readonly id: string;
  readonly name: string;
  readonly format: readonly string[];
  readonly theme_mode: readonly string[];
};

export type SevenTVEmotes = {
  readonly error?: string;
  readonly emotes: readonly SevenTVEmoteInSet[];
  readonly owner: { readonly username: string };
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
  readonly duration: number;
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

// ! Needed for @twemoji/api.parse, but we only parse string.
declare module '@twemoji/api' {
  type HTMLElement = string;
}
