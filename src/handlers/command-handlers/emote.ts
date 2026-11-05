/** @format */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { rm } from 'node:fs/promises';

import type { ChatInputCommandInteraction, OmitPartialGroupDMChannel, Message } from 'discord.js';

import {
  maxPlatformSize,
  assetSizeChange
} from '../../utils/handlers/command-handlers/emote/size-change.ts';
import { downloadAsset } from '../../utils/handlers/command-handlers/emote/download-asset.ts';
import { parseToken } from '../../utils/handlers/command-handlers/emote/parse-token.ts';
import {
  getOptionValue,
  getOptionValueWithoutUndefined
} from '../../utils/public/get-option-value.ts';
import { stringToPlatform } from '../../utils/public/platform-to-string.ts';
import { stringToBoolean } from '../../utils/public/boolean-to-string.ts';
import { logError } from '../../utils/public/log-error.ts';
import type { CachedUrl } from '../../api/cached-url.ts';
import { EmoteMessageBuilder } from '../../modules/message-builders/emote-message-builder.ts';
import type { AssetInfo, DownloadedAsset } from '../../types.ts';
import { TMP_DIR } from '../../directory-paths.ts';
import { GUILD_ID_CUTEDOG, type Guild } from '../../modules/discord/guild.ts';
import type { User } from '../../modules/discord/user.ts';

export const EMOTE_COMMAND_IDENTIFIER = '+' as const;
const EMOTE_SIZE_IDENTIFIER = ':' as const;

const DEFAULT_FPS = 20 as const;
const MAXWIDTH = 192 as const;
const MAXHEIGHT = 64 as const;
const DOWNLOAD_ASSET_ERROR_MESSAGE = 'Failed to download asset(s).' as const;
const FAILED_TO_DOWNLOAD_OR_GET_EMOJI_MESSAGE = 'Failed to download or get emoji(s).' as const;
const SOMETHING_WENT_WRONG_REPLY_MESSAGE = 'Something went wrong. Please try again later.' as const;

function getMaxWidth(layers: readonly DownloadedAsset[], scaleToHeight: number): number {
  const scaledWidth = layers.map((layer) => (layer.width / layer.height) * scaleToHeight);

  const ret = Math.round(Math.max(...scaledWidth));
  return ret % 2 === 0 ? ret : ret + 1; // rounds up to even number because of ffmpeg
}

type HorizontalStackElement = { readonly id: number; readonly filterString: () => string };

class SimpleElement implements HorizontalStackElement {
  readonly #id: number;
  readonly #asset: DownloadedAsset;
  readonly #width: number;
  readonly #height: number;
  readonly #animated: boolean;
  readonly #borderColor: string | undefined = undefined;
  readonly #stopDuration: string | undefined = undefined;
  // readonly #borderOpacity: string | undefined = undefined;

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
    this.#animated = this.#asset.animated;

    if (borderColor !== undefined) this.#borderColor = borderColor;
    // if (borderOpacity !== undefined) this.#borderOpacity = borderOpacity;

    if (stopDuration !== undefined) this.#stopDuration = stopDuration;
  }

  public get id(): number {
    return this.#id;
  }

  public filterString(): string {
    let filterString = `[${this.#id}:v]`;

    if (this.#height > this.#asset.height)
      filterString += `pad=h=${this.#height}:x=-1:y=-1:color=black@0.0,`;
    filterString += `scale=${this.#width}:${this.#height}:force_original_aspect_ratio=decrease`;
    if (this.#borderColor !== undefined) {
      filterString += `,pad=iw+8:ih+8:4:4:color=#${this.#borderColor}`;

      // if (this.#borderOpacity !== undefined) filterString += `@${this.#borderOpacity}`;
    }
    if (this.#animated) filterString += `,loop=-1:${this.#asset.frameCount}`;
    if (this.#animated) filterString += `,settb=1/${DEFAULT_FPS},setpts=N`;
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
      width !== MAXWIDTH ? width : Math.min(getMaxWidth(this.#layers, this.#height), MAXWIDTH);
  }

  public get id(): number {
    return this.#id;
  }

  public filterString(): string {
    const segments: string[] = [];
    let id = this.#id;
    let layerId = 0;

    segments.push(`[${this.#id}]`);

    // ! pad second because scale doesn't keep transparency
    segments.push(`scale=${this.#width}:${this.#height}:force_original_aspect_ratio=decrease`);
    if (this.#height > this.#layers[layerId].height && this.#width > this.#layers[layerId].width)
      segments.push(`,pad=${this.#width}:${this.#height}:x=-1:y=-1:color=black@0.0`);
    else if (this.#height > this.#layers[layerId].height)
      segments.push(`,pad=h=${this.#height}:x=-1:y=-1:color=black@0.0`);
    else if (this.#width > this.#layers[layerId].width)
      segments.push(`,pad=w=${this.#width}:x=-1:y=-1:color=black@0.0`);

    if (this.#layers[layerId].animated)
      segments.push(`,loop=-1:${this.#layers[layerId].frameCount}`);
    if (this.#layers[layerId].animated) segments.push(`,settb=1/${DEFAULT_FPS},setpts=N`);

    segments.push(`[o${this.#id}];`);

    id++;
    layerId++;

    // other layers
    this.#layers.slice(1).forEach(() => {
      const segmentWidth =
        this.#stretch ? this.#width
        : this.#fullSize ? this.#layers[layerId].width
        : -1;
      const segmentHeight =
        this.#stretch ? this.#height
        : this.#fullSize ? this.#layers[layerId].height
        : MAXHEIGHT;

      segments.push(`[${id}]`);

      segments.push(`scale=${segmentWidth}:${segmentHeight}`);
      if (this.#layers[layerId].animated)
        segments.push(`,loop=-1:${this.#layers[layerId].frameCount}`);
      if (this.#layers[layerId].animated) segments.push(`,settb=1/${DEFAULT_FPS},setpts=N`);

      segments.push(`[v${id}];`);

      segments.push(`[o${this.#id}][v${id}]overlay=(W-w)/2:(H-h)/2[o${this.#id}];`);

      id++;
      layerId++;
    });

    return segments.join('');
  }
}

function onlyUnique(value: string, index: number, array: readonly string[]): boolean {
  return array.indexOf(value) === index;
}

export function emoteListHandler(emoteMessageBuilders: Readonly<EmoteMessageBuilder>[]) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    const { emoteMatcher } = guild;
    const defer = interaction.deferReply();
    try {
      const emoteNotFoundReply =
        interaction.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'emote not found';

      const query = getOptionValue<string>(interaction, 'query');
      const platform = getOptionValue(interaction, 'platform', stringToPlatform);
      const animated = getOptionValue(interaction, 'animated', stringToBoolean);
      const zeroWidth = getOptionValue(interaction, 'overlaying', stringToBoolean);

      const matches = emoteMatcher.matchSingleArray(
        query ?? '',
        platform,
        animated,
        zeroWidth,
        undefined,
        true
      );

      if (matches === undefined) {
        await defer;
        await interaction.editReply(emoteNotFoundReply);
        return;
      }

      /*
      const transformedMatches: readonly AssetInfo[] = matches.map((asset) => ({
        ...asset,
        url: asset.url.replace('.gif', '.webp')
      }));
      */

      const emoteMessageBuilder = new EmoteMessageBuilder(interaction, matches);
      const reply = emoteMessageBuilder.first();
      await defer;

      if (reply === undefined) return undefined;
      await interaction.editReply(reply);
      emoteMessageBuilders.push(emoteMessageBuilder);
      return;
    } catch (error) {
      logError(error, 'Error at emoteListHandler');

      await defer;
      await interaction.editReply(SOMETHING_WENT_WRONG_REPLY_MESSAGE);
      return;
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
    const { emoteMatcher } = guild;

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

    try {
      const emoteNotFoundReply =
        interaction?.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'emote not found';

      const sizeRegExp = new RegExp(`\\s*${EMOTE_SIZE_IDENTIFIER}\\s*[1-4]`, 'g');
      const fullSizeRegExp = new RegExp(`\\s*${EMOTE_SIZE_IDENTIFIER}\\s*fullSize`, 'gi');
      const mentionRegExp = /\s*<@\d{18,19}>/g;

      const emotes = ((): readonly string[] => {
        if (interaction !== undefined) {
          return getOptionValueWithoutUndefined<string>(
            interaction,
            isSlashEmote ? 'name' : 'emotes'
          ).split(/\s+/);
        } else if (message !== undefined) {
          const emotes_: readonly string[] = message.content
            .trim()
            .replaceAll(sizeRegExp, '')
            .replaceAll(fullSizeRegExp, '')
            .replaceAll(mentionRegExp, '')
            .slice(EMOTE_COMMAND_IDENTIFIER.length)
            .split(/\s+/);

          return emotes_;
        }

        throw new Error('Interaction and Message undefined.');
      })();

      if (emotes.length > 1 && isSlashEmote) {
        await defer;
        await interaction?.editReply('Please use /emotes for combined emotes.');
        return;
      }

      const size = ((): number | undefined => {
        if (interaction !== undefined) {
          return getOptionValue(interaction, 'size', Number);
        } else if (message !== undefined) {
          const message_ = message.content
            .trim()
            .replaceAll(fullSizeRegExp, '')
            .replaceAll(mentionRegExp, '');
          const exec_ = sizeRegExp.exec(message_);

          if (exec_ === null) return undefined;
          return Number(exec_[0].trim().replace(EMOTE_SIZE_IDENTIFIER, ''));
        }

        return undefined;
      })();
      const fullSize = ((): boolean => {
        if (interaction !== undefined) {
          if (isSlashEmote && size === 4) return true;
          return getOptionValue(interaction, 'fullsize', Boolean) ?? false;
        } else if (message !== undefined) {
          if (size !== undefined && size === 4) return true;

          return fullSizeRegExp.test(message.content.trim());
        }

        return false;
      })();
      const stretch =
        interaction !== undefined && !isSlashEmote ?
          (getOptionValue(interaction, 'stretch', Boolean) ?? false)
        : false;

      const userId =
        interaction !== undefined ? interaction.user.id
        : message !== undefined ? message.author.id
        : undefined;
      if (userId === undefined) throw new Error('Interaction and message both undefined.');

      const user = users.find((user_) => user_.id === userId);
      const enableEmoteBorder = user?.enableEmoteBorder !== undefined && user.enableEmoteBorder;
      const stopDuration = ((): string | undefined => {
        if (emotes.length !== 1) return undefined;

        const [emote] = emotes;
        const match = emoteMatcher.matchSingle(emote);

        if (match === undefined) return undefined;

        if (match.url === 'https://cdn.7tv.app/emote/01HQPVVAYR0007V5J7WCNKMP48/2x.webp')
          return '1.08';
        else if (match.url === 'https://cdn.7tv.app/emote/01GWBD2YR00002CCPRV6KPX758/2x.webp')
          return '0.40';
        return undefined;
      })();

      // dir sync only if multiple emotes
      ensureDirSync(outdir);

      const uniqueTokens: readonly string[] = emotes.filter(onlyUnique);
      const tokenPairs = ((): readonly (readonly [string, number])[] => {
        const tokenPairs_: (readonly [string, number])[] = [];

        for (const i of emotes.keys())
          for (const j of uniqueTokens.keys())
            if (emotes[i] === uniqueTokens[j]) tokenPairs_.push([emotes[i], j]);

        return tokenPairs_;
      })();

      const uniqueAssetsWithNullAndUndefined: readonly (AssetInfo | string | null | undefined)[] =
        await Promise.all(
          emoteMatcher.matchMulti(uniqueTokens).map(async (match, i) =>
            match !== undefined ?
              fullSize ? assetSizeChange(match, maxPlatformSize(match.platform))
              : size !== undefined ? assetSizeChange(match, size)
              : match
            : parseToken(uniqueTokens[i], fullSize).catch(() => null)
          )
        );

      if (uniqueAssetsWithNullAndUndefined.some((asset) => asset === null)) {
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
      if (uniqueAssetsWithNullAndUndefined.some((asset) => asset === undefined)) {
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

      const uniqueAssets: readonly (AssetInfo | string)[] = uniqueAssetsWithNullAndUndefined.filter(
        (asset) => asset !== null && asset !== undefined
      );

      const assets = ((): readonly (AssetInfo | string)[] => {
        const assets_: (AssetInfo | string)[] = [];

        for (const i of tokenPairs.keys()) {
          for (const j of uniqueAssets.keys()) {
            if (tokenPairs[i][1] === j) assets_.push(uniqueAssets[j]);
          }
        }

        return assets_;
      })();

      const downloadedAssets = await (async (): Promise<readonly DownloadedAsset[]> => {
        const downloadedAssets_: readonly DownloadedAsset[] = (
          await Promise.all(
            uniqueAssets.map(async (asset, i) => downloadAsset(outdir, asset, i, cachedUrl))
          )
        ).filter((downloadedAsset) => downloadedAsset !== undefined);
        const downloadedAssets2_: DownloadedAsset[] = [];

        for (const i of tokenPairs.keys()) {
          for (const j of downloadedAssets_.keys()) {
            if (tokenPairs[i][1] === j) downloadedAssets2_.push(downloadedAssets_[j]);
          }
        }

        return downloadedAssets2_;
      })();
      if (downloadedAssets.length !== assets.length) throw new Error(DOWNLOAD_ASSET_ERROR_MESSAGE);

      const maxHeight = ((): number => {
        const maxHeight_ = Math.max(...downloadedAssets.map((asset) => asset.height));
        return (
          fullSize ?
            maxHeight_ % 2 === 0 ?
              maxHeight_
            : maxHeight_ + 1
          : MAXHEIGHT
        );
      })();
      const maxWidth = fullSize ? getMaxWidth(downloadedAssets, maxHeight) : MAXWIDTH;

      const elements: HorizontalStackElement[] = [];
      ((): void => {
        if (assets.length === 1) {
          if (enableEmoteBorder)
            elements.push(
              new SimpleElement(
                0,
                downloadedAssets[0],
                maxWidth,
                maxHeight,
                user.emoteBorderColor,
                stopDuration
              )
            );
          else
            elements.push(
              new SimpleElement(
                0,
                downloadedAssets[0],
                maxWidth,
                maxHeight,
                undefined,
                stopDuration
              )
            );

          return;
        }

        // at least 2
        let boundary = 0;
        let i = 0;
        for (; i < downloadedAssets.length; i++) {
          const asset = assets[i];

          if ((typeof asset === 'object' && !asset.zeroWidth) || typeof asset === 'string') {
            // new group
            if (i === boundary + 1) {
              // single element
              elements.push(
                new SimpleElement(boundary, downloadedAssets[boundary], maxWidth, maxHeight)
              );
              boundary = i;
            } else if (i > boundary) {
              // at least 2
              elements.push(
                new OverlayElement(
                  boundary,
                  downloadedAssets.slice(boundary, i),
                  fullSize,
                  stretch,
                  maxWidth,
                  maxHeight
                )
              );
              boundary = i;
            }
          }
        }

        // don't forget last one
        if (i === boundary + 1) {
          // single element
          elements.push(
            new SimpleElement(boundary, downloadedAssets[boundary], maxWidth, maxHeight)
          );
        } else if (i > boundary) {
          // at least 2
          elements.push(
            new OverlayElement(
              boundary,
              downloadedAssets.slice(boundary, i),
              fullSize,
              stretch,
              maxWidth,
              maxHeight
            )
          );
        }
      })();

      const maxFrameCount = Math.max(...downloadedAssets.map((layer) => layer.frameCount));
      const animated = downloadedAssets.some((asset) => asset.animated);

      const args: string[] = [];

      downloadedAssets.forEach((asset) => {
        /*
        if (animated && asset.animated) {
          args.push('-stream_loop');
          args.push('-1');
          args.push('-t');
          args.push(`${maxDuration}`);
        }
        */

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

        if (enableEmoteBorder) filter.push(`,pad=iw+8:ih+8:4:4:color=#${user.emoteBorderColor}`);
      } else {
        filter.push(`[o0]scale`);
      }

      /*
      if (animated)
        filter.push(',split=2[stacked][palette];[palette]palettegen[p];[stacked][p]paletteuse');
      */
      args.push(filter.join(''));

      if (animated) {
        args.push('-frames:v');
        args.push(maxFrameCount.toString());
      }

      args.push('-c:v');
      if (animated) {
        args.push('libwebp_anim');
        args.push('-loop');
        args.push('0');
      } else {
        args.push('libwebp');
      }

      args.push('-y');
      args.push('-fs');
      args.push('25M');

      const outfile = join(outdir, `botgeEmote.${animated ? 'webp' : 'png'}`);
      args.push(outfile);

      const ffmpeg = spawn('ffmpeg', args);

      console.log("ffmpeg '" + args.join("' '") + "'");

      ffmpeg.on(
        'close',
        (() => {
          // Here you can get the exit code of the script
          return async function (code: number): Promise<void> {
            await defer;

            if (code === 0) {
              if (interaction !== undefined) await interaction.editReply({ files: [outfile] });
              else if (message !== undefined)
                await message.reply({ files: [outfile], allowedMentions: { repliedUser: false } });
            } else {
              if (interaction !== undefined) await interaction.editReply('gif creation failed');
              else if (message !== undefined)
                await message.reply({
                  content: 'gif creation failed',
                  allowedMentions: { repliedUser: false }
                });
            }

            void rm(outdir, { recursive: true });
          };
        })()
      );

      // ? await defer;
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
      void rm(outdir, { recursive: true });
    }
  };
}
