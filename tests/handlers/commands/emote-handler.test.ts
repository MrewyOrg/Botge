// cspell:words hstack libwebp

import * as childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { ChatInputCommandInteraction, Message, OmitPartialGroupDMChannel } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CachedUrl } from 'src/api/cached-url.ts';
import { TMP_DIR } from 'src/config/directory-paths.ts';
import type { Guild } from 'src/discord/guild.ts';
import { User } from 'src/discord/user.ts';
import { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import { twitchToAsset } from 'src/emotes/emote-to-asset.ts';
import { downloadAsset } from 'src/emotes/rendering/download-asset.ts';
import { parseToken } from 'src/emotes/rendering/parse-token.ts';
import { emotesHandler } from 'src/handlers/commands/emote.ts';
import type { AssetInfo } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

const providerSettings = vi.hoisted(() => ({
  use7TVGlobalEmotes: true,
  use7TVPersonalEmotes: true,
  use7TVAddedEmotes: true,
  useBTTVEmotes: true,
  useFFZEmotes: true,
  useTwitchEmotes: true
}));
vi.mock('src/config/botge-config.ts', () => ({ botgeConfig: { general: providerSettings } }));

vi.mock('node:child_process', async () => ({
  ...(await vi.importActual<typeof childProcess>('node:child_process')),
  spawn: vi.fn()
}));
vi.mock('src/emotes/rendering/parse-token.ts', () => ({ parseToken: vi.fn() }));
vi.mock('src/emotes/rendering/download-asset.ts', () => ({ downloadAsset: vi.fn() }));

describe('Emote rendering lifecycle', () => {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const asset = {
    url: 'https://cdn.7tv.app/example.png',
    zeroWidth: false,
    platform: 'sevenInSet',
    isSevenTVPersonal: false
  };
  const guild = {
    id: 'review',
    emoteCatalog: { matchSingle: () => asset, matchMulti: () => [asset] }
  } as unknown as Readonly<Guild>;
  let interaction: ChatInputCommandInteraction;
  let directory: string;
  let child: EventEmitter & { readonly stderr: PassThrough };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    editReply.mockReset().mockResolvedValue(undefined);
    child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
    const id = randomUUID();
    directory = join(TMP_DIR, id);
    interaction = {
      id,
      guildId: 'review',
      user: { id: 'review' },
      options: {
        get: (name: string) => (name === 'emotes' ? { value: 'example' } : null),
        getBoolean: () => null
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply
    } as unknown as ChatInputCommandInteraction;
    vi.mocked(downloadAsset).mockImplementation(async (outdir: string) => {
      const filename = join(outdir, 'input.png');
      await writeFile(filename, 'test input');
      return { filename, width: 20, height: 20, frameCount: 1, animated: false };
    });
  });

  afterEach(async () => {
    child.stderr.destroy();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  test('waits for FFmpeg to close before replying and removing inputs', async () => {
    const started = Promise.withResolvers<undefined>();
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      started.resolve(undefined);
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    let finished = false;
    const rendering = emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction).then(
      () => {
        finished = true;
      }
    );
    await started.promise;
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(finished).toBe(false);
    expect(editReply).not.toHaveBeenCalled();
    await expect(access(join(directory, 'input.png'))).resolves.toBeUndefined();

    child.emit('close', 0, null);
    await rendering;
    expect(editReply).toHaveBeenCalledWith({ files: [join(directory, 'botgeEmote.png')] });
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('reports spawn failures and removes temporary inputs', async () => {
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.emit('error', new Error('spawn ffmpeg ENOENT'));
        child.emit('close', -2, null);
      });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
    expect(editReply).toHaveBeenCalledWith('gif creation failed.');
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('drains stderr and reports unsuccessful FFmpeg exits', async () => {
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr.write('decoder error\n'.repeat(10000));
        child.emit('close', 1, null);
      });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
    expect(child.stderr.readableLength).toBe(0);
    expect(console.error).toHaveBeenCalledWith('Error at emoteCombinedHandler:', expect.any(Error));
    expect(editReply).toHaveBeenCalledWith('gif creation failed.');
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('removes temporary inputs when uploading the result fails', async () => {
    editReply.mockRejectedValueOnce(new Error('upload failed'));
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
    expect(editReply).toHaveBeenCalledWith('gif creation failed.');
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    { tokens: 'base base', downloads: 1, overlay: undefined, columns: 2 },
    { tokens: 'base overlay base', downloads: 2, overlay: '[o0][v1]overlay=', columns: 2 },
    { tokens: 'base base overlay', downloads: 2, overlay: '[o1][v2]overlay=', columns: 2 },
    { tokens: 'base overlay overlay', downloads: 2, overlay: '[o0][v2]overlay=', columns: 1 }
  ])(
    'preserves input order and overlay groups: $tokens',
    async ({
      tokens,
      downloads,
      overlay,
      columns
    }: Readonly<{
      tokens: string;
      downloads: number;
      overlay: string | undefined;
      columns: number;
    }>) => {
      const base: AssetInfo = {
        id: 'base',
        name: 'base',
        url: 'https://example.com/base.png',
        platform: 'sevenInSet',
        zeroWidth: false,
        animated: false,
        width: 20,
        height: 20,
        frameCount: 1,
        timestamp: undefined,
        isSevenTVPersonal: false
      };
      const catalog = new EmoteCatalog(() => [
        [base, { ...base, id: 'overlay', name: 'overlay', zeroWidth: true }]
      ]);
      const combinedGuild = { id: 'review', emoteCatalog: catalog } as unknown as Readonly<Guild>;
      const combinedInteraction = {
        id: interaction.id,
        guildId: 'review',
        user: { id: 'review' },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply,
        options: {
          get: (name: string): Readonly<{ value: string }> | null =>
            name === 'emotes' ? { value: tokens } : null,
          getBoolean: (): null => null
        }
      } as unknown as ChatInputCommandInteraction;
      vi.mocked(downloadAsset).mockImplementation(
        async (outdir: string, _asset: AssetInfo | string, index: number) => {
          const filename = join(outdir, `${index}.png`);
          await writeFile(filename, 'test input');
          return { filename, width: 20, height: 20, frameCount: 1, animated: false };
        }
      );
      vi.mocked(childProcess.spawn).mockImplementation(() => {
        queueMicrotask(() => child.emit('close', 0, null));
        return child as unknown as ReturnType<typeof childProcess.spawn>;
      });
      await emotesHandler(new CachedUrl(undefined))(combinedGuild, [], false, combinedInteraction);
      expect(downloadAsset).toHaveBeenCalledTimes(downloads);
      const [, args] = requireValue(
        vi.mocked(childProcess.spawn).mock.calls[0],
        'Expected FFmpeg invocation.'
      );
      expect(args.filter((argument) => argument === '-i')).toHaveLength(tokens.split(' ').length);
      const filter = requireValue(
        args[args.indexOf('-filter_complex') + 1],
        'Expected render filter.'
      );
      if (overlay === undefined) expect(filter).not.toContain('overlay=');
      else expect(filter).toContain(overlay);
      if (columns > 1) expect(filter).toContain(`hstack=inputs=${columns}`);
      else expect(filter).not.toContain('hstack=');
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  test.each([
    { fullsize: false, stretch: false, animated: true, tokens: 'base', message: false },
    { fullsize: true, stretch: false, animated: false, tokens: 'base overlay', message: false },
    { fullsize: true, stretch: true, animated: true, tokens: 'base overlay', message: false },
    { fullsize: false, stretch: false, animated: false, tokens: 'base base', message: true },
    { fullsize: true, stretch: false, animated: true, tokens: 'base', message: true }
  ])(
    'renders configured options safely: %j',
    async (
      options: Readonly<{
        fullsize: boolean;
        stretch: boolean;
        animated: boolean;
        tokens: string;
        message: boolean;
      }>
    ) => {
      const base = {
        ...twitchToAsset({ id: 'id', name: 'base', format: ['static'], theme_mode: ['dark'] }),
        url: 'https://cdn.7tv.app/emote/01HQPVVAYR0007V5J7WCNKMP48/2x.webp'
      };
      const catalog = new EmoteCatalog(() => [
        [base, { ...base, id: 'overlay', name: 'overlay', zeroWidth: true }]
      ]);
      const targetGuild = { id: 'review', emoteCatalog: catalog } as unknown as Readonly<Guild>;
      const values: Readonly<Record<string, string | number | boolean>> = {
        emotes: options.tokens,
        ephemeral: true,
        ...(options.fullsize ? { size: 3 } : {})
      };
      const target = {
        id: interaction.id,
        guildId: 'review',
        user: { id: 'review' },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply,
        options: {
          get: (name: string): Readonly<{ value: string | number | boolean }> | null => {
            const value = values[name];
            return value === undefined ? null : { value };
          },
          getBoolean: (name: string): boolean =>
            name === 'fullsize' ? options.fullsize : options.stretch
        }
      } as unknown as ChatInputCommandInteraction;
      vi.mocked(downloadAsset).mockResolvedValue({
        filename: 'https://example.com/input.webp',
        width: 21,
        height: 21,
        frameCount: options.animated ? 10 : 1,
        animated: options.animated
      });
      vi.mocked(childProcess.spawn).mockImplementation(() => {
        queueMicrotask(() => child.emit('close', 0, null));
        return child as unknown as ReturnType<typeof childProcess.spawn>;
      });
      const reply = vi.fn().mockResolvedValue(undefined);
      const message = {
        id: interaction.id,
        author: { id: 'review' },
        content: '+' + options.tokens + (options.fullsize ? ' :fullSize' : ' :2'),
        reply
      } as unknown as OmitPartialGroupDMChannel<Message>;
      await emotesHandler(new CachedUrl(undefined))(
        targetGuild,
        [new User('review', undefined, true, '123456')],
        false,
        options.message ? undefined : target,
        options.message ? message : undefined
      );
      const [, args] = requireValue(
        vi.mocked(childProcess.spawn).mock.calls[0],
        'Expected render.'
      );
      expect(args).toContain('cache:https://example.com/input.webp');
      expect(args).toContain(options.animated ? 'libwebp_anim' : 'png');
      expect(options.message ? reply : editReply).toHaveBeenCalledOnce();
    }
  );

  test.each(['', 'missing', 'network', 'multiple'])(
    'invalid or unresolved emotes give feedback: %s',
    async (reason) => {
      const targetGuild = {
        id: 'review',
        emoteCatalog: new EmoteCatalog(() => [])
      } as unknown as Readonly<Guild>;
      const get = (name: string): Readonly<{ value: string }> | null =>
        name === 'emotes' || name === 'name' ?
          {
            value:
              reason === '' ? ''
              : reason === 'multiple' ? 'one two'
              : reason
          }
        : null;
      const target = {
        id: interaction.id,
        guildId: 'review',
        user: { id: 'review' },
        options: { get, getBoolean: (): null => null },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply
      } as unknown as ChatInputCommandInteraction;
      if (reason === 'network')
        vi.mocked(parseToken).mockRejectedValueOnce(new Error('provider unavailable'));
      else vi.mocked(parseToken).mockResolvedValue(undefined);
      await emotesHandler(new CachedUrl(undefined))(targetGuild, [], reason === 'multiple', target);
      expect(editReply).toHaveBeenCalledWith(
        reason === 'network' ? 'Failed to download or get emoji(s).'
        : reason === 'multiple' ? 'Please use /emote-compose for combined emotes.'
        : 'emote not found'
      );
      expect(childProcess.spawn).not.toHaveBeenCalled();
    }
  );

  test.each([
    { width: 0 },
    { width: 1.5 },
    { height: 0 },
    { height: 1.5 },
    { frameCount: 0 },
    { frameCount: 1.5 }
  ])(
    'invalid downloaded metadata is rejected: %j',
    async (invalid: Readonly<{ width?: number; height?: number; frameCount?: number }>) => {
      vi.mocked(downloadAsset).mockResolvedValue({
        filename: 'input.png',
        width: 20,
        height: 20,
        frameCount: 1,
        animated: false,
        ...invalid
      });
      await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
      expect(editReply).toHaveBeenCalledWith('failed to download gif(s)/png(s)');
      expect(childProcess.spawn).not.toHaveBeenCalled();
    }
  );

  test.each(['empty', 'missing', 'network'])(
    'message emote fallback handles %s input',
    async (reason) => {
      const targetGuild = {
        id: 'review',
        emoteCatalog: new EmoteCatalog(() => [])
      } as unknown as Guild;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);
      const message = {
        id: interaction.id,
        author: { id: 'review' },
        content: reason === 'empty' ? '+' : '+missing',
        reply,
        react
      } as unknown as OmitPartialGroupDMChannel<Message>;
      if (reason === 'network') vi.mocked(parseToken).mockRejectedValueOnce(new Error('offline'));
      else vi.mocked(parseToken).mockResolvedValue(undefined);
      await emotesHandler(new CachedUrl(undefined))(targetGuild, [], false, undefined, message);
      if (reason === 'missing') expect(react).toHaveBeenCalledWith('❌');
      else expect(reply).toHaveBeenCalledOnce();
      expect(childProcess.spawn).not.toHaveBeenCalled();
    }
  );

  test.each(['interaction', 'message'])(
    'render capacity is bounded and released for %s requests',
    async (kind) => {
      const gate = Promise.withResolvers<{
        filename: string;
        width: number;
        height: number;
        frameCount: number;
        animated: boolean;
      }>();
      vi.mocked(downloadAsset).mockReturnValue(gate.promise);
      vi.mocked(childProcess.spawn).mockImplementation(() => {
        const renderer = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
        queueMicrotask(() => {
          renderer.emit('close', 0, null);
          renderer.stderr.destroy();
        });
        return renderer as unknown as ReturnType<typeof childProcess.spawn>;
      });
      const requests = Array.from({ length: 4 }, (_, index) => {
        const reply = vi.fn().mockResolvedValue(undefined);
        return {
          reply,
          value: {
            id: interaction.id + '-' + index.toString(),
            guildId: 'review',
            user: { id: 'review' },
            options: {
              get: (name: string): Readonly<{ value: string }> | null =>
                name === 'emotes' ? { value: 'example' } : null,
              getBoolean: (): null => null
            },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: reply
          } as unknown as ChatInputCommandInteraction
        };
      });
      const first = requireValue(requests[0], 'Expected request.');
      const second = requireValue(requests[1], 'Expected request.');
      const render = emotesHandler(new CachedUrl(undefined));
      const pending = [
        render(guild, [], false, first.value),
        render(guild, [], false, second.value)
      ];
      try {
        await vi.waitFor(() => {
          expect(downloadAsset).toHaveBeenCalledTimes(2);
        });
        const busy = requireValue(requests[2], 'Expected busy request.');
        const message = {
          id: busy.value.id,
          content: '+example',
          author: { id: 'review' },
          reply: busy.reply
        } as unknown as OmitPartialGroupDMChannel<Message>;
        await emotesHandler(new CachedUrl(undefined))(
          guild,
          [],
          false,
          kind === 'interaction' ? busy.value : undefined,
          kind === 'message' ? message : undefined
        );
        expect(busy.reply).toHaveBeenCalledWith(
          kind === 'interaction' ?
            'The emote renderer is busy. Please try again shortly.'
          : {
              content: 'The emote renderer is busy. Please try again shortly.',
              allowedMentions: { repliedUser: false }
            }
        );
        expect(downloadAsset).toHaveBeenCalledTimes(2);
      } finally {
        gate.resolve({
          filename: 'input.png',
          width: 20,
          height: 20,
          frameCount: 1,
          animated: false
        });
        await Promise.all(pending);
      }
      const after = requireValue(requests[3], 'Expected subsequent request.');
      await emotesHandler(new CachedUrl(undefined))(guild, [], false, after.value);
      expect(downloadAsset).toHaveBeenCalledTimes(3);
      expect(childProcess.spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array), {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120_000,
        killSignal: 'SIGKILL'
      });
    }
  );

  test.each(['interaction', 'message'])(
    'oversized %s compositions stop before downloads or rendering',
    async (kind) => {
      const tokens = Array.from({ length: 33 }, () => 'example').join(' ');
      const reply = vi.fn().mockResolvedValue(undefined);
      const target = {
        id: interaction.id,
        user: { id: 'review' },
        options: { get: (): Readonly<{ value: string }> => ({ value: tokens }) },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: reply
      } as unknown as ChatInputCommandInteraction;
      const message = {
        id: interaction.id,
        content: '+' + tokens,
        author: { id: 'review' },
        reply
      } as unknown as OmitPartialGroupDMChannel<Message>;
      await emotesHandler(new CachedUrl(undefined))(
        guild,
        [],
        false,
        kind === 'interaction' ? target : undefined,
        kind === 'message' ? message : undefined
      );
      expect(reply).toHaveBeenCalledWith(
        kind === 'interaction' ?
          'Please request at most 32 emotes at once.'
        : {
            content: 'Please request at most 32 emotes at once.',
            allowedMentions: { repliedUser: false }
          }
      );
      expect(downloadAsset).not.toHaveBeenCalled();
      expect(childProcess.spawn).not.toHaveBeenCalled();
    }
  );
  test.each([
    ['use7TVGlobalEmotes', 'sevenInSet', false],
    ['use7TVPersonalEmotes', 'sevenInSet', true],
    ['use7TVAddedEmotes', 'sevenNotInSet', false]
  ] as const)(
    'renders %s independently of the other 7TV switches',
    async (setting, platform, personal) => {
      providerSettings.use7TVGlobalEmotes = false;
      providerSettings.use7TVPersonalEmotes = false;
      providerSettings.use7TVAddedEmotes = false;
      providerSettings[setting] = true;
      asset.platform = platform;
      asset.isSevenTVPersonal = personal;
      try {
        vi.mocked(childProcess.spawn).mockImplementation(() => {
          queueMicrotask(() => child.emit('close', 0, null));
          return child as unknown as ReturnType<typeof childProcess.spawn>;
        });
        await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
        expect(downloadAsset).toHaveBeenCalledOnce();
        expect(editReply).toHaveBeenCalledWith({ files: [join(directory, 'botgeEmote.png')] });
      } finally {
        providerSettings.use7TVGlobalEmotes = true;
        providerSettings.use7TVPersonalEmotes = true;
        providerSettings.use7TVAddedEmotes = true;
        asset.platform = 'sevenInSet';
        asset.isSevenTVPersonal = false;
      }
    }
  );
  test('disabled provider assets cannot reach the downloader or renderer', async () => {
    providerSettings.use7TVGlobalEmotes = false;
    try {
      await emotesHandler(new CachedUrl(undefined))(guild, [], false, interaction);
      expect(downloadAsset).not.toHaveBeenCalled();
      expect(childProcess.spawn).not.toHaveBeenCalled();
      expect(editReply).toHaveBeenCalledWith('Failed to download or get emoji(s).');
    } finally {
      providerSettings.use7TVGlobalEmotes = true;
    }
  });
});
