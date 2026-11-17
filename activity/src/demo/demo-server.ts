/* In-memory stand-in for the Botge API and 7TV discovery, used by the browser-only demo. */

import type { DeepReadonly } from 'ts-essentials';

import type { ActivityOperation } from '../activity-api.ts';
import { DEMO_GUILD_ID } from '../features.ts';
import type { BrowserEmote } from '../catalog/catalog.ts';
import type { DiscoveryMode, fetchDiscoveryPage } from '../catalog/seventv.ts';
import type { EmoteSettings } from '../settings/emote-settings.ts';
import type { VoiceSettings } from '../settings/voice-settings.ts';
import type { ConnectGame } from '../game/game-state.ts';
import { connectDemoGame } from './demo-game.ts';

type DiscoveryPage = Awaited<ReturnType<typeof fetchDiscoveryPage>>;
type DiscoveryEmote = DiscoveryPage['emotes'][number];
/** Discovery entries in the demo pool always carry their tags. */
type PoolEmote = DiscoveryEmote & { readonly tags: readonly string[] };

/** Placeholder artwork shipped in `public/7tv-cdn/demo/`; the path passes catalog validation. */
function art(slug: string): string {
  return `/7tv-cdn/demo/${slug}.svg`;
}

/** Builds a valid 26-character 7TV-style ID that cannot collide with a real emote. */
function demoId(index: number): string {
  return `demo${String(index).padStart(22, '0')}`;
}

type Base = DeepReadonly<{
  slug: string;
  animated: boolean;
  overlaying?: boolean;
  tags: readonly string[];
}>;

const BASES: readonly Base[] = [
  { slug: 'wave', animated: true, tags: ['greeting', 'happy'] },
  { slug: 'grin', animated: false, tags: ['happy'] },
  { slug: 'sleepy', animated: false, tags: ['tired'] },
  { slug: 'hype', animated: true, tags: ['excited'] },
  { slug: 'cozy', animated: false, tags: ['calm'] },
  { slug: 'shock', animated: false, tags: ['surprised'] },
  { slug: 'laugh', animated: true, tags: ['happy', 'funny'] },
  { slug: 'think', animated: false, tags: ['curious'] },
  { slug: 'cool', animated: false, tags: ['calm'] },
  { slug: 'love', animated: true, tags: ['heart'] },
  { slug: 'cry', animated: false, tags: ['sad'] },
  { slug: 'party', animated: true, tags: ['excited', 'celebrate'] },
  { slug: 'halo', animated: false, overlaying: true, tags: ['overlay'] },
  { slug: 'hat', animated: false, overlaying: true, tags: ['overlay', 'celebrate'] },
  { slug: 'shades', animated: false, overlaying: true, tags: ['overlay', 'calm'] },
  { slug: 'sparkles', animated: true, overlaying: true, tags: ['overlay', 'excited'] }
] as const;
const VARIANTS: readonly string[] = ['', 'Fast', 'Big', 'Tiny'] as const;

function title(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Sixty-four public discovery entries: every base artwork in four named variants. */
const POOL: readonly PoolEmote[] = VARIANTS.flatMap((variant, round) =>
  BASES.map((base, index) => ({
    name: `${title(base.slug)}${variant}`,
    source: '7TV',
    image: art(base.slug),
    animated: base.animated,
    sevenTVId: demoId(round * BASES.length + index),
    tags: base.tags,
    ...(base.overlaying === true ? { overlaying: true } : {})
  }))
);

/** Trending reorders the pool with a fixed stride so both modes show distinct first pages. */
const TRENDING: readonly PoolEmote[] = POOL.flatMap((_, index) => {
  const start = (index * 7) % POOL.length;
  return POOL.slice(start, start + 1);
});
const PAGE_SIZE = 24 as const;

/** Which placeholder artworks appear as provider feed emotes in the server catalog. */
const FEED_SOURCES: ReadonlyMap<string, string> = new Map([
  ['grin', '7TV'],
  ['think', '7TV'],
  ['laugh', 'BTTV'],
  ['cool', 'BTTV'],
  ['sleepy', 'FFZ'],
  ['shock', 'FFZ'],
  ['cry', 'Twitch']
] as const);

/** Provider feed emotes; none of the feed artworks are overlays. */
const FEEDS: readonly BrowserEmote[] = BASES.flatMap((base) => {
  const source = FEED_SOURCES.get(base.slug);
  return source === undefined ?
      []
    : [
        {
          name: title(base.slug),
          source,
          image: art(base.slug),
          animated: base.animated,
          composeToken: title(base.slug),
          tags: base.tags
        }
      ];
});

function savedEmote(emote: DiscoveryEmote): BrowserEmote {
  return { ...emote, composeToken: emote.name, added: true };
}

const VOICE_CHANNELS = [
  { id: '100000000000000011', name: 'General' },
  { id: '100000000000000012', name: 'Gaming' },
  { id: '100000000000000013', name: 'Music' }
] as const;
const ROLES = [
  { id: '100000000000000021', name: 'Moderators' },
  { id: '100000000000000022', name: 'Emote Artists' },
  { id: '100000000000000023', name: 'Supporters' }
] as const;

/** Browser-only API stand-in with the same response shapes as the Botge Activity routes. */
export type DemoServer = {
  /** Opens a single-player guessing game over the non-overlay placeholder artworks. */
  readonly connectGame: ConnectGame;
  /** Answers one Activity API operation from in-memory state. */
  readonly request: (...operation: ActivityOperation) => Promise<unknown>;
  /** Returns one filtered page of placeholder 7TV discovery results. */
  readonly discover: (
    mode: DiscoveryMode,
    page: number,
    query: string,
    motion: string,
    overlay: string,
    tags: string
  ) => Promise<DiscoveryPage>;
};

/**
 * Creates a demo backend with placeholder emotes, settings, voice channels, and roles.
 *
 * @remarks
 * State lives only in memory and resets when the page reloads. Operations for any other guild
 * fail with an API-style message. Nothing is sent over the network.
 *
 * @param latency - Milliseconds each operation waits, so loading states remain visible.
 * @returns Request and discovery functions that share one in-memory guild.
 */
export function createDemoServer(latency = 250): DemoServer {
  // Saved 7TV additions, kept in addition order like the bot's added-emote list.
  const added: BrowserEmote[] = ([0, 3, 12] as const).flatMap((index) =>
    POOL.slice(index, index + 1).map(savedEmote)
  );
  let border = 'f0b232';
  let voice: VoiceSettings = {
    channelId: VOICE_CHANNELS[0].id,
    statusEnabled: true,
    statusEmoji: 'Wave'
  };
  let emotes: EmoteSettings = {
    sevenTvSet: '01DEMOSETPLACEHOLDER000000',
    bttvTwitchId: '12345678',
    ffzChannel: 'botgedemo',
    allowEveryone: false,
    allowedRoles: [ROLES[0].id]
  };

  async function wait(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, latency);
    });
  }

  function change(id: string, removing: boolean): DeepReadonly<{ ok: boolean; message: string }> {
    const index = added.findIndex((emote) => emote.sevenTVId === id);
    if (removing) {
      const [emote] = index === -1 ? [] : added.splice(index, 1);
      return emote === undefined ?
          { ok: false, message: 'That emote is not saved on this server.' }
        : { ok: true, message: `Removed ${emote.name} from this server.` };
    }
    const emote = POOL.find((entry) => entry.sevenTVId === id);
    if (emote === undefined) return { ok: false, message: 'That 7TV emote was not found.' };
    if (index !== -1) return { ok: false, message: `${emote.name} is already on this server.` };
    added.push(savedEmote(emote));
    return { ok: true, message: `Added ${emote.name} to this server.` };
  }

  async function request(...operation: ActivityOperation): Promise<unknown> {
    await wait();
    if (operation[1] !== DEMO_GUILD_ID) return { message: 'Open the demo server to try this.' };
    switch (operation[0]) {
      case 'catalog':
        return { canManageEmotes: true, canComposeDiscovery: true, emotes: [...added, ...FEEDS] };
      case 'emotes':
      case 'emotes/remove': {
        const removing = operation[0] === 'emotes/remove';
        const result = change(operation[2].emoteId, removing);
        return result.ok ?
            { message: result.message, [removing ? 'removed' : 'added']: true }
          : { message: result.message };
      }
      case 'emotes/batch': {
        const removing = operation[2].action === 'remove';
        return operation[2].emoteIds.map((emoteId) => ({ emoteId, ...change(emoteId, removing) }));
      }
      case 'game/join':
        // The demo game runs in the page through `connectGame` and needs no ticket.
        return { message: 'The demo game runs in the browser.' };
      case 'settings':
        return { voice, channels: VOICE_CHANNELS };
      case 'settings/voice': {
        const [, , fields] = operation;
        ({ voice } = fields);
        return { voice, channels: VOICE_CHANNELS };
      }
      case 'settings/emotes/read':
        return { ...emotes, roles: ROLES };
      case 'settings/emotes': {
        const [, , fields] = operation;
        ({ emotes } = fields);
        return { ...emotes, roles: ROLES };
      }
      case 'settings/border/read':
        return { color: border };
      case 'settings/border':
        // The page sends `#rrggbb` or an empty string; the API stores bare hex digits.
        border = operation[2].color.replace(/^#/u, '').toLowerCase();
        break;
    }
    return { color: border };
  }

  async function discover(
    mode: DiscoveryMode,
    page: number,
    query: string,
    motion: string,
    overlay: string,
    tags: string
  ): Promise<DiscoveryPage> {
    await wait();
    const search = query.trim().toLowerCase();
    const terms = tags
      .toLowerCase()
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean);
    const matches = (mode === 'trending' ? TRENDING : POOL).filter(
      (emote) =>
        emote.name.toLowerCase().includes(search)
        && (motion === '' || emote.animated === (motion === 'animated'))
        && (overlay === '' || (emote.overlaying === true) === (overlay === 'overlaying'))
        && terms.every((term) => emote.tags.some((tag) => tag.includes(term)))
    );
    return {
      emotes: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      pageCount: Math.ceil(matches.length / PAGE_SIZE)
    };
  }

  const connectGame = connectDemoGame(
    BASES.filter((base) => base.overlaying !== true).map((base) => ({
      name: title(base.slug),
      image: art(base.slug)
    }))
  );
  return { request, discover, connectGame };
}
