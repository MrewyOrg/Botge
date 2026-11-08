import { type CSpellSettings, defineConfig } from 'cspell';

const cSpellSettings: Readonly<CSpellSettings> = defineConfig({
  version: '0.2',
  language: 'en',
  readonly: true,
  description: 'botgeCSpell',

  useGitignore: true,
  enableGlobDot: true,
  allowCompoundWords: true,
  validateDirectives: true,
  // Keep commit messages available to the commit-msg hook.
  ignorePaths: [
    '.git/worktrees',
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

  // Shared by multiple files; keep file-specific vocabulary in each file's header.
  words: [
    'frankerfacez',
    'NOCASE',
    'seventv',
    'unaliased',
    'unstub',
    'upserts',
    'vitest',
    'ahmadalli',
    'Anson',
    'BetterTTV',
    'Botge',
    'BTTV',
    'buildx',
    'chromadb',
    'dbaeumer',
    'DeepL',
    'dorny',
    'eamodio',
    'esac',
    'esbenp',
    'EUID',
    'ffprobe',
    'getent',
    'getmeili',
    'guildge',
    'joshbolduc',
    'jtvnw',
    'Knip',
    'Meili',
    'Meilisearch',
    'Mrewy',
    'namege',
    'nomic',
    'nvmrc',
    'Ollama',
    'pingme',
    'rego',
    'RRGGBB',
    'sarif',
    'socat',
    'tsandall',
    'xlaoyu'
  ]
});

export default cSpellSettings;
