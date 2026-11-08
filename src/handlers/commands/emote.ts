// cspell:words hstack lanczos libwebp nostdin setsar settb tpad

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChatInputCommandInteraction, Message, OmitPartialGroupDMChannel } from 'discord.js';

import type { CachedUrl } from '../../api/cached-url.ts';
import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import { botgeConfig } from '../../config/botge-config.ts';
import { TMP_DIR } from '../../config/directory-paths.ts';
import { stringToBoolean } from '../../discord/boolean-labels.ts';
import { SLASH_COMMAND_NAMES } from '../../discord/command-names.ts';
import { getOptionValue, getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import { type Guild, GUILD_ID_CUTEDOG } from '../../discord/guild.ts';
import type { User } from '../../discord/user.ts';
import { stringToPlatform } from '../../emotes/platforms.ts';
import { isEmoteEnabled } from '../../emotes/provider-policy.ts';
import { downloadAsset } from '../../emotes/rendering/download-asset.ts';
import { parseToken } from '../../emotes/rendering/parse-token.ts';
import { assetSizeChange, maxPlatformSize } from '../../emotes/rendering/size-change.ts';
import { EmoteMessageBuilder } from '../../message-builders/emote-message-builder.ts';
import type { AssetInfo, DownloadedAsset, MutableArray } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';
import { requireValue } from '../../utils/validation.ts';

export const EMOTE_COMMAND_IDENTIFIER = '+' as const;
const EMOTE_SIZE_IDENTIFIER = ':' as const;

const DEFAULT_FPS = 20 as const;
const MAX_WIDTH = 192 as const;
const MAX_HEIGHT = 64 as const;
const DOWNLOAD_ASSET_ERROR_MESSAGE = 'Failed to download asset(s).' as const;
const FAILED_TO_DOWNLOAD_OR_GET_EMOJI_MESSAGE = 'Failed to download or get emoji(s).' as const;
const SOMETHING_WENT_WRONG_REPLY_MESSAGE = 'Something went wrong. Please try again later.' as const;
const MAX_FFMPEG_STDERR_LENGTH = 16_384 as const;
const MAX_ACTIVE_RENDERS = 2;
const MAX_RENDER_TOKENS = 32;
let activeRenders = 0;

function getMaxWidth(layers: readonly DownloadedAsset[], scaleToHeight: number): number {
  const scaledWidth = layers.map((layer) => (layer.width / layer.height) * scaleToHeight);

  const roundedWidth = Math.max(1, Math.round(Math.max(...scaledWidth)));
  return roundedWidth % 2 === 0 ? roundedWidth : roundedWidth + 1; // rounds up to even number because of ffmpeg
}

type HorizontalStackElement = { readonly id: number; readonly filterString: () => string };

class SimpleElement implements HorizontalStackElement {
  readonly #id: number;
  readonly #asset: DownloadedAsset;
  readonly #width: number;
  readonly #height: number;
  readonly #borderColor: string | undefined = undefined;
  readonly #stopDuration: string | undefined = undefined;

  public constructor(
    id: number,
    asset: DownloadedAsset,
    width: number,
    height: number,
    borderColor?: string,
    stopDuration?: string
  ) {
    this.#id = id;
    this.#asset = asset;
    this.#width = width;
    this.#height = height;

    if (borderColor !== undefined) this.#borderColor = borderColor;

    if (stopDuration !== undefined) this.#stopDuration = stopDuration;
  }

  public get id(): number {
    return this.#id;
  }

  public filterString(): string {
    let filterString = `[${this.#id}:v]format=rgba,`;

    if (this.#height > this.#asset.height)
      filterString += `pad=h=${this.#height}:x=-1:y=-1:color=black@0.0,`;
    filterString += `scale=${this.#width}:${this.#height}:force_original_aspect_ratio=decrease:flags=lanczos`;
    filterString += `,pad=h=${this.#height}:x=-1:y=-1:color=black@0.0,setsar=1`;
    if (this.#borderColor !== undefined) {
      filterString += `,pad=iw+8:ih+8:4:4:color=#${this.#borderColor}`;
    }
    // Static layers must keep producing frames when combined with animations.
    filterString += `,loop=-1:${this.#asset.frameCount},settb=1/${DEFAULT_FPS},setpts=N`;
    if (this.#stopDuration !== undefined)
      filterString += `,tpad=stop_mode=clone:stop_duration=${this.#stopDuration}`;

    filterString += `[o${this.#id}];`;
    return filterString;
  }
}

class OverlayElement implements HorizontalStackElement {
  readonly #id: number;
  readonly #layers: readonly DownloadedAsset[];
  readonly #fullSize: boolean;
  readonly #stretch: boolean;
  readonly #height: number;
  readonly #width: number;

  public constructor(
    id: number,
    layers: readonly DownloadedAsset[],
    fullSize: boolean,
    stretch: boolean,
    width: number,
    height: number
  ) {
    this.#id = id;
    this.#layers = layers;
    this.#fullSize = fullSize;
    this.#stretch = stretch;

    this.#height = height;
    this.#width =
      width !== MAX_WIDTH ? width : Math.min(getMaxWidth(this.#layers, this.#height), MAX_WIDTH);
  }

  public get id(): number {
    return this.#id;
  }

  public filterString(): string {
    const segments: string[] = [];
    const [baseLayer, ...overlays] = this.#layers;
    if (baseLayer === undefined) throw new Error('An overlay must contain at least one layer.');

    segments.push(`[${this.#id}:v]format=rgba,`);

    segments.push(
      `scale=${this.#width}:${this.#height}:force_original_aspect_ratio=decrease:flags=lanczos`
    );
    segments.push(`,pad=${this.#width}:${this.#height}:x=-1:y=-1:color=black@0.0,setsar=1`);
    segments.push(`,loop=-1:${baseLayer.frameCount},settb=1/${DEFAULT_FPS},setpts=N`);

    segments.push(`[o${this.#id}];`);

    for (const [index, layer] of overlays.entries()) {
      const id = this.#id + index + 1;
      const segmentWidth =
        this.#stretch ? this.#width
        : this.#fullSize ? layer.width
        : -1;
      const segmentHeight =
        this.#stretch ? this.#height
        : this.#fullSize ? layer.height
        : MAX_HEIGHT;

      segments.push(`[${id}:v]format=rgba,`);

      segments.push(`scale=${segmentWidth}:${segmentHeight}:flags=lanczos,setsar=1`);
      segments.push(`,loop=-1:${layer.frameCount},settb=1/${DEFAULT_FPS},setpts=N`);

      segments.push(`[v${id}];`);

      segments.push(
        `[o${this.#id}][v${id}]overlay=(W-w)/2:(H-h)/2:format=auto:eval=init[o${this.#id}];`
      );
    }

    return segments.join('');
  }
}

type RenderOptions = {
  readonly fullSize: boolean;
  readonly stretch: boolean;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly borderColor: string | undefined;
  readonly stopDuration: string | undefined;
};

/** Normal emotes start columns; zero-width emotes overlay the preceding column's base. */
function createRenderElements(
  assets: readonly (AssetInfo | string)[],
  downloaded: readonly DownloadedAsset[],
  options: RenderOptions
): readonly HorizontalStackElement[] {
  if (assets.length === 0 || assets.length !== downloaded.length)
    throw new Error('Source and downloaded emote assets must align.');
  const { fullSize, stretch, maxWidth, maxHeight, borderColor, stopDuration } = options;
  if (assets.length === 1) {
    return [
      new SimpleElement(
        0,
        requireValue(downloaded[0], DOWNLOAD_ASSET_ERROR_MESSAGE),
        maxWidth,
        maxHeight,
        borderColor,
        stopDuration
      )
    ];
  }

  const elements: HorizontalStackElement[] = [];
  function appendGroup(start: number, end: number): void {
    if (end - start === 1) {
      elements.push(
        new SimpleElement(
          start,
          requireValue(downloaded[start], DOWNLOAD_ASSET_ERROR_MESSAGE),
          maxWidth,
          maxHeight
        )
      );
    } else {
      elements.push(
        new OverlayElement(
          start,
          downloaded.slice(start, end),
          fullSize,
          stretch,
          maxWidth,
          maxHeight
        )
      );
    }
  }

  let boundary = 0;
  for (const [index, asset] of assets.entries()) {
    if (index > boundary && (typeof asset === 'string' || !asset.zeroWidth)) {
      appendGroup(boundary, index);
      boundary = index;
    }
  }
  appendGroup(boundary, assets.length);
  return elements;
}

export function emoteListHandler(
  emoteMessageBuilders: MutableArray<Readonly<EmoteMessageBuilder>>
) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    const { emoteCatalog } = guild;
    const defer = interaction.deferReply();
    try {
      const emoteNotFoundReply =
        interaction.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'emote not found';

      const query = getOptionValue(interaction, 'query');
      const platform = getOptionValue(interaction, 'platform', stringToPlatform);
      const animated = getOptionValue(interaction, 'animated', stringToBoolean);
      const zeroWidth = getOptionValue(interaction, 'overlaying', stringToBoolean);

      const matches = emoteCatalog.matchSingleArray(
        query ?? '',
        platform,
        animated,
        zeroWidth,
        undefined,
        true
      );

      if (matches === undefined || matches.length === 0) {
        await defer;
        await interaction.editReply(emoteNotFoundReply);
        return;
      }

      const emoteMessageBuilder = new EmoteMessageBuilder(interaction, matches);
      const reply = emoteMessageBuilder.first();
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(emoteMessageBuilders, emoteMessageBuilder);
    } catch (error) {
      logError(error, 'Error at emoteListHandler');

      await defer;
      await interaction.editReply(SOMETHING_WENT_WRONG_REPLY_MESSAGE);
    }
  };
}

export function emotesHandler(cachedUrl: Readonly<CachedUrl>) {
  return async (
    guild: Readonly<Guild>,
    users: readonly Readonly<User>[],
    isSlashEmote: boolean,
    interaction?: ChatInputCommandInteraction,
    message?: OmitPartialGroupDMChannel<Message>
  ): Promise<void> => {
    const { emoteCatalog } = guild;

    const ephemeral =
      interaction !== undefined && !isSlashEmote ?
        Boolean(interaction.options.get('ephemeral')?.value)
      : false;
    const defer =
      interaction !== undefined ?
        ephemeral ? interaction.deferReply({ flags: 'Ephemeral' })
        : interaction.deferReply()
      : undefined;
    const outdir = ((): string => {
      if (interaction !== undefined) return join(TMP_DIR, interaction.id);
      else if (message !== undefined) return join(TMP_DIR, message.id);

      throw new Error('Interaction and Message undefined.');
    })();

    let admitted = false;
    try {
      await defer;
      if (activeRenders >= MAX_ACTIVE_RENDERS) {
        const feedback = {
          content: 'The emote renderer is busy. Please try again shortly.',
          allowedMentions: { repliedUser: false }
        };
        if (interaction !== undefined) await interaction.editReply(feedback.content);
        else await message?.reply(feedback);
        return;
      }
      activeRenders++;
      admitted = true;

      const emoteNotFoundReply =
        interaction?.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'emote not found';

      const sizeRegExp = new RegExp(`\\s*${EMOTE_SIZE_IDENTIFIER}\\s*[1-4]`, 'gu');
      const fullSizeRegExp = new RegExp(`\\s*${EMOTE_SIZE_IDENTIFIER}\\s*fullSize`, 'giu');
      const mentionRegExp = /\s*<@\d{18,19}>/gu;

      const emotes = ((): readonly string[] => {
        if (interaction !== undefined) {
          return getOptionValueWithoutUndefined(interaction, isSlashEmote ? 'name' : 'emotes')
            .trim()
            .split(/\s+/u)
            .filter((emote) => emote !== '');
        } else if (message !== undefined) {
          const requestedEmotes: readonly string[] = message.content
            .trim()
            .replaceAll(sizeRegExp, '')
            .replaceAll(fullSizeRegExp, '')
            .replaceAll(mentionRegExp, '')
            .slice(EMOTE_COMMAND_IDENTIFIER.length)
            .split(/\s+/u)
            .filter((emote) => emote !== '');

          return requestedEmotes;
        }

        throw new Error('Interaction and Message undefined.');
      })();

      if (emotes.length === 0) {
        if (interaction !== undefined) await interaction.editReply(emoteNotFoundReply);
        else if (message !== undefined)
          await message.reply({
            content: emoteNotFoundReply,
            allowedMentions: { repliedUser: false }
          });
        return;
      }

      if (emotes.length > MAX_RENDER_TOKENS) {
        const feedback = {
          content: `Please request at most ${MAX_RENDER_TOKENS} emotes at once.`,
          allowedMentions: { repliedUser: false }
        };
        if (interaction !== undefined) await interaction.editReply(feedback.content);
        else await message?.reply(feedback);
        return;
      }

      if (emotes.length > 1 && isSlashEmote) {
        await defer;
        await interaction?.editReply(
          `Please use /${SLASH_COMMAND_NAMES.emotes} for combined emotes.`
        );
        return;
      }

      const size = ((): number | undefined => {
        if (interaction !== undefined) {
          return getOptionValue(interaction, 'size', Number);
        } else if (message !== undefined) {
          const sizeInput = message.content
            .trim()
            .replaceAll(fullSizeRegExp, '')
            .replaceAll(mentionRegExp, '');
          const sizeMatch = sizeRegExp.exec(sizeInput);

          if (sizeMatch === null) return undefined;
          return Number(sizeMatch[0].trim().replace(EMOTE_SIZE_IDENTIFIER, ''));
        }

        return undefined;
      })();
      const fullSize = ((): boolean => {
        if (interaction !== undefined) {
          if (isSlashEmote && size === 4) return true;
          return interaction.options.getBoolean('fullsize') ?? false;
        } else if (message !== undefined) {
          if (size !== undefined && size === 4) return true;

          return fullSizeRegExp.test(message.content.trim());
        }

        return false;
      })();
      const stretch =
        interaction !== undefined && !isSlashEmote ?
          (interaction.options.getBoolean('stretch') ?? false)
        : false;

      const userId =
        interaction !== undefined ? interaction.user.id
        : message !== undefined ? message.author.id
        : undefined;
      if (userId === undefined) throw new Error('Interaction and message both undefined.');

      const user = users.find((candidateUser) => candidateUser.id === userId);
      const enableEmoteBorder = user?.enableEmoteBorder !== undefined && user.enableEmoteBorder;
      const stopDuration = ((): string | undefined => {
        if (emotes.length !== 1) return undefined;

        const [emote] = emotes;
        if (emote === undefined) return undefined;
        const match = emoteCatalog.matchSingle(emote);

        if (match === undefined) return undefined;

        if (match.url === 'https://cdn.7tv.app/emote/01HQPVVAYR0007V5J7WCNKMP48/2x.webp')
          return '1.08';
        else if (match.url === 'https://cdn.7tv.app/emote/01GWBD2YR00002CCPRV6KPX758/2x.webp')
          return '0.40';
        return undefined;
      })();

      await mkdir(outdir, { recursive: true });

      const uniqueTokens = [...new Set(emotes)];
      const tokenIndexes = new Map(uniqueTokens.map((token, index) => [token, index]));
      const assetIndices = emotes.map((token) =>
        requireValue(tokenIndexes.get(token), 'Missing emote token index.')
      );

      const matches = emoteCatalog.matchMulti(uniqueTokens);
      // Failed fallback lookups use null; unmatched tokens use undefined.
      const assetResults: readonly (AssetInfo | string | null | undefined)[] = await Promise.all(
        uniqueTokens.map(async (token, index) => {
          const match = matches[index];
          if (match === undefined)
            return parseToken(token, fullSize, botgeConfig.general).catch(() => null);
          if (!isEmoteEnabled(match, botgeConfig.general)) return null;
          const requestedSize = fullSize ? maxPlatformSize(match.platform) : size;
          return requestedSize === undefined ? match : assetSizeChange(match, requestedSize);
        })
      );

      if (assetResults.some((asset) => asset === null)) {
        await defer;
        if (interaction !== undefined)
          await interaction.editReply(FAILED_TO_DOWNLOAD_OR_GET_EMOJI_MESSAGE);
        else if (message !== undefined)
          await message.reply({
            content: FAILED_TO_DOWNLOAD_OR_GET_EMOJI_MESSAGE,
            allowedMentions: { repliedUser: false }
          });
        return;
      }
      if (assetResults.some((asset) => asset === undefined)) {
        await defer;
        if (interaction !== undefined) await interaction.editReply(emoteNotFoundReply);
        else if (message !== undefined) {
          if (guild.id === GUILD_ID_CUTEDOG) {
            await message.react('<:HAH1:1236635745570127892>');
            await message.react('<:HAH2:1236635747449045003>');
            await message.react('<:HAH3:1236635749290610740>');
          } else await message.react('❌');
        }
        return;
      }

      const uniqueAssets: readonly (AssetInfo | string)[] = assetResults.filter(
        (asset) => asset !== null && asset !== undefined
      );

      const assets = assetIndices.map((index) =>
        requireValue(uniqueAssets[index], 'Missing resolved emote asset.')
      );

      // Keep remote reads and metadata probes bounded alongside the rendering slots.
      const uniqueDownloadedAssets: (DownloadedAsset | undefined)[] = [];
      for (const [index, asset] of uniqueAssets.entries()) {
        uniqueDownloadedAssets.push(
          await downloadAsset(outdir, asset, index, cachedUrl).catch((error: unknown) => {
            logError(error, 'Error downloading emote asset');
            return undefined;
          })
        );
      }
      if (!uniqueDownloadedAssets.every((asset) => asset !== undefined))
        throw new Error(DOWNLOAD_ASSET_ERROR_MESSAGE);
      if (
        uniqueDownloadedAssets.some(
          (asset) =>
            !Number.isInteger(asset.width)
            || asset.width <= 0
            || !Number.isInteger(asset.height)
            || asset.height <= 0
            || !Number.isInteger(asset.frameCount)
            || asset.frameCount <= 0
        )
      )
        throw new Error(DOWNLOAD_ASSET_ERROR_MESSAGE);

      const downloadedAssets: readonly DownloadedAsset[] = assetIndices.map((assetIndex) =>
        requireValue(uniqueDownloadedAssets[assetIndex], DOWNLOAD_ASSET_ERROR_MESSAGE)
      );

      const maxHeight = ((): number => {
        const assetMaxHeight = Math.max(...downloadedAssets.map((asset) => asset.height));
        return (
          fullSize ?
            assetMaxHeight % 2 === 0 ?
              assetMaxHeight
            : assetMaxHeight + 1
          : MAX_HEIGHT
        );
      })();
      const maxWidth = fullSize ? getMaxWidth(downloadedAssets, maxHeight) : MAX_WIDTH;

      const elements = createRenderElements(assets, downloadedAssets, {
        fullSize,
        stretch,
        maxWidth,
        maxHeight,
        borderColor: enableEmoteBorder ? user.emoteBorderColor : undefined,
        stopDuration
      });

      const maxFrameCount = Math.max(...downloadedAssets.map((layer) => layer.frameCount));
      const animated = downloadedAssets.some((asset) => asset.animated);

      const args: string[] = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-nostats',
        '-filter_complex_threads',
        '1'
      ];

      downloadedAssets.forEach((asset) => {
        args.push('-i');
        if (asset.filename.startsWith('http://') || asset.filename.startsWith('https://'))
          args.push('cache:' + asset.filename);
        else args.push(asset.filename);
      });

      args.push('-filter_complex');
      const filter: string[] = elements.map((element) => element.filterString());

      if (elements.length > 1) {
        filter.push(elements.map((element) => `[o${element.id}]`).join(''));
        filter.push(`hstack=inputs=${elements.length}`);
      } else {
        filter.push(`[o0]null`);
      }

      if (enableEmoteBorder && assets.length > 1)
        filter.push(`,pad=iw+8:ih+8:4:4:color=#${user.emoteBorderColor}`);
      filter.push(',setsar=1,format=rgba[out]');
      args.push(filter.join(''));

      args.push('-map', '[out]', '-map_metadata', '-1');
      args.push('-frames:v', animated ? maxFrameCount.toString() : '1');
      if (animated) {
        args.push('-r', DEFAULT_FPS.toString());
      }

      args.push('-c:v');
      if (animated) {
        args.push('libwebp_anim');
        args.push('-loop');
        args.push('0');
      } else {
        args.push('png');
      }

      args.push('-threads:v', '1');
      args.push('-y');
      args.push('-fs');
      args.push('25M');

      const outfile = join(outdir, `botgeEmote.${animated ? 'webp' : 'png'}`);
      args.push(outfile);

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 120_000,
          killSignal: 'SIGKILL'
        });
        let stderr = '';
        ffmpeg.stderr.setEncoding('utf8');
        ffmpeg.stderr.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-MAX_FFMPEG_STDERR_LENGTH);
        });
        ffmpeg.once('error', reject);
        ffmpeg.once('close', (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed (${signal ?? String(code)}): ${stderr}`));
        });
      });

      if (interaction !== undefined) await interaction.editReply({ files: [outfile] });
      else if (message !== undefined)
        await message.reply({ files: [outfile], allowedMentions: { repliedUser: false } });
    } catch (error) {
      logError(error, 'Error at emoteCombinedHandler');

      const editReplyMessage =
        error instanceof Error && error.message === DOWNLOAD_ASSET_ERROR_MESSAGE ?
          'failed to download gif(s)/png(s)'
        : 'gif creation failed.';

      await defer;
      if (interaction !== undefined) await interaction.editReply(editReplyMessage);
      else if (message !== undefined)
        await message.reply({ content: editReplyMessage, allowedMentions: { repliedUser: false } });
    } finally {
      if (admitted) activeRenders--;
      await rm(outdir, { recursive: true, force: true }).catch((error: unknown) => {
        logError(error, 'Error cleaning up emote files');
      });
    }
  };
}
