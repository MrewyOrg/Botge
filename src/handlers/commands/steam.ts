// cspell:words KHTML

import type { ChatInputCommandInteraction } from 'discord.js';

import { requestResponse } from '../../api/http.ts';
import { type Guild, GUILD_ID_CUTEDOG } from '../../discord/guild.ts';
import { logError } from '../../utils/log-error.ts';
import { isRecord } from '../../utils/validation.ts';

function getColor(percent: number): string {
  if (percent <= 39)
    return '\u001b[31m'; // red
  else if (percent <= 69)
    return '\u001b[33m'; // yellow
  else return '\u001b[34m'; // blue
}

function getReviewLabel(percent: number): string {
  if (percent <= 19) return '(Overwhelmingly Negative)';
  if (percent <= 39) return '(Mostly Negative)';
  if (percent <= 69) return '(Mixed)';
  if (percent <= 79) return '(Mostly Positive)';
  if (percent <= 94) return '(Very Positive)';
  return '(Overwhelmingly Positive)';
}

function numberWithCommas(x: number): string {
  return x.toString().replace(/\B(?=(?<triplet>\d{3})+(?!\d))/gu, ',');
}

const RECENT_REVIEW_REGEX =
  /(?<percent>[0-9]+)% of the (?<count>[0-9,]+) user reviews in the last 30 days are positive\./u;
const ALL_REVIEWS_REGEX =
  /(?<percent>[0-9]+)% of the (?<count>[0-9,]+) user reviews for this game are positive\./u;

export function steamHandler(gameId: string) {
  return async function (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> {
    const defer = interaction.deferReply();
    try {
      const headers = { 'Accept-Language': 'en-US,en;q=0.9' };
      const [store, players] = await Promise.all([
        requestResponse(`https://store.steampowered.com/app/${gameId}`, { headers }),
        requestResponse(
          `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${gameId}`,
          { headers }
        )
      ]);
      const [storeHtml, playerData] = await Promise.all([
        store.text(),
        players.json().then((value: unknown): unknown => value)
      ]);
      const recentReviewsMatch = RECENT_REVIEW_REGEX.exec(storeHtml);
      const allReviewsMatch = ALL_REVIEWS_REGEX.exec(storeHtml);
      if (
        !isRecord(playerData)
        || !isRecord(playerData['response'])
        || typeof playerData['response']['player_count'] !== 'number'
        || !Number.isFinite(playerData['response']['player_count'])
      )
        throw new Error('Invalid Steam player count response.');
      const playerCount = playerData['response']['player_count'];

      const [, recentPercent, recentCount] = recentReviewsMatch ?? [];
      const [, allPercent, allCount] = allReviewsMatch ?? [];
      if (
        recentPercent === undefined
        || recentCount === undefined
        || allPercent === undefined
        || allCount === undefined
      )
        throw new Error('Steam review summaries were not found.');

      const recentReviewsPercent = parseInt(recentPercent, 10);
      const allReviewsPercent = parseInt(allPercent, 10);

      const recentReviewsColor = getColor(recentReviewsPercent);
      const allReviewsColor = getColor(allReviewsPercent);
      const recentReviewsLabel = getReviewLabel(recentReviewsPercent);
      const allReviewsLabel = getReviewLabel(allReviewsPercent);
      const reset = '\u001b[0m';

      const replyText =
        '```ansi\n'
        + `RECENT REVIEWS: \u001b[1m${recentReviewsColor}${recentReviewsPercent}% ${recentReviewsLabel}\u001b[0m ${reset} (${recentCount})\n`
        + `ALL REVIEWS: \u001b[1m${allReviewsColor}${allReviewsPercent}% ${allReviewsLabel}\u001b[0m ${reset} (${allCount})\n`
        + `PLAYERS RIGHT NOW: \u001b[1m\u001b[32m${numberWithCommas(playerCount)}\u001b[0m\n` // Player count bold and green
        + '```'
        + (guild.id === GUILD_ID_CUTEDOG ?
          "\n-# Disclaimer: This CuteDog_ server is filled with a bunch of sad man-children who would rather waste time bot-checking a game's Steam rating than actually getting better at the game itself."
        : '');

      await defer;
      await interaction.editReply(replyText);
    } catch (error) {
      logError(error, 'Error at steamHandler');

      await defer;
      await interaction.editReply('something went wrong.');
    }
  };
}
