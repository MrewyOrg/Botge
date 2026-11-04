/** @format */

import { defineConfig, type CSpellSettings } from 'cspell';

const cSpellSettings: Readonly<CSpellSettings> = defineConfig({
  version: '0.2',
  language: 'en',
  readonly: true,
  description: 'botgeCSpell',

  useGitignore: true,
  enableGlobDot: true,
  caseSensitive: false,
  allowCompoundWords: true,
  validateDirectives: true,
  ignoreRandomStrings: true,

  dictionaries: [],
  ignorePaths: [
    '.git/gk',
    '.git/hooks',
    '.git/info',
    '.git/logs',
    '.git/objects',
    '.git/refs',
    '.git/config',
    '.git/description',
    '.git/FETCH_HEAD',
    '.git/HEAD',
    '.git/index',
    '.git/ORIG_HEAD',
    '.git/packed-refs'
  ],

  words: [
    // Words
    'metadatas',
    'unforgeable',
    'gpt',
    'relock',

    // Names
    'Botge',
    'Mrewy',
    'gentlebob',
    'widepogcrazy',
    'TimotronPrime',

    'CuteDog',
    'zackrawrr',

    'pozil',
    'dorny',

    // Lib
    'tpad',
    'settb',
    'hstack',
    'libwebp',
    'ffprobe',
    'noprint',
    'nokey',

    'nomic',
    'mxbai',
    'hnsw',

    'webp',
    'rego',

    // Extensions
    'moby',
    'eamodio',
    'buildx',
    'esbenp',
    'jmrog',
    'alefragnani',
    'Anson',
    'dbaeumer',
    'ahmadalli',
    'joshbolduc',
    'vsicons',
    'sarif',
    'xlaoyu',
    'kohler',
    'tsandall',

    // Other
    'FrankerFaceZ',
    'BetterTTV',
    'Meilisearch',
    'getmeili',
    'Meili',
    'DeepL',
    'BTTV',
    'Ollama',
    'ARPG',
    'chromadb',
    'CNTREC',
    'RRGGBB',
    'tsdoc',
    'vitest',
    'nvmrc',
    'syft',
    'botgeql'
  ],
  ignoreWords: [
    // ? Ge - rename later
    'guildge',
    'clipsge',
    'namege',
    'testge',
    'userge',

    // Random
    'KHTML',
    'jtvnw',
    '01FDMJPSF8000CJ4MDR2FNZEQ3',

    // Other
    'pingme',
    'doesnt',
    'nums',

    // Incorrect
    'strartup'
  ]
});

export default cSpellSettings;
