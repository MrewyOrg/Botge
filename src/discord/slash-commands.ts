import {
  InteractionContextType,
  type SlashCommandAttachmentOption,
  type SlashCommandBooleanOption,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandStringOption
} from 'discord.js';
import type { DeepReadonly } from 'ts-essentials';

import { MEDIA_LIST_AND_QUOTE_LIST, PING_LIST, SLASH_COMMAND_NAMES } from './command-names.ts';

type ReadonlySlashCommandOptionsOnlyBuilder = DeepReadonly<SlashCommandOptionsOnlyBuilder>;

type ReadonlySlashCommandIntegerOption = DeepReadonly<SlashCommandIntegerOption>;

type ReadonlySlashCommandAttachmentOption = DeepReadonly<SlashCommandAttachmentOption>;

type ReadonlySlashCommandBooleanOption = DeepReadonly<SlashCommandBooleanOption>;

type ReadonlySlashCommandStringOption = DeepReadonly<SlashCommandStringOption>;

const emote: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.emote)
  .setDescription('Send an emote by name')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('name')
      .setDescription('Emote name; partial names are supported')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option
      .setName('size')
      .setDescription('Emote size; choose from the available sizes')
      .setAutocomplete(true)
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const emotes: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.emotes)
  .setDescription('Combine emotes, emojis, and images in a row or overlay')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('emotes')
      .setDescription('Space-separated emote names, emojis, or image URLs; up to 32 inputs')
      .setRequired(true)
  )
  .addBooleanOption((option: ReadonlySlashCommandBooleanOption) =>
    option
      .setName('fullsize')
      .setDescription('Use original image dimensions and the largest available emote size')
  )
  .addBooleanOption((option: ReadonlySlashCommandBooleanOption) =>
    option.setName('stretch').setDescription('Stretch overlays to fit instead of centering them')
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const emoteList: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.emoteList)
  .setDescription('Search and browse the available emotes')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('query')
      .setDescription('Emote name or part of a name; omit to browse all emotes')
      .setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('platform').setDescription('Filter by emote provider').setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('animated')
      .setDescription('Show animated emotes, static emotes, or both')
      .setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('overlaying')
      .setDescription('Show overlay emotes, regular emotes, or both')
      .setAutocomplete(true)
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const clip: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.clip)
  .setDescription('Search and browse Twitch clips')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('title')
      .setDescription('Search for words in the clip title')
      .setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('clipper')
      .setDescription('Filter by the Twitch user who created the clip')
      .setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('category').setDescription('Filter by game or category').setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('sortby')
      .setDescription('Sort clips; default: newest first')
      .addChoices({ name: 'Views', value: 'views' }, { name: 'Random order', value: 'shuffle' })
  )
  .addBooleanOption((option: ReadonlySlashCommandBooleanOption) =>
    option
      .setName('ephemeral')
      .setDescription('Show results only to you, with a button to share a clip')
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const addEmote: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.addEmote)
  .setDescription("Add a 7TV emote to this server's bot catalog")
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('url').setDescription('7TV emote URL').setRequired(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('name').setDescription('Optional alias to use instead of the original name')
  );

const chatGpt: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.chatGpt)
  .setDescription('Ask ChatGPT a question or analyze an image')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('prompt')
      .setDescription('Your question or instructions for ChatGPT')
      .setRequired(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('image').setDescription('Image URL for ChatGPT to analyze')
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('instruction')
      .setDescription('Guidance for the response; default: Be concise.')
      .addChoices({ name: 'No instruction', value: 'No instruction.' })
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const translate: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.translate)
  .setDescription('Translate text into English with automatic language detection')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('text').setDescription('Text to translate into English').setRequired(true)
  );

const shortestUniqueSubstrings: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.shortestUniqueSubstrings)
  .setDescription('Find the shortest text that uniquely matches each emote')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('emotes')
      .setDescription('Space-separated emote names')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('format')
      .setDescription('Result format; default: plain text')
      .setChoices([{ name: 'Emote browser', value: 'emoteBrowser' }])
  )
  .addBooleanOption((option: ReadonlySlashCommandBooleanOption) =>
    option.setName('ephemeral').setDescription('Show results only to you')
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const transient: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.transient)
  .setDescription('Send text or an attachment that is automatically deleted')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('text').setDescription('Text to send; use either text or an attachment')
  )
  .addAttachmentOption((option: ReadonlySlashCommandAttachmentOption) =>
    option
      .setName('attachment')
      .setDescription('Attachment to send; use either an attachment or text')
  )
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option
      .setName('duration')
      .setMinValue(0)
      .setMaxValue(600)
      .setDescription('Seconds before deletion; default: 3, range: 0–600')
  );

const findTheEmoji: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.findTheEmoji)
  .setDescription('Find the hidden emoji in a grid of spoilers')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('emoji').setDescription('Non-animated server emoji to hide in the grid')
  )
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option
      .setName('size')
      .setMinValue(3)
      .setMaxValue(7)
      .setDescription('Grid width and height; default: 5, range: 3–7')
  );

const pingMe: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.pingMe)
  .setDescription('Set a reminder for yourself in this channel')
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option.setName('days').setMinValue(1).setDescription('Days to add to the reminder delay')
  )
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option.setName('hours').setMinValue(1).setDescription('Hours to add to the reminder delay')
  )
  .addIntegerOption((option: ReadonlySlashCommandIntegerOption) =>
    option.setName('minutes').setMinValue(1).setDescription('Minutes to add to the reminder delay')
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option.setName('message').setMaxLength(1800).setDescription('Optional reminder message')
  );

const poe2: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.poe2)
  .setDescription('Show Path of Exile 2 player counts and Steam statistics');

const settings: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.settings)
  .setDescription('Configure server emotes, permissions, and your bot preferences')
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const pingList: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.pingList)
  .setDescription('Browse and manage reminders in this server')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('type')
      .setDescription('Choose whose reminders to show; default: everyone in this server')
      .addChoices(
        { name: 'My reminders', value: PING_LIST.type.own },
        { name: 'All server reminders', value: PING_LIST.type.every }
      )
  )
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName(PING_LIST.timezone)
      .setDescription('Time zone for reminder dates; default: UTC')
      .setAutocomplete(true)
  );

const media: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.media)
  .setDescription('Send saved media by name')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('name')
      .setDescription('Name of the saved media')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const mediaList: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.mediaList)
  .setDescription('Browse and manage saved media')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('sortby')
      .setDescription('Sort entries; default: most recently added first')
      .addChoices({ name: 'Name (A–Z)', value: MEDIA_LIST_AND_QUOTE_LIST.sortBy.alphabetical })
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const quote: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.quote)
  .setDescription('Send a saved quote by name')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('name')
      .setDescription('Name of the saved quote')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const quoteList: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.quoteList)
  .setDescription('Browse and manage saved quotes')
  .addStringOption((option: ReadonlySlashCommandStringOption) =>
    option
      .setName('sortby')
      .setDescription('Sort entries; default: most recently added first')
      .addChoices({ name: 'Name (A–Z)', value: MEDIA_LIST_AND_QUOTE_LIST.sortBy.alphabetical })
  )
  .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel);

const clear: ReadonlySlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
  .setName(SLASH_COMMAND_NAMES.clear)
  .setDescription('Delete all earlier messages in this channel after confirmation')
  .setContexts(InteractionContextType.Guild);

export const slashCommands: readonly ReadonlySlashCommandOptionsOnlyBuilder[] = [
  emote,
  emotes,
  emoteList,
  clip,
  addEmote,
  chatGpt,
  translate,
  shortestUniqueSubstrings,
  transient,
  findTheEmoji,
  pingMe,
  poe2,
  settings,
  pingList,
  media,
  mediaList,
  quote,
  quoteList,
  clear
];
