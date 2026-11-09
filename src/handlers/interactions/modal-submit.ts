import { getVoiceConnection } from '@discordjs/voice';
import { ChannelType, ComponentType, MessageFlags, type ModalSubmitInteraction } from 'discord.js';

import type { ApiManager } from '../../bot/api-manager.ts';
import type { DatabaseManager } from '../../bot/database-manager.ts';
import type { MessageBuilderManager } from '../../bot/message-builder-manager.ts';
import { botgeConfig } from '../../config/botge-config.ts';
import { booleanToEnabled } from '../../discord/boolean-labels.ts';
import type { Guild } from '../../discord/guild.ts';
import { User } from '../../discord/user.ts';
import { requestVoiceChannelJoin } from '../../discord/voice-channel.ts';
import type { PersonalEmoteSets } from '../../emotes/personal-emote-sets.ts';
import {
  getBttvApiUrlFromBroadcasterName,
  getFfzApiUrlFromBroadcasterName,
  getSevenTvApiUrlFromSevenTvEmoteSetLink
} from '../../emotes/provider-urls.ts';
import {
  getBaseCustomIdFromCustomId,
  getCounterFromCustomId,
  getCustomId,
  getMessageBuilderTypeFromCustomId,
  JUMP_TO_IDENTIFIER_TEXT_INPUT_BASE_CUSTOM_ID,
  JUMP_TO_MODAL_BASE_CUSTOM_ID,
  JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID
} from '../../message-builders/base.ts';
import { EmoteMessageBuilder } from '../../message-builders/emote-message-builder.ts';
import { MediaMessageBuilder } from '../../message-builders/media-message-builder.ts';
import { PingForPingListMessageBuilder } from '../../message-builders/ping-for-ping-list-message-builder.ts';
import { TwitchClipMessageBuilder } from '../../message-builders/twitch-clip-message-builder.ts';
import type { MutableArray } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';
import {
  ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
  ASSIGN_GUILD_MODAL_CUSTOM_ID,
  BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID,
  EMOTE_BORDER_COLOR_TEXT_INPUT_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID,
  EMOTE_BORDER_ENABLED_CHECKBOX_CUSTOM_ID,
  GUILD_ID_TEXT_INPUT_CUSTOM_ID,
  SEVEN_TV_TEXT_INPUT_CUSTOM_ID,
  VOICE_CHANNEL_SELECT_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID
} from './component-ids.ts';
import { canManageSettings } from './settings-permissions.ts';

export function modalSubmitHandler(
  guilds: readonly Readonly<Guild>[],
  users: MutableArray<Readonly<User>>,
  guild: Readonly<Guild> | undefined,
  messageBuilderManager: Readonly<MessageBuilderManager>,
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>
) {
  return async (interaction: ModalSubmitInteraction): Promise<void> => {
    const { customId } = interaction;
    const deferReply =
      (
        customId === ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID
        || customId === ASSIGN_GUILD_MODAL_CUSTOM_ID
        || customId === EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID
        || customId === VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID
      ) ?
        interaction.deferReply({ flags: MessageFlags.Ephemeral })
      : undefined;

    try {
      if (customId === ASSIGN_GUILD_MODAL_CUSTOM_ID) {
        const { usersDatabase } = databaseManager;

        const guildId = interaction.fields.getTextInputValue(GUILD_ID_TEXT_INPUT_CUSTOM_ID).trim();
        const userId = interaction.user.id;

        const selectedGuild = guilds.find((candidateGuild) => candidateGuild.id === guildId);
        if (selectedGuild === undefined) {
          await deferReply;
          await interaction.editReply(
            'There is no server with this ID in the database. Previous settings unchanged.'
          );
          return;
        }

        let user = users.find((candidateUser) => candidateUser.id === userId);
        if (user !== undefined) {
          await deferReply;
          if (user.guild?.id === guildId) {
            await interaction.editReply('Nothing changed.');
          } else {
            usersDatabase.changeGuildId(userId, guildId);
            user.changeGuild(selectedGuild);
            await interaction.editReply('Changed guild.');
          }
          return;
        }

        user = new User(userId, selectedGuild, undefined, undefined);
        usersDatabase.changeGuildId(userId, guildId);
        users.push(user);
        await deferReply;
        await interaction.editReply('Changed guild.');
        return;
      }

      if (customId === VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID) {
        await deferReply;
        const interactionGuild = interaction.guild;
        if (
          guild === undefined
          || interactionGuild === null
          || !(await canManageSettings(interaction, guild))
        ) {
          await interaction.editReply('You do not have permission to change these settings.');
          return;
        }

        const selection = interaction.fields.getField(VOICE_CHANNEL_SELECT_CUSTOM_ID);
        if (selection.type !== ComponentType.ChannelSelect)
          throw new Error('Expected a voice channel selection.');
        const [channelId] = selection.values;
        const { voiceChannelsDatabase } = databaseManager.databases;
        if (channelId === undefined) {
          voiceChannelsDatabase.clearChannelId(guild.id);
          getVoiceConnection(guild.id)?.destroy();
          await interaction.editReply('Voice channel cleared. Botge will stay disconnected.');
          return;
        }

        const channel = interactionGuild.channels.cache.get(channelId);
        if (channel?.type !== ChannelType.GuildVoice || !channel.joinable) {
          await interaction.editReply('Botge cannot join that voice channel. Choose another one.');
          return;
        }

        voiceChannelsDatabase.setChannelId(guild.id, channel.id);
        try {
          requestVoiceChannelJoin(channel);
        } catch (error) {
          logError(error, `Error joining voice channel for guild ${guild.id}`);
          await interaction.editReply(
            `Saved <#${channel.id}>, but Botge could not join it now. It will try again on startup.`
          );
          return;
        }
        await interaction.editReply(`Saved <#${channel.id}> as Botge’s voice channel.`);
        return;
      }

      if (guild === undefined) return;

      if (customId === ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID) {
        if (!(await canManageSettings(interaction, guild, true))) {
          await deferReply;
          await interaction.editReply('You do not have permission to change these settings.');
          return;
        }
        const { broadcasterNameAndPersonalEmoteSetsDatabase } = databaseManager;
        const { twitchApi } = apiManager;

        const { id } = guild;

        let broadcasterName: string | null = interaction.fields
          .getTextInputValue(BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID)
          .trim();
        let sevenTv: string | null = interaction.fields
          .getTextInputValue(SEVEN_TV_TEXT_INPUT_CUSTOM_ID)
          .trim();
        const previousSets = guild.personalEmoteStore.personalEmoteSets;
        let bttv: string | null =
          botgeConfig.general.useBTTVEmotes ? null : (previousSets?.bttv ?? null);
        let ffz: string | null =
          botgeConfig.general.useFFZEmotes ? null : (previousSets?.ffz ?? null);
        let reply = '';

        if (broadcasterName === '') broadcasterName = null;
        if (!botgeConfig.general.use7TVPersonalEmotes) {
          if (sevenTv !== '') reply += 'Personal 7TV emotes are disabled by the operator.';
          sevenTv = previousSets?.sevenTv ?? null;
        } else if (sevenTv === '') sevenTv = null;
        else {
          const sevenTvApiUrlMessage = await getSevenTvApiUrlFromSevenTvEmoteSetLink(sevenTv);
          const { type } = sevenTvApiUrlMessage;

          if (type === 'success') {
            const { ownerUsername } = sevenTvApiUrlMessage;

            if (
              broadcasterName !== null
              && ownerUsername !== undefined
              && broadcasterName.toLowerCase() !== ownerUsername.toLowerCase()
            ) {
              await deferReply;
              await interaction.editReply(
                'Broadcaster name and 7TV emote set owner does not match.'
              );
              return;
            }

            sevenTv = sevenTvApiUrlMessage.url;
          } else if (type === 'feedback') {
            reply += sevenTvApiUrlMessage.message;
          } else {
            await deferReply;
            await interaction.editReply(sevenTvApiUrlMessage.message);
            return;
          }
        }

        if (broadcasterName !== null && botgeConfig.general.useBTTVEmotes) {
          const bttvApiUrlMessage = await getBttvApiUrlFromBroadcasterName(
            broadcasterName,
            twitchApi
          );
          const bttvApiUrlMessageType = bttvApiUrlMessage.type;

          if (bttvApiUrlMessageType === 'success') {
            bttv = bttvApiUrlMessage.url;
          } else if (bttvApiUrlMessageType === 'feedback') {
            reply += `\n${bttvApiUrlMessage.message}`;
          } else {
            await deferReply;
            await interaction.editReply(bttvApiUrlMessage.message);
            return;
          }
        }
        if (broadcasterName !== null && botgeConfig.general.useFFZEmotes) {
          const ffzApiUrlMessage = await getFfzApiUrlFromBroadcasterName(broadcasterName);
          const ffzApiUrlMessageType = ffzApiUrlMessage.type;

          if (ffzApiUrlMessageType === 'success') {
            ffz = ffzApiUrlMessage.url;
          } else if (ffzApiUrlMessageType === 'feedback') {
            reply += `\n${ffzApiUrlMessage.message}`;
          } else {
            await deferReply;
            await interaction.editReply(ffzApiUrlMessage.message);
            return;
          }
        }

        if (broadcasterName !== null && guild.broadcasterName !== broadcasterName) {
          await guild.changeBroadcasterNameAndRefreshClips(twitchApi, broadcasterName);
          broadcasterNameAndPersonalEmoteSetsDatabase.changeBroadcasterName(id, broadcasterName);

          reply += '\nRefreshed clips based on broadcaster name.';
        }

        if (sevenTv !== null || bttv !== null || ffz !== null) {
          const oldPersonalEmoteSets = guild.personalEmoteStore.personalEmoteSets;
          const personalEmoteSets: PersonalEmoteSets = { sevenTv, bttv, ffz };
          await guild.changePersonalEmoteSets(personalEmoteSets);
          broadcasterNameAndPersonalEmoteSetsDatabase.changePersonalEmoteSets(
            id,
            personalEmoteSets
          );

          if (
            (sevenTv !== null
              && oldPersonalEmoteSets !== undefined
              && oldPersonalEmoteSets.sevenTv !== sevenTv)
            || (oldPersonalEmoteSets === undefined && sevenTv !== null)
          )
            reply += '\nChanged 7TV Emote set.';

          if (
            (bttv !== null
              && oldPersonalEmoteSets !== undefined
              && oldPersonalEmoteSets.bttv !== bttv)
            || (oldPersonalEmoteSets === undefined && bttv !== null)
          )
            reply += '\nFound BTTV Emote set from broadcaster name and changed to it.';

          if (
            (ffz !== null && oldPersonalEmoteSets !== undefined && oldPersonalEmoteSets.ffz !== ffz)
            || (oldPersonalEmoteSets === undefined && ffz !== null)
          )
            reply += '\nFound FFZ Emote set from broadcaster name and changed to it.';
        }

        reply = reply.trim();
        reply = reply === '' ? 'Nothing changed.' : reply;
        await deferReply;
        await interaction.editReply(reply);
        return;
      } else if (customId === EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID) {
        const { usersDatabase } = databaseManager;

        const userId = interaction.user.id;

        const emoteBorderColorRegex = /^[0-9A-Fa-f]{6}$/u;

        let reply = '';

        const emoteBorderEnabled = interaction.fields.getCheckbox(
          EMOTE_BORDER_ENABLED_CHECKBOX_CUSTOM_ID
        );

        const emoteBorderColor = ((): string | undefined => {
          const colorInput = interaction.fields
            .getTextInputValue(EMOTE_BORDER_COLOR_TEXT_INPUT_CUSTOM_ID)
            .trim();

          return colorInput !== '' ? colorInput : undefined;
        })();
        if (emoteBorderColor !== undefined && !emoteBorderColorRegex.test(emoteBorderColor))
          reply += 'The format of the emote border color is incorrect. Format: RRGGBB';

        reply = reply.trim();
        if (reply !== '') {
          await deferReply;
          await interaction.editReply(reply);
          return;
        }

        let user = users.find((candidateUser) => candidateUser.id === userId);
        if (user !== undefined) {
          if (user.enableEmoteBorder !== emoteBorderEnabled) {
            reply += `${booleanToEnabled(emoteBorderEnabled)} emote border.`;
            usersDatabase.changeEnableEmoteBorder(user.id, emoteBorderEnabled);
            user.changeEnableEmoteBorder(emoteBorderEnabled);
          }

          if (emoteBorderColor !== undefined && user.emoteBorderColor !== emoteBorderColor) {
            reply += '\nChanged emote border color.';
            usersDatabase.changeEmoteBorderColor(user.id, emoteBorderColor);
            user.changeEmoteBorderColor(emoteBorderColor);
          }

          await deferReply;
          reply = reply.trim();
          await interaction.editReply(reply !== '' ? reply : 'Nothing changed.');
          return;
        }

        if (!emoteBorderEnabled && emoteBorderColor === undefined) {
          await deferReply;
          await interaction.editReply('Nothing changed.');
          return;
        }

        user = new User(userId, undefined, emoteBorderEnabled, emoteBorderColor);

        if (emoteBorderEnabled) {
          reply += 'Enabled emote border.';
          usersDatabase.changeEnableEmoteBorder(userId, emoteBorderEnabled);
        }
        if (emoteBorderColor !== undefined) {
          reply += '\nChanged emote border color.';
          usersDatabase.changeEmoteBorderColor(userId, emoteBorderColor);
        }

        users.push(user);
        await deferReply;
        reply = reply.trim();
        await interaction.editReply(reply !== '' ? reply : 'Nothing changed.');
        return;
      }

      const messageBuilderType = getMessageBuilderTypeFromCustomId(customId);
      if (messageBuilderType === undefined) return;
      const messageBuilders = (():
        | readonly Readonly<PingForPingListMessageBuilder>[]
        | readonly Readonly<TwitchClipMessageBuilder>[]
        | readonly Readonly<EmoteMessageBuilder>[]
        | readonly Readonly<MediaMessageBuilder>[]
        | undefined => {
        if (messageBuilderType === PingForPingListMessageBuilder.messageBuilderType)
          return messageBuilderManager.pingForPingListMessageBuilders;
        else if (messageBuilderType === TwitchClipMessageBuilder.messageBuilderType)
          return messageBuilderManager.twitchClipMessageBuilders;
        else if (messageBuilderType === EmoteMessageBuilder.messageBuilderType)
          return messageBuilderManager.emoteMessageBuilders;
        else if (messageBuilderType === MediaMessageBuilder.messageBuilderType)
          return messageBuilderManager.mediaMessageBuilders;
        return undefined;
      })();
      if (messageBuilders === undefined) return;

      const counter = getCounterFromCustomId(customId);
      const messageBuilder = messageBuilders.find(
        (
          candidateBuilder:
            | Readonly<TwitchClipMessageBuilder>
            | Readonly<EmoteMessageBuilder>
            | Readonly<PingForPingListMessageBuilder>
            | Readonly<MediaMessageBuilder>
        ) => candidateBuilder.counter === counter
      );
      if (messageBuilder === undefined) return;

      const messageBuilderInteraction = messageBuilder.interaction;
      if (messageBuilderInteraction.user.id !== interaction.user.id) {
        await interaction.reply({
          content: 'You can only navigate your own response.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const defer = interaction.deferUpdate();
      const baseCustomId = getBaseCustomIdFromCustomId(customId);
      if (baseCustomId !== JUMP_TO_MODAL_BASE_CUSTOM_ID) return;

      const jumpToTextInputValue = interaction.fields
        .getTextInputValue(
          getCustomId(JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID, messageBuilderType, messageBuilder.counter)
        )
        .trim();

      let jumpToIdentifierTextInputValue: string | undefined = undefined;
      try {
        jumpToIdentifierTextInputValue = interaction.fields
          .getTextInputValue(
            getCustomId(
              JUMP_TO_IDENTIFIER_TEXT_INPUT_BASE_CUSTOM_ID,
              messageBuilderType,
              messageBuilder.counter
            )
          )
          .trim();
      } catch {
        // This optional field is absent from modals that only accept a page number.
      }

      if (
        jumpToTextInputValue !== ''
        && jumpToIdentifierTextInputValue !== undefined
        && jumpToIdentifierTextInputValue !== ''
      ) {
        // can't set both
        await defer;
        return;
      }

      if (jumpToIdentifierTextInputValue !== undefined && jumpToIdentifierTextInputValue !== '') {
        const reply = messageBuilder.jumpToIdentifier(jumpToIdentifierTextInputValue);
        await defer;

        if (reply === undefined) return;
        await messageBuilderInteraction.editReply(reply);
        return;
      }

      if (jumpToTextInputValue === '') {
        const reply = messageBuilder.random();
        await defer;

        if (reply === undefined) return;
        await messageBuilderInteraction.editReply(reply);
        return;
      }

      const jumpToTextInputValueNumber = Number(jumpToTextInputValue);
      if (Number.isNaN(jumpToTextInputValueNumber)) {
        await defer;
        return;
      }

      const reply = messageBuilder.jumpTo(jumpToTextInputValueNumber - 1);
      await defer;

      if (reply === undefined) return;
      await messageBuilderInteraction.editReply(reply);
    } catch (error) {
      logError(error, 'Error at modalSubmitHandler');

      if (deferReply !== undefined) {
        await deferReply;
        await interaction.editReply('Something went wrong. Please try again later.');
      }
    }
  };
}
