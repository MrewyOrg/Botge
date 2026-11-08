import { type ButtonInteraction, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

import { daysAndHoursAndMinutesToMilliseconds } from '../bot/ping-utils.ts';
import { booleanToString } from '../discord/boolean-labels.ts';
import type { PingForPingListMessageBuilderTransformFunctionReturnType } from '../types.ts';
import { BaseMessageBuilder } from './base.ts';
import { textToEmbedFields } from './embed-fields.ts';
import type { PingForPingMeMessageBuilder } from './ping-for-ping-me-message-builder.ts';

const UNKNOWN_USER = 'unknown user' as const;

export class PingForPingListMessageBuilder extends BaseMessageBuilder<
  Readonly<PingForPingMeMessageBuilder>,
  PingForPingListMessageBuilderTransformFunctionReturnType
> {
  static readonly #messageBuilderType = 'PingForPingList' as const;
  static #staticCounter = 0;
  readonly #markedAsDeletedArray: number[];

  public constructor(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    pingForPingMeMessageBuilders: readonly Readonly<PingForPingMeMessageBuilder>[],
    timezone: string | undefined
  ) {
    const transformFunction = (
      pingForPingMeMessageBuilder: Readonly<PingForPingMeMessageBuilder>
    ): PingForPingListMessageBuilderTransformFunctionReturnType => {
      const { ping } = pingForPingMeMessageBuilder;
      const { time, days, hours, minutes, message, userIdRemoved } = ping;

      const embed = new EmbedBuilder();
      if (this.#markedAsDeletedArray.includes(this.currentIndex))
        embed.setDescription('❌ DELETED ❌');

      const pingDate = ((): Date => {
        const scheduledDate = new Date(
          time + daysAndHoursAndMinutesToMilliseconds(days ?? 0, hours ?? 0, minutes ?? 0)
        );
        if (timezone === undefined) return scheduledDate;

        const match = /^(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2})$/u.exec(timezone);
        if (match?.groups === undefined) throw new Error('Invalid timezone offset.');
        const offsetHours = Number(match.groups['hours']);
        const offsetMinutesPart = Number(match.groups['minutes']);
        if (offsetHours > 23 || offsetMinutesPart > 59) throw new Error('Invalid timezone offset.');
        const offsetMinutes =
          (offsetHours * 60 + offsetMinutesPart) * (match.groups['sign'] === '-' ? -1 : 1);
        scheduledDate.setTime(scheduledDate.getTime() + offsetMinutes * 60_000);

        return scheduledDate;
      })();

      const { userId, channelId, userIds } = ping;
      const channelName = interaction.guild?.channels.cache.find(
        (candidateChannel: Readonly<{ id: string }>) => candidateChannel.id === channelId
      )?.name;
      const userIdDisplayName = interaction.guild?.members.cache.find(
        (candidateMember: Readonly<{ id: string }>) => candidateMember.id === userId
      )?.displayName;
      const userIdsDisplayNamesJoined = (
        userIds !== null ?
          userIds.map(
            (recipientId) =>
              interaction.guild?.members.cache.find(
                (candidateMember: Readonly<{ id: string }>) => candidateMember.id === recipientId
              )?.displayName ?? UNKNOWN_USER
          )
        : []).join(', ');

      embed
        .setColor('DarkButNotBlack')
        .setTitle(
          `${pingDate.toUTCString().replace('GMT', `UTC${timezone ?? ''}`)} by ${userIdDisplayName ?? UNKNOWN_USER}`
        )
        .addFields(
          ...textToEmbedFields('Message', message ?? '-'),
          { name: 'Channel', value: channelName ?? 'unknown channel', inline: true },
          {
            name: 'Pings',
            value:
              userIdsDisplayNamesJoined.length > 1024 ?
                `${userIdsDisplayNamesJoined.slice(0, 1023)}…`
              : userIdsDisplayNamesJoined || '-',
            inline: true
          },
          {
            name: 'Original command user removed from ping',
            value: booleanToString(userIdRemoved ?? false),
            inline: true
          }
        )
        .setFooter({ text: `${this.currentIndex + 1}/${this.arrayLength}.` });

      return { embeds: [embed], components: [this.row] };
    };

    super(
      PingForPingListMessageBuilder.#staticCounter++,
      PingForPingListMessageBuilder.messageBuilderType,
      interaction,
      pingForPingMeMessageBuilders,
      transformFunction,
      undefined,
      undefined
    );

    this.#markedAsDeletedArray = [];
  }

  public static get messageBuilderType(): string {
    return PingForPingListMessageBuilder.#messageBuilderType;
  }

  public get currentPingForPingMeMessageBuilder():
    Readonly<PingForPingMeMessageBuilder> | undefined {
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    return this.currentItem;
  }

  public markCurrentAsDeleted():
    PingForPingListMessageBuilderTransformFunctionReturnType | undefined {
    if (this.currentItem === undefined) return undefined;
    if (this.#markedAsDeletedArray.includes(this.currentIndex)) return undefined;

    this.#markedAsDeletedArray.push(this.currentIndex);
    return this.current();
  }
}
