import type {
  BTTVEmote,
  BTTVPersonalEmotes,
  FFZEmote,
  FFZGlobalEmotes,
  FFZPersonalEmotes,
  SevenTVEmoteFile,
  SevenTVEmoteInSet,
  SevenTVEmoteNotInSet,
  SevenTVEmotes
} from '../types.ts';
import { checked, isArrayOf, isRecord } from '../utils/validation.ts';

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFile(value: unknown): value is SevenTVEmoteFile {
  return (
    isRecord(value)
    && typeof value['name'] === 'string'
    && isNumber(value['width'])
    && isNumber(value['height'])
    && isNumber(value['frame_count'])
    && typeof value['format'] === 'string'
  );
}

function isHost(value: unknown): value is SevenTVEmoteNotInSet['host'] {
  return isRecord(value) && typeof value['url'] === 'string' && isArrayOf(value['files'], isFile);
}

export function isSevenTVEmoteInSet(value: unknown): value is SevenTVEmoteInSet {
  return (
    isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && isNumber(value['flags'])
    && isNumber(value['timestamp'])
    && isRecord(value['data'])
    && typeof value['data']['animated'] === 'boolean'
    && isHost(value['data']['host'])
  );
}

function isSevenTVEmote(value: unknown): value is SevenTVEmoteNotInSet {
  return (
    isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && isNumber(value['flags'])
    && typeof value['animated'] === 'boolean'
    && isHost(value['host'])
    && (value['error'] === undefined || typeof value['error'] === 'string')
  );
}

function isSevenTVSet(value: unknown): value is SevenTVEmotes {
  return (
    isRecord(value)
    && typeof value['id'] === 'string'
    && isArrayOf(value['emotes'], isSevenTVEmoteInSet)
    && (value['owner'] === null
      || (isRecord(value['owner']) && typeof value['owner']['username'] === 'string'))
    && (value['error'] === undefined || typeof value['error'] === 'string')
  );
}

export function parseSevenTVSet(value: unknown): SevenTVEmotes {
  if (isRecord(value) && typeof value['error'] === 'string') throw new Error(value['error']);
  // The global set may omit its owner.
  return checked(
    isRecord(value) ? { ...value, owner: value['owner'] ?? null } : value,
    isSevenTVSet,
    '7TV emote set'
  );
}

export function parseSevenTVEmote(value: unknown): SevenTVEmoteNotInSet {
  if (isRecord(value) && typeof value['error'] === 'string') throw new Error(value['error']);
  return checked(value, isSevenTVEmote, '7TV emote');
}

function isBTTVEmote(value: unknown): value is BTTVEmote {
  return (
    isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['code'] === 'string'
    && typeof value['animated'] === 'boolean'
  );
}

export function parseBTTVGlobal(value: unknown): readonly BTTVEmote[] {
  return checked(
    value,
    (item): item is readonly BTTVEmote[] => isArrayOf(item, isBTTVEmote),
    'BTTV global emotes'
  );
}

function isBTTVSet(value: unknown): value is BTTVPersonalEmotes {
  return (
    isRecord(value)
    && isArrayOf(value['channelEmotes'], isBTTVEmote)
    && isArrayOf(value['sharedEmotes'], isBTTVEmote)
    && (value['message'] === undefined || typeof value['message'] === 'string')
  );
}

export function parseBTTVSet(value: unknown): BTTVPersonalEmotes {
  return checked(value, isBTTVSet, 'BTTV emote set');
}

function isFFZEmote(value: unknown): value is FFZEmote {
  return (
    isRecord(value)
    && isNumber(value['id'])
    && typeof value['name'] === 'string'
    && isRecord(value['urls'])
    && Object.values(value['urls']).every((url) => typeof url === 'string')
  );
}

function isFFZSets(value: unknown): value is FFZGlobalEmotes['sets'] {
  return (
    isRecord(value)
    && Object.values(value).every((set) => isRecord(set) && isArrayOf(set['emoticons'], isFFZEmote))
  );
}

function isFFZGlobal(value: unknown): value is FFZGlobalEmotes {
  return isRecord(value) && isFFZSets(value['sets']);
}

function isFFZSet(value: unknown): value is FFZPersonalEmotes {
  return (
    isRecord(value)
    && isFFZSets(value['sets'])
    && isRecord(value['room'])
    && isNumber(value['room']['set'])
    && (value['error'] === undefined || typeof value['error'] === 'string')
  );
}

export function parseFFZGlobal(value: unknown): FFZGlobalEmotes {
  return checked(value, isFFZGlobal, 'FFZ global emotes');
}

export function parseFFZSet(value: unknown): FFZPersonalEmotes {
  return checked(value, isFFZSet, 'FFZ emote set');
}
