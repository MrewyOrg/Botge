import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type MessageActionRowComponentBuilder,
  type TextChannel
} from 'discord.js';
import { type Job, scheduleJob } from 'node-schedule';

import { getPingJobName } from '../bot/ping-utils.ts';
import type { PingsDatabase } from '../database/pings-database.ts';
import type {
  MutableArray,
  Ping,
  PingForPingMeMessageBuilderReplies,
  PingForPingMeMessageBuilderTransformFunctionReturnType,
  ReadonlyActionRowBuilderMessageActionRowComponentBuilder
} from '../types.ts';
import { logError } from '../utils/log-error.ts';
import { getCustomId } from './base.ts';
import { getPingableUserId } from './get-pingable-user-id.ts';

type ContentType = 'PingRegistered' | 'Pinged';

export function getContent(ping: Ping, contentType: ContentType): string {
  const { days, hours, minutes, userId, message, userIds, userIdRemoved } = ping;

  const parts: string[] = [];
  if (days !== null) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours !== null) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes !== null) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  const contentTimePart = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
    parts
  );

  let content = '';
  if (contentType === 'PingRegistered') {
    content += `The ping has been registered for ${contentTimePart}.`;

    if (userIdRemoved !== null && userIdRemoved)
      content += ' The original command user was removed from the ping.';
  } else {
    content += `You have been pinged ${getPingableUserId(userId)} after ${contentTimePart}!`;

    if (userIdRemoved !== null && userIdRemoved)
      content = `The original command user was removed from the ping. The ping was delivered after ${contentTimePart}!`;
  }

  if (message !== null) content += ` With the message: ${message}.`;
  if (userIds !== null && userIds.length !== 0) {
    const pingableUserIds = userIds.map((recipientId) => getPingableUserId(recipientId)).join(', ');
    content += `\nPings: ${pingableUserIds}.`;
  }

  return content;
}

export const PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID =
  'pingMeAsWellButtonForPingMe' as const;
export const REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID =
  'removeMeFromPingButtonForPingMe' as const;
export const DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID = 'deletePingButtonForPingMe' as const;
const CLEANUP_MINUTES = 4 as const;

type DeliveryTarget =
  { readonly channel: Readonly<Pick<TextChannel, 'send'>> } | { readonly client: Client };

/** Keep scheduled jobs independent of interaction objects and their builder state. */
function createPingJob(
  identity: Pick<Ping, 'time' | 'userId' | 'channelId'>,
  date: Readonly<Date>,
  target: DeliveryTarget,
  pingsDatabase: Readonly<PingsDatabase>,
  jobs: MutableArray<Readonly<Job>>
): Readonly<Job> {
  const name = getPingJobName(identity);
  const job = scheduleJob(name, date, async () => {
    try {
      const ping = pingsDatabase.get(identity);
      if (ping === undefined) return;
      if ('client' in target) {
        const channel = await target.client.channels.fetch(identity.channelId);
        if (channel?.isSendable() !== true) return;
        await channel.send(getContent(ping, 'Pinged'));
      } else {
        await target.channel.send(getContent(ping, 'Pinged'));
      }
      pingsDatabase.delete(ping);
    } catch (error) {
      logError(error, 'Error delivering a scheduled reminder');
    } finally {
      const index = jobs.findIndex(
        (candidate: Readonly<Pick<Job, 'name'>>) => candidate.name === name
      );
      if (index !== -1) jobs.splice(index, 1);
    }
  }) as Job | null;
  if (job === null) throw new Error('Failed to schedule the ping.');
  jobs.push(job);
  return job;
}

export class PingForPingMeMessageBuilder {
  static readonly #messageBuilderTypeForPingMe = 'PingForPingMeForPingMe' as const;
  static readonly #messageBuilderTypeForPingList = 'PingForPingMeForPingList' as const;
  static readonly #emptyPingMessageBuilderReplies: PingForPingMeMessageBuilderReplies = {
    reply: undefined,
    buttonReply: undefined,
    deletionEvent: false
  };
  static readonly #pressedButtonPingMessageBuilderReplies: PingForPingMeMessageBuilderReplies = {
    reply: undefined,
    buttonReply: `Please wait at least ${CLEANUP_MINUTES} minutes before pressing the same button again.`,
    deletionEvent: false
  };
  static #staticCounter = 0;

  readonly #counter: number;
  readonly #messageBuilderType: string;
  readonly #interaction: ChatInputCommandInteraction;
  readonly #pingDate: Readonly<Date>;
  readonly #deliveryTarget: DeliveryTarget;
  readonly #row: ReadonlyActionRowBuilderMessageActionRowComponentBuilder;
  readonly #pressedPingMeAsWell: Map<string, number> = new Map<string, number>();
  readonly #pressedRemoveMeFromPing: Map<string, number> = new Map<string, number>();
  readonly #scheduledJobs: MutableArray<Readonly<Job>>;
  #ping: Ping;
  #job: Readonly<Job> | undefined = undefined;

  public constructor(
    interaction: ChatInputCommandInteraction,
    ping: Ping,
    pingDate: Readonly<Date>,
    channel: Readonly<Pick<TextChannel, 'send'>>,
    scheduleJobs: MutableArray<Readonly<Job>>,
    messageBuilderType: string,
    client?: Client
  ) {
    if (!Number.isFinite(pingDate.getTime())) throw new RangeError('Invalid ping date.');

    if (
      messageBuilderType !== PingForPingMeMessageBuilder.messageBuilderTypeForPingMe
      && messageBuilderType !== PingForPingMeMessageBuilder.messageBuilderTypeForPingList
    )
      throw new Error('Wrong messageBuilderType.');

    this.#counter = PingForPingMeMessageBuilder.#staticCounter++;
    this.#messageBuilderType = messageBuilderType;
    this.#interaction = interaction;
    this.#ping = ping;
    this.#pingDate = pingDate;
    this.#deliveryTarget = client === undefined ? { channel } : { client };
    this.#scheduledJobs = scheduleJobs;

    this.#row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
            messageBuilderType,
            this.#counter
          )
        )
        .setLabel('Remind me too')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
            messageBuilderType,
            this.#counter
          )
        )
        .setLabel('Leave reminder')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          getCustomId(
            DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
            messageBuilderType,
            this.#counter
          )
        )
        .setLabel('Cancel reminder')
        .setStyle(ButtonStyle.Danger)
    );
  }

  public static get messageBuilderTypeForPingMe(): string {
    return PingForPingMeMessageBuilder.#messageBuilderTypeForPingMe;
  }
  public static get messageBuilderTypeForPingList(): string {
    return PingForPingMeMessageBuilder.#messageBuilderTypeForPingList;
  }

  public get ping(): Ping {
    return this.#ping;
  }
  public get row(): ReadonlyActionRowBuilderMessageActionRowComponentBuilder {
    return this.#row;
  }
  public get counter(): number {
    return this.#counter;
  }
  public get interaction(): ChatInputCommandInteraction {
    return this.#interaction;
  }

  public registerPing(
    pingsDatabase: Readonly<PingsDatabase>
  ): PingForPingMeMessageBuilderTransformFunctionReturnType | undefined {
    if (this.#isCriticalTimeLeftOrIsPassed()) return undefined;
    if (this.#job !== undefined) return undefined;

    const scheduledJob = this.#scheduledJobs.find(
      (candidateJob: Readonly<Pick<Job, 'name'>>) =>
        candidateJob.name === getPingJobName(this.#ping)
    );
    if (scheduledJob !== undefined) {
      this.#job = scheduledJob;
      return this.#transformFunction();
    }

    // A list view must not recreate a reminder that has already been delivered or deleted.
    if (this.#messageBuilderType === PingForPingMeMessageBuilder.messageBuilderTypeForPingList)
      return undefined;

    pingsDatabase.insert(this.#ping);
    try {
      this.#job = this.#schedulePing(pingsDatabase);
    } catch (error) {
      pingsDatabase.delete(this.#ping);
      throw error;
    }

    return this.#transformFunction();
  }

  public addUserId(
    pingsDatabase: Readonly<PingsDatabase>,
    userId: string
  ): PingForPingMeMessageBuilderReplies {
    const emptyPingMessageBuilderReplies =
      PingForPingMeMessageBuilder.#emptyPingMessageBuilderReplies;

    if (this.#isCriticalTimeLeftOrIsPassed()) return emptyPingMessageBuilderReplies;
    if (!this.#refreshPing(pingsDatabase)) return emptyPingMessageBuilderReplies;
    this.#cleanUpPressedMaps();
    if (this.#ping.userId === userId) {
      if (this.#ping.userIdRemoved === null || !this.#ping.userIdRemoved)
        return emptyPingMessageBuilderReplies;

      if (this.#pressedPingMeAsWell.has(userId))
        return PingForPingMeMessageBuilder.#pressedButtonPingMessageBuilderReplies;

      this.#updatePing(pingsDatabase, undefined, false);
      this.#pressedPingMeAsWell.set(userId, Date.now());
      return { reply: this.#transformFunction(), buttonReply: undefined, deletionEvent: false };
    }

    if (this.#pressedPingMeAsWell.has(userId))
      return PingForPingMeMessageBuilder.#pressedButtonPingMessageBuilderReplies;

    const { userIds } = this.#ping;
    const newUserIds: string[] = [userId];
    if (userIds !== null) {
      if (userIds.includes(userId)) return emptyPingMessageBuilderReplies;

      newUserIds.unshift(...userIds);
    }

    // Reserve room for the status text if the owner later removes themselves.
    const updatedPing: Ping = { ...this.#ping, userIds: newUserIds, userIdRemoved: true };
    if (
      getContent(updatedPing, 'PingRegistered').length > 2000
      || getContent(updatedPing, 'Pinged').length > 2000
    )
      return {
        reply: undefined,
        buttonReply: 'This ping has reached the message length limit; no more people can be added.',
        deletionEvent: false
      };

    this.#updatePing(pingsDatabase, newUserIds);
    this.#pressedPingMeAsWell.set(userId, Date.now());
    return { reply: this.#transformFunction(), buttonReply: undefined, deletionEvent: false };
  }

  public removeUserId(
    pingsDatabase: Readonly<PingsDatabase>,
    userId: string
  ): PingForPingMeMessageBuilderReplies {
    const emptyPingMessageBuilderReplies =
      PingForPingMeMessageBuilder.#emptyPingMessageBuilderReplies;

    if (this.#isCriticalTimeLeftOrIsPassed()) return emptyPingMessageBuilderReplies;
    if (!this.#refreshPing(pingsDatabase)) return emptyPingMessageBuilderReplies;
    this.#cleanUpPressedMaps();

    const { userIds } = this.#ping;
    if (userIds === null || userIds.length === 0) {
      if (this.#ping.userId === userId)
        return {
          reply: undefined,
          buttonReply:
            "You cannot remove yourself from the ping if no one else is added to it.\nPlease use the 'Delete ping' button.",
          deletionEvent: false
        };

      return emptyPingMessageBuilderReplies;
    }
    if (this.#ping.userId === userId) {
      if (this.#pressedRemoveMeFromPing.has(userId))
        return PingForPingMeMessageBuilder.#pressedButtonPingMessageBuilderReplies;

      this.#updatePing(pingsDatabase, undefined, true);
      this.#pressedRemoveMeFromPing.set(userId, Date.now());
      return { reply: this.#transformFunction(), buttonReply: undefined, deletionEvent: false };
    }

    if (this.#pressedRemoveMeFromPing.has(userId))
      return PingForPingMeMessageBuilder.#pressedButtonPingMessageBuilderReplies;

    const userIdIndex = userIds.findIndex((recipientId) => recipientId === userId);
    if (userIdIndex === -1) return emptyPingMessageBuilderReplies;

    const newUserIds = [...userIds];
    newUserIds.splice(userIdIndex, 1);

    const { userIdRemoved } = this.#ping;
    if (newUserIds.length === 0 && userIdRemoved !== null && userIdRemoved)
      return this.#deletePing(pingsDatabase);

    this.#updatePing(pingsDatabase, newUserIds);
    this.#pressedRemoveMeFromPing.set(userId, Date.now());
    return { reply: this.#transformFunction(), buttonReply: undefined, deletionEvent: false };
  }

  public deletePing(pingsDatabase: Readonly<PingsDatabase>): PingForPingMeMessageBuilderReplies {
    const emptyPingMessageBuilderReplies =
      PingForPingMeMessageBuilder.#emptyPingMessageBuilderReplies;

    if (this.#isCriticalTimeLeftOrIsPassed()) return emptyPingMessageBuilderReplies;
    if (!this.#refreshPing(pingsDatabase)) return emptyPingMessageBuilderReplies;
    this.#cleanUpPressedMaps();

    const { userIds } = this.#ping;
    if (userIds !== null && userIds.length !== 0)
      return {
        reply: undefined,
        buttonReply:
          "You cannot delete the ping because people have been added to it.\nPlease use the 'Remove me from ping' button.",
        deletionEvent: false
      };

    return this.#deletePing(pingsDatabase);
  }

  #refreshPing(pingsDatabase: Readonly<PingsDatabase>): boolean {
    const jobName = getPingJobName(this.#ping);
    const job = this.#scheduledJobs.find(
      (candidate: Readonly<Pick<Job, 'name'>>) => candidate.name === jobName
    );
    const ping = pingsDatabase.get(this.#ping);
    if (job === undefined || ping === undefined) return false;

    this.#job = job;
    this.#ping = ping;
    return true;
  }

  #schedulePing(pingsDatabase: Readonly<PingsDatabase>): Readonly<Job> {
    const { time, userId, channelId } = this.#ping;
    return createPingJob(
      { time, userId, channelId },
      this.#pingDate,
      this.#deliveryTarget,
      pingsDatabase,
      this.#scheduledJobs
    );
  }

  #updatePing(
    pingsDatabase: Readonly<PingsDatabase>,
    newUserIds?: readonly string[],
    newUserIdRemoved?: boolean
  ): void {
    if (this.#job === undefined) return;

    const oldUserIds = this.#ping.userIds;
    const oldUserIdRemoved = this.#ping.userIdRemoved;

    const updatedUserIds =
      newUserIds !== undefined ?
        newUserIds.length !== 0 ?
          newUserIds
        : null
      : oldUserIds;
    const updatedRemovedUserId = newUserIdRemoved ?? oldUserIdRemoved;
    const newPing: Ping = {
      ...this.#ping,
      userIds: updatedUserIds,
      userIdRemoved: updatedRemovedUserId
    };
    this.#ping = newPing;

    if (newUserIds !== undefined) pingsDatabase.updateUserIds(this.#ping);
    if (newUserIdRemoved !== undefined) pingsDatabase.updateUserIdRemoved(this.#ping);
  }

  #deletePing(pingsDatabase: Readonly<PingsDatabase>): PingForPingMeMessageBuilderReplies {
    if (this.#job === undefined) return PingForPingMeMessageBuilder.#emptyPingMessageBuilderReplies;

    pingsDatabase.delete(this.#ping);
    this.#job.cancel();
    const index = this.#scheduledJobs.indexOf(this.#job);
    if (index !== -1) this.#scheduledJobs.splice(index, 1);
    this.#job = undefined;

    return {
      reply: { content: '❌ This ping has been deleted.', components: [] },
      buttonReply: undefined,
      deletionEvent: true
    };
  }

  #transformFunction(): PingForPingMeMessageBuilderTransformFunctionReturnType {
    return { content: getContent(this.#ping, 'PingRegistered'), components: [this.#row] };
  }

  #isCriticalTimeLeftOrIsPassed(): boolean {
    const dateNow = Date.now();
    return dateNow >= this.#pingDate.getTime() - 25000;
  }

  #cleanUpPressedMaps(): void {
    const timeNow = Date.now();

    for (const [userId, pressedAt] of this.#pressedPingMeAsWell) {
      const difference = timeNow - pressedAt;
      if (difference >= CLEANUP_MINUTES * 60000) this.#pressedPingMeAsWell.delete(userId);
    }

    for (const [userId, pressedAt] of this.#pressedRemoveMeFromPing) {
      const difference = timeNow - pressedAt;
      if (difference >= CLEANUP_MINUTES * 60000) this.#pressedRemoveMeFromPing.delete(userId);
    }
  }
}
