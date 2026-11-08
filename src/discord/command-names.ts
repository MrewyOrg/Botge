export const SLASH_COMMAND_NAMES = {
  emote: 'emote',
  emotes: 'emote-compose',
  emoteList: 'emote-search',
  clip: 'clip',
  addEmote: 'emote-add',
  chatGpt: 'chatgpt',
  translate: 'translate',
  shortestUniqueSubstrings: 'emote-shortcuts',
  transient: 'temporary',
  findTheEmoji: 'emoji-hunt',
  pingMe: 'remind',
  poe2: 'poe2-stats',
  settings: 'settings',
  pingList: 'reminders',
  media: 'media',
  mediaList: 'media-list',
  quote: 'quote',
  quoteList: 'quote-list',
  clear: 'clear-messages'
} as const;

export const CONTEXT_MENU_COMMAND_NAMES = {
  chatGptExplain: 'Explain with ChatGPT',
  addMedia: 'Save Media',
  removeMedia: 'Delete Saved Media',
  translate: 'Translate to English',
  addQuote: 'Save Quote',
  removeQuote: 'Delete Saved Quote'
} as const;

export const PING_LIST = { type: { own: 'own', every: 'every' }, timezone: 'timezone' } as const;

export const MEDIA_LIST_AND_QUOTE_LIST = { sortBy: { alphabetical: 'alphabetical' } } as const;
