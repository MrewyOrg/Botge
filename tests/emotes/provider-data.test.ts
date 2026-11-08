import { expect, test } from 'vitest';

import {
  parseBTTVGlobal,
  parseBTTVSet,
  parseFFZGlobal,
  parseFFZSet,
  parseSevenTVEmote,
  parseSevenTVSet
} from 'src/emotes/provider-data.ts';

const file = { name: '1x.png', width: 32, height: 32, frame_count: 1, format: 'PNG' } as const;
const emote = {
  id: 'id',
  name: 'Example',
  flags: 0,
  animated: false,
  host: { url: '//cdn.7tv.app/emote/id', files: [file] }
} as const;
const setEmote = {
  id: 'id',
  name: 'Example',
  flags: 0,
  timestamp: 1,
  data: { animated: false, host: emote.host }
} as const;
const bttv = { id: 'id', code: 'Example', animated: false } as const;
const ffz = { id: 1, name: 'Example', urls: { '1': '//cdn.frankerfacez.com/emote/1/1' } } as const;

test.each([
  {
    name: '7TV emote',
    parse: parseSevenTVEmote,
    valid: emote,
    invalid: { ...emote, host: { ...emote.host, files: [{ ...file, width: 'wide' }] } }
  },
  {
    name: '7TV set',
    parse: parseSevenTVSet,
    valid: { id: 'set', owner: null, emotes: [setEmote] },
    invalid: { id: 'set', owner: null, emotes: [{ ...setEmote, data: null }] }
  },
  {
    name: 'BTTV global',
    parse: parseBTTVGlobal,
    valid: [bttv],
    invalid: [{ ...bttv, animated: 'false' }]
  },
  {
    name: 'BTTV set',
    parse: parseBTTVSet,
    valid: { channelEmotes: [bttv], sharedEmotes: [] },
    invalid: { channelEmotes: [bttv], sharedEmotes: null }
  },
  {
    name: 'FFZ global',
    parse: parseFFZGlobal,
    valid: { sets: { '3': { emoticons: [ffz] } } },
    invalid: { sets: { '3': { emoticons: [{ ...ffz, urls: { '1': 42 } }] } } }
  },
  {
    name: 'FFZ set',
    parse: parseFFZSet,
    valid: { room: { set: 1 }, sets: { '1': { emoticons: [ffz] } } },
    invalid: { room: { set: '1' }, sets: {} }
  }
])(
  'validates nested provider data: $name',
  ({
    parse,
    valid,
    invalid
  }: Readonly<{ parse: (value: unknown) => unknown; valid: unknown; invalid: unknown }>) => {
    expect(parse(valid)).toEqual(valid);
    for (const value of [invalid, null, { invalid: true }, 'invalid'])
      expect(() => parse(value)).toThrow('Invalid');
  }
);

test('7TV global sets normalize a missing owner and preserve provider errors', () => {
  expect(parseSevenTVSet({ id: 'set', emotes: [] })).toEqual({
    id: 'set',
    emotes: [],
    owner: null
  });
  expect(() => parseSevenTVSet({ error: 'Unavailable set' })).toThrow('Unavailable set');
  expect(() => parseSevenTVEmote({ error: 'Unavailable emote' })).toThrow('Unavailable emote');
});
