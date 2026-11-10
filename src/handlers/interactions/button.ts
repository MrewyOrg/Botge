import {
  ActionRowBuilder,
  type ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  type Client,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type PermissionsBitField,
  RadioGroupBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import type { DatabaseManager } from '../../bot/database-manager.ts';
import type { MessageBuilderManager } from '../../bot/message-builder-manager.ts';
import { booleanToAllowed } from '../../discord/boolean-labels.ts';
import { SLASH_COMMAND_NAMES } from '../../discord/command-names.ts';
import type { Guild } from '../../discord/guild.ts';
import type { User } from '../../discord/user.ts';
import { getSevenTvEmoteSetLinkFromSevenTvApiUrl } from '../../emotes/provider-urls.ts';
import {
  FIRST_BUTTON_BASE_CUSTOM_ID,
  getBaseCustomIdFromCustomId,
  getCounterFromCustomId,
  getMessageBuilderTypeFromCustomId,
  JUMP_TO_BUTTON_BASE_CUSTOM_ID,
  LAST_BUTTON_BASE_CUSTOM_ID,
  NEXT_BUTTON_BASE_CUSTOM_ID,
  PREVIOUS_BUTTON_BASE_CUSTOM_ID
} from '../../message-builders/base.ts';
import {
  DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID,
  EmoteMessageBuilder
} from '../../message-builders/emote-message-builder.ts';
import {
  DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID,
  MediaMessageBuilder,
  RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID
} from '../../message-builders/media-message-builder.ts';
import { PingForPingListMessageBuilder } from '../../message-builders/ping-for-ping-list-message-builder.ts';
import {
  DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
  PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
  PingForPingMeMessageBuilder,
  REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID
} from '../../message-builders/ping-for-ping-me-message-builder.ts';
import {
  DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID,
  QuoteMessageBuilder,
  RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID
} from '../../message-builders/quote-message-builder.ts';
import {
  SEND_CLIP_BUTTON_BASE_CUSTOM_ID,
  TwitchClipMessageBuilder
} from '../../message-builders/twitch-clip-message-builder.ts';
import type {
  EmoteMessageBuilderTransformFunctionReturnType,
  MediaMessageBuilderTransformFunctionReturnType,
  PingForPingListMessageBuilderTransformFunctionReturnType,
  PingForPingMeMessageBuilderReplies,
  QuoteMessageBuilderTransformFunctionReturnType,
  TwitchClipMessageBuilderTransformFunctionReturnType
} from '../../types.ts';
import { logError } from '../../utils/log-error.ts';
import {
  ADD_EMOTE_ACCESS_BUTTON_CUSTOM_ID,
  ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID,
  ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID,
  CONFIGURATION_GUILD_BUTTON_CUSTOM_ID,
  CONFIGURATION_USER_BUTTON_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID,
  SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID
} from '../commands/settings.ts';
import {
  ADD_EMOTE_ACCESS_MODAL_CUSTOM_ID,
  ADD_EMOTE_ACCESS_MODE_CUSTOM_ID,
  ADD_EMOTE_ACCESS_ROLES_CUSTOM_ID,
  ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
  ASSIGN_GUILD_MODAL_CUSTOM_ID,
  BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID,
  EMOTE_BORDER_COLOR_TEXT_INPUT_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID,
  EMOTE_BORDER_ENABLED_CHECKBOX_CUSTOM_ID,
  GUILD_ID_TEXT_INPUT_CUSTOM_ID,
  SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID,
  SEVEN_TV_TEXT_INPUT_CUSTOM_ID,
  VOICE_CHANNEL_SELECT_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID,
  VOICE_STATUS_EMOJI_CUSTOM_ID,
  VOICE_STATUS_ENABLED_CUSTOM_ID
} from './component-ids.ts';
import { canManageSettings } from './settings-permissions.ts';

const MAX_ROLE_SELECT_MENU_VALUES = 10 as const;

const RENAME_MEDIA_MODAL_BASE_CUSTOM_ID = 'renameMediaModal' as const;
const RENAME_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID = 'renameMediaModalNameTextInput' as const;
const RENAME_MEDIA_MODAL_CUSTOM_ID_SEPARATOR = '-' as const;

const RENAME_QUOTE_MODAL_BASE_CUSTOM_ID = 'renameQuoteModal' as const;
const RENAME_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID = 'renameQuoteModalNameTextInput' as const;
const RENAME_QUOTE_MODAL_CUSTOM_ID_SEPARATOR = '-' as const;

let renameMediaModalCounter = 0;
let renameQuoteModalCounter = 0;

export function buttonHandler(
  client: Client,
  guild: Readonly<Guild> | undefined,
  user: Readonly<User> | undefined,
  messageBuilderManager: Readonly<MessageBuilderManager>,
  databaseManager: Readonly<DatabaseManager>
) {
  return async (interaction: ButtonInteraction): Promise<EmoteMessageBuilder | undefined> => {
    try {
      const { customId } = interaction;

      if (customId === CONFIGURATION_USER_BUTTON_CUSTOM_ID) {
        const GUILD_ID_TEXT_INPUT = new TextInputBuilder()
          .setCustomId(GUILD_ID_TEXT_INPUT_CUSTOM_ID)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('17–20 digit server ID')
          .setRequired(true);
        if (user?.guild !== undefined) GUILD_ID_TEXT_INPUT.setValue(user.guild.id);

        const GUILD_ID_TEXT_INPUT_LABEL = new LabelBuilder()
          .setLabel('Server ID')
          .setDescription('Copy the server ID from Discord with Developer Mode enabled.')
          .setTextInputComponent(GUILD_ID_TEXT_INPUT);

        const assignGuildModal = new ModalBuilder()
          .setCustomId(ASSIGN_GUILD_MODAL_CUSTOM_ID)
          .setTitle('Choose emote server')
          .addLabelComponents(GUILD_ID_TEXT_INPUT_LABEL);

        await interaction.showModal(assignGuildModal);
        return undefined;
      }

      if (guild === undefined) return undefined;
      const settingsActions: readonly string[] = [
        SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID,
        ADD_EMOTE_ACCESS_BUTTON_CUSTOM_ID,
        ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID,
        ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID,
        CONFIGURATION_GUILD_BUTTON_CUSTOM_ID,
        VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID
      ];
      if (
        settingsActions.includes(customId)
        && !(await canManageSettings(
          interaction,
          guild,
          customId === SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID
            || customId === CONFIGURATION_GUILD_BUTTON_CUSTOM_ID
        ))
      ) {
        await interaction.reply({
          content: 'You do not have permission to change these settings.',
          flags: MessageFlags.Ephemeral
        });
        return undefined;
      }

      if (customId === VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID) {
        const channelSelect = new ChannelSelectMenuBuilder()
          .setCustomId(VOICE_CHANNEL_SELECT_CUSTOM_ID)
          .setChannelTypes(ChannelType.GuildVoice)
          .setPlaceholder('Choose a voice channel')
          .setRequired(false)
          .setMinValues(0)
          .setMaxValues(1);
        const { voiceChannelsDatabase } = databaseManager.databases;
        const channelId = voiceChannelsDatabase.getChannelId(guild.id);
        const { enabled, emoji } = voiceChannelsDatabase.getStatusSettings(guild.id);
        if (
          channelId !== undefined
          && interaction.guild?.channels.cache.get(channelId)?.type === ChannelType.GuildVoice
        )
          channelSelect.setDefaultChannels(channelId);

        const label = new LabelBuilder()
          .setLabel('Voice channel')
          .setDescription('Choose where Botge joins. Save with no channel selected to disconnect.')
          .setChannelSelectMenuComponent(channelSelect);
        const statusToggle = new LabelBuilder()
          .setLabel('Set voice channel status')
          .setDescription('Show the saved emoji as the channel status when Botge joins.')
          .setCheckboxComponent(
            new CheckboxBuilder().setCustomId(VOICE_STATUS_ENABLED_CUSTOM_ID).setDefault(enabled)
          );
        const emojiInput = new TextInputBuilder()
          .setCustomId(VOICE_STATUS_EMOJI_CUSTOM_ID)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(57)
          .setPlaceholder('<:name:id>');
        if (emoji !== null) emojiInput.setValue(emoji);

        const statusEmoji = new LabelBuilder()
          .setLabel('Voice status emoji')
          .setDescription('Paste a custom emoji from this server or the Botge application.')
          .setTextInputComponent(emojiInput);
        const modal = new ModalBuilder()
          .setCustomId(VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID)
          .setTitle('Bot voice channel')
          .addLabelComponents(label, statusToggle, statusEmoji);

        await interaction.showModal(modal);
        return undefined;
      }

      if (customId === ADD_EMOTE_ACCESS_BUTTON_CUSTOM_ID) {
        const everyone = guild.allowEveryoneToAddEmote;
        const mode = new RadioGroupBuilder()
          .setCustomId(ADD_EMOTE_ACCESS_MODE_CUSTOM_ID)
          .addOptions(
            { label: 'Everyone', value: 'everyone', default: everyone },
            { label: 'Selected roles', value: 'roles', default: !everyone }
          );
        const roles = new RoleSelectMenuBuilder()
          .setCustomId(ADD_EMOTE_ACCESS_ROLES_CUSTOM_ID)
          .setRequired(false)
          .setMinValues(0)
          .setMaxValues(MAX_ROLE_SELECT_MENU_VALUES);
        if (guild.addEmotePermittedRoleIds !== null)
          roles.setDefaultRoles([...guild.addEmotePermittedRoleIds]);

        const modal = new ModalBuilder()
          .setCustomId(ADD_EMOTE_ACCESS_MODAL_CUSTOM_ID)
          .setTitle('Add emote access')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Who can add emotes?')
              .setDescription('Applies to /emote-add and the Botge Activity.')
              .setRadioGroupComponent(mode),
            new LabelBuilder()
              .setLabel('Roles that can add emotes')
              .setDescription(
                'Saved for Selected roles mode. The server owner and Botge admins always have access.'
              )
              .setRoleSelectMenuComponent(roles)
          );
        await interaction.showModal(modal);
        return undefined;
      }

      if (customId === SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID) {
        const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const permittedRoles = guild.settingsPermittedRoleIds;
        const roleSelectMenuBuilder = new RoleSelectMenuBuilder()
          .setCustomId(SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID)
          .setPlaceholder('Choose roles with access')
          .setMinValues(0)
          .setMaxValues(MAX_ROLE_SELECT_MENU_VALUES);
        if (permittedRoles !== null) roleSelectMenuBuilder.setDefaultRoles([...permittedRoles]);

        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          roleSelectMenuBuilder
        );

        await defer;
        await interaction.editReply({
          content: `Choose roles that can use /${SLASH_COMMAND_NAMES.settings}. Clear the selection to remove role-based access.`,
          components: [row]
        });
        return undefined;
      } else if (customId === ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID) {
        const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const allowEveryoneToAddEmote = !guild.allowEveryoneToAddEmote;
        databaseManager.permittedRoleIdsDatabase.changeAllowEveryoneToAddEmote(
          guild.id,
          allowEveryoneToAddEmote
        );
        guild.toggleAllowEveryoneToAddEmote();

        await defer;
        await interaction.editReply(
          `Everyone is ${booleanToAllowed(allowEveryoneToAddEmote)} to use add emote command now.`
        );
        return undefined;
      } else if (customId === ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID) {
        const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const emotes = guild.emoteCatalog.matchSingleArray(
          '',
          'sevenNotInSet',
          undefined,
          undefined,
          undefined,
          undefined,
          true
        );
        if (emotes === undefined) {
          await defer;
          await interaction.editReply('No emotes have been added to this server yet.');
          return undefined;
        }

        const emoteMessageBuilder = new EmoteMessageBuilder(interaction, emotes, undefined, true);
        const reply = emoteMessageBuilder.first();

        await defer;
        if (reply === undefined) return undefined;
        await interaction.editReply(reply);
        return emoteMessageBuilder;
      } else if (customId === CONFIGURATION_GUILD_BUTTON_CUSTOM_ID) {
        const BROADCASTER_NAME_TEXT_INPUT = new TextInputBuilder()
          .setCustomId(BROADCASTER_NAME_TEXT_INPUT_CUSTOM_ID)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Channel username, without a URL')
          .setRequired(false);
        const BROADCASTER_NAME_TEXT_INPUT_LABEL = new LabelBuilder()
          .setLabel('Twitch channel')
          .setDescription(
            'Optional channel username for Twitch, BTTV, and FFZ emotes and clip search.'
          )
          .setTextInputComponent(BROADCASTER_NAME_TEXT_INPUT);

        const SEVEN_TV_TEXT_INPUT = new TextInputBuilder()
          .setCustomId(SEVEN_TV_TEXT_INPUT_CUSTOM_ID)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://7tv.app/emote-sets/...')
          .setRequired(false);
        const SEVEN_TV_TEXT_INPUT_LABEL = new LabelBuilder()
          .setLabel('7TV emote set URL')
          .setDescription("Optional URL of the channel's 7TV emote set.")
          .setTextInputComponent(SEVEN_TV_TEXT_INPUT);

        const ASSIGN_EMOTE_SETS_MODAL = new ModalBuilder()
          .setCustomId(ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID)
          .setTitle('Server emotes')
          .addLabelComponents(BROADCASTER_NAME_TEXT_INPUT_LABEL, SEVEN_TV_TEXT_INPUT_LABEL);

        if (guild.broadcasterName !== null)
          BROADCASTER_NAME_TEXT_INPUT.setValue(guild.broadcasterName);

        const { personalEmoteSets } = guild.personalEmoteStore;
        if (personalEmoteSets !== undefined) {
          if (personalEmoteSets.sevenTv !== null)
            SEVEN_TV_TEXT_INPUT.setValue(
              getSevenTvEmoteSetLinkFromSevenTvApiUrl(personalEmoteSets.sevenTv)
            );
        }

        await interaction.showModal(ASSIGN_EMOTE_SETS_MODAL);
        return undefined;
      } else if (customId === EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID) {
        const enableEmoteBorder = user?.enableEmoteBorder;
        const emoteBorderColor = user?.emoteBorderColor;

        const EMOTE_BORDER_ENABLED_CHECKBOX = new CheckboxBuilder().setCustomId(
          EMOTE_BORDER_ENABLED_CHECKBOX_CUSTOM_ID
        );
        const EMOTE_BORDER_ENABLED_LABEL = new LabelBuilder()
          .setLabel('Enable emote borders')
          .setDescription('Add a border to emotes you send with the bot.')
          .setCheckboxComponent(EMOTE_BORDER_ENABLED_CHECKBOX);
        if (enableEmoteBorder !== undefined)
          EMOTE_BORDER_ENABLED_CHECKBOX.setDefault(enableEmoteBorder);

        const EMOTE_BORDER_COLOR_TEXT_INPUT = new TextInputBuilder()
          .setCustomId(EMOTE_BORDER_COLOR_TEXT_INPUT_CUSTOM_ID)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('RRGGBB');
        const EMOTE_BORDER_COLOR_LABEL = new LabelBuilder()
          .setLabel('Border color')
          .setDescription(
            'Six hexadecimal digits without #. Leave blank to keep the current color.'
          )
          .setTextInputComponent(EMOTE_BORDER_COLOR_TEXT_INPUT);
        if (emoteBorderColor !== undefined)
          EMOTE_BORDER_COLOR_TEXT_INPUT.setValue(emoteBorderColor);

        const EMOTE_BORDER_CONFIGURATION_MODAL = new ModalBuilder()
          .setCustomId(EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID)
          .setTitle('My emote borders')
          .addLabelComponents(EMOTE_BORDER_ENABLED_LABEL, EMOTE_BORDER_COLOR_LABEL);

        await interaction.showModal(EMOTE_BORDER_CONFIGURATION_MODAL);
        return undefined;
      }

      const messageBuilderType = getMessageBuilderTypeFromCustomId(customId);
      const counter = getCounterFromCustomId(customId);
      const baseCustomId = getBaseCustomIdFromCustomId(customId);
      const interactionUserId = interaction.user.id;

      if (
        messageBuilderType === PingForPingMeMessageBuilder.messageBuilderTypeForPingList
        || messageBuilderType === PingForPingMeMessageBuilder.messageBuilderTypeForPingMe
      ) {
        const { pingForPingListMessageBuilders, pingForPingMeMessageBuilders } =
          messageBuilderManager;

        const messageBuilders = (():
          | readonly Readonly<PingForPingListMessageBuilder>[]
          | readonly Readonly<PingForPingMeMessageBuilder>[]
          | undefined => {
          if (messageBuilderType === PingForPingMeMessageBuilder.messageBuilderTypeForPingMe)
            return pingForPingMeMessageBuilders;
          else return pingForPingListMessageBuilders;
        })();
        if (messageBuilders === undefined) {
          await interaction.deferUpdate();
          return undefined;
        }
        const selectedMessageBuilder = messageBuilders.find(
          (
            typedMessageBuilder:
              Readonly<PingForPingMeMessageBuilder> | Readonly<PingForPingListMessageBuilder>
          ) =>
            ('currentPingForPingMeMessageBuilder' in typedMessageBuilder ?
              typedMessageBuilder.currentPingForPingMeMessageBuilder?.counter
            : typedMessageBuilder.counter) === counter
        );
        if (selectedMessageBuilder === undefined) {
          await interaction.deferUpdate();
          return undefined;
        }

        const pingMessageBuilder =
          'currentPingForPingMeMessageBuilder' in selectedMessageBuilder ?
            selectedMessageBuilder.currentPingForPingMeMessageBuilder
          : selectedMessageBuilder;
        if (pingMessageBuilder === undefined) {
          await interaction.deferUpdate();
          return undefined;
        }
        const pingMessageBuilderInteraction = pingMessageBuilder.interaction;

        const { pingsDatabase } = databaseManager;
        let pingMessageBuilderReplies: PingForPingMeMessageBuilderReplies | undefined = undefined;
        if (baseCustomId === PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID) {
          pingMessageBuilderReplies = pingMessageBuilder.addUserId(
            pingsDatabase,
            interactionUserId
          );
        } else if (baseCustomId === REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID) {
          pingMessageBuilderReplies = pingMessageBuilder.removeUserId(
            pingsDatabase,
            interactionUserId
          );
        } else if (baseCustomId === DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID) {
          if (pingMessageBuilder.ping.userId !== interactionUserId) {
            await interaction.deferUpdate();
            return undefined;
          }

          pingMessageBuilderReplies = pingMessageBuilder.deletePing(pingsDatabase);
        } else {
          throw new Error('unknown button baseCustomId.');
        }

        const { buttonReply, reply, deletionEvent } = pingMessageBuilderReplies;
        if (buttonReply !== undefined) {
          await interaction.reply({ content: buttonReply, flags: MessageFlags.Ephemeral });
          return undefined;
        }

        await interaction.deferUpdate();
        if (reply === undefined) return undefined;
        else {
          await pingMessageBuilderInteraction.editReply(reply);

          if (deletionEvent) {
            if (messageBuilderType === PingForPingMeMessageBuilder.messageBuilderTypeForPingMe) {
              const index = pingForPingMeMessageBuilders.indexOf(pingMessageBuilder);
              if (index !== -1) pingForPingMeMessageBuilders.splice(index, 1);
            }
          }
        }
        return undefined;
      }

      const messageBuilders = (():
        | readonly Readonly<PingForPingListMessageBuilder>[]
        | readonly Readonly<TwitchClipMessageBuilder>[]
        | readonly Readonly<EmoteMessageBuilder>[]
        | readonly Readonly<MediaMessageBuilder>[]
        | readonly Readonly<QuoteMessageBuilder>[]
        | undefined => {
        if (messageBuilderType === PingForPingListMessageBuilder.messageBuilderType)
          return messageBuilderManager.pingForPingListMessageBuilders;
        if (messageBuilderType === TwitchClipMessageBuilder.messageBuilderType)
          return messageBuilderManager.twitchClipMessageBuilders;
        else if (messageBuilderType === EmoteMessageBuilder.messageBuilderType)
          return messageBuilderManager.emoteMessageBuilders;
        else if (messageBuilderType === MediaMessageBuilder.messageBuilderType)
          return messageBuilderManager.mediaMessageBuilders;
        else if (messageBuilderType === QuoteMessageBuilder.messageBuilderType)
          return messageBuilderManager.quoteMessageBuilders;
        else return undefined;
      })();
      if (messageBuilders === undefined) {
        await interaction.deferUpdate();
        return undefined;
      }

      const messageBuilder = messageBuilders.find(
        (
          typedMessageBuilder:
            | Readonly<TwitchClipMessageBuilder>
            | Readonly<EmoteMessageBuilder>
            | Readonly<MediaMessageBuilder>
            | Readonly<QuoteMessageBuilder>
            | Readonly<PingForPingListMessageBuilder>
        ) => typedMessageBuilder.counter === counter
      );
      if (messageBuilder === undefined) {
        await interaction.deferUpdate();
        return undefined;
      }

      const messageBuilderInteraction = messageBuilder.interaction;
      if (messageBuilderInteraction.user.id !== interactionUserId) {
        await interaction.deferUpdate();
        return undefined;
      }

      let reply:
        | EmoteMessageBuilderTransformFunctionReturnType
        | TwitchClipMessageBuilderTransformFunctionReturnType
        | MediaMessageBuilderTransformFunctionReturnType
        | QuoteMessageBuilderTransformFunctionReturnType
        | PingForPingListMessageBuilderTransformFunctionReturnType
        | undefined = undefined;

      if (baseCustomId === PREVIOUS_BUTTON_BASE_CUSTOM_ID) {
        reply = messageBuilder.previous();
      } else if (baseCustomId === NEXT_BUTTON_BASE_CUSTOM_ID) {
        reply = messageBuilder.next();
      } else if (baseCustomId === FIRST_BUTTON_BASE_CUSTOM_ID) {
        reply = messageBuilder.first();
      } else if (baseCustomId === LAST_BUTTON_BASE_CUSTOM_ID) {
        reply = messageBuilder.last();
      } else if (baseCustomId === JUMP_TO_BUTTON_BASE_CUSTOM_ID) {
        // ! can't defer, when showing modal
        await interaction.showModal(messageBuilder.modal);
        return undefined;
      } else if (baseCustomId === SEND_CLIP_BUTTON_BASE_CUSTOM_ID) {
        if (!(messageBuilder instanceof TwitchClipMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;

        const { channelId } = interaction;
        let channel: ReturnType<Client['channels']['cache']['get']> = undefined;

        try {
          channel = client.channels.cache.get(channelId);
          if (channel === undefined || !channel.isTextBased() || channel.isDMBased())
            throw new Error('Guild text channel not found.');
        } catch {
          await interaction.deferUpdate();
          return undefined;
        }

        const interactionGuild = interaction.guild;
        if (interactionGuild === null) {
          await interaction.deferUpdate();
          return undefined;
        }

        const botPermissionsInChannel = ((): Readonly<PermissionsBitField> => {
          const botUser = client.user;
          if (botUser === null) throw new Error('Bot client user is empty.');

          const botAsMember = interactionGuild.members.cache.get(botUser.id);
          if (botAsMember === undefined) throw new Error('Bot is not in the guild.');

          const permissions = channel.permissionsFor(botAsMember);
          return permissions;
        })();

        if (
          !botPermissionsInChannel.has('ViewChannel')
          || !botPermissionsInChannel.has('SendMessages')
        ) {
          await interaction.deferUpdate();
          return undefined;
        }

        await channel.send({
          ...typedMessageBuilder.currentWithSentBy(),
          allowedMentions: { repliedUser: false }
        });
        reply = undefined;
      } else if (baseCustomId === DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID) {
        if (!(messageBuilder instanceof EmoteMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;
        const { currentAddedEmote } = typedMessageBuilder;

        if (currentAddedEmote !== undefined) {
          databaseManager.addedEmotesDatabase.delete(currentAddedEmote, guild.id);
          guild.personalEmoteStore.removeSevenTVEmoteNotInSet(currentAddedEmote);
          reply = typedMessageBuilder.markCurrentAsDeleted();
        } else {
          reply = undefined;
        }
      } else if (baseCustomId === DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID) {
        if (!(messageBuilder instanceof MediaMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;
        const { currentMedia } = typedMessageBuilder;

        if (currentMedia !== undefined) {
          databaseManager.mediaDatabase.delete(interaction.user.id, currentMedia);
          reply = typedMessageBuilder.markCurrentAsDeleted();
        } else {
          reply = undefined;
        }
      } else if (baseCustomId === DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID) {
        if (!(messageBuilder instanceof QuoteMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;
        const { currentQuote } = typedMessageBuilder;

        if (currentQuote !== undefined) {
          databaseManager.quoteDatabase.delete(interaction.user.id, currentQuote);
          reply = typedMessageBuilder.markCurrentAsDeleted();
        } else {
          reply = undefined;
        }
      } else if (baseCustomId === RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID) {
        const { mediaDatabase } = databaseManager;

        if (!(messageBuilder instanceof MediaMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;
        const { currentMedia } = typedMessageBuilder;

        if (currentMedia === undefined) return undefined;
        const modalCustomId = `${RENAME_MEDIA_MODAL_BASE_CUSTOM_ID}${RENAME_MEDIA_MODAL_CUSTOM_ID_SEPARATOR}${renameMediaModalCounter++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Rename media')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('New name')
              .setDescription('Choose a unique name to use with /media.')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(RENAME_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID)
                  .setMaxLength(32)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder('e.g. favorite-clip')
                  .setValue(currentMedia.name)
                  .setRequired(true)
              )
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (submittedModal: ModalSubmitInteraction): boolean =>
              submittedModal.customId === modalCustomId,
            time: 60000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return undefined;

        const userId = modalSubmitInteraction.user.id;
        const mediaName = modalSubmitInteraction.fields.getTextInputValue(
          RENAME_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID
        );
        if (mediaDatabase.mediaNameExists(userId, mediaName)) {
          await modalSubmitInteraction.reply({
            content: 'There already is a media added with this name.',
            flags: MessageFlags.Ephemeral
          });
          return undefined;
        }

        mediaDatabase.rename(userId, currentMedia.url, mediaName);
        await modalSubmitInteraction.reply({
          content: `Renamed media to ${mediaName}.`,
          flags: MessageFlags.Ephemeral
        });
        return undefined;
      } else if (baseCustomId === RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID) {
        const { quoteDatabase } = databaseManager;

        if (!(messageBuilder instanceof QuoteMessageBuilder)) return undefined;
        const typedMessageBuilder = messageBuilder;
        const { currentQuote } = typedMessageBuilder;

        if (currentQuote === undefined) return undefined;
        const modalCustomId = `${RENAME_QUOTE_MODAL_BASE_CUSTOM_ID}${RENAME_QUOTE_MODAL_CUSTOM_ID_SEPARATOR}${renameQuoteModalCounter++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Rename quote')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('New name')
              .setDescription('Choose a unique name to use with /quote.')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(RENAME_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID)
                  .setMaxLength(32)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder('e.g. memorable-line')
                  .setValue(currentQuote.name)
                  .setRequired(true)
              )
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (submittedModal: ModalSubmitInteraction): boolean =>
              submittedModal.customId === modalCustomId,
            time: 60000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return undefined;

        const userId = modalSubmitInteraction.user.id;
        const quoteName = modalSubmitInteraction.fields.getTextInputValue(
          RENAME_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID
        );
        if (quoteDatabase.quoteNameExists(userId, quoteName)) {
          await modalSubmitInteraction.reply({
            content: 'There already is a quote added with this name.',
            flags: MessageFlags.Ephemeral
          });
          return undefined;
        }

        quoteDatabase.rename(userId, currentQuote.content, quoteName);
        await modalSubmitInteraction.reply({
          content: `Renamed quote to ${quoteName}.`,
          flags: MessageFlags.Ephemeral
        });
        return undefined;
      } else {
        throw new Error('unknown button baseCustomId.');
      }

      await interaction.deferUpdate();
      if (reply === undefined) return undefined;
      await messageBuilderInteraction.editReply(reply);
      return undefined;
    } catch (error) {
      logError(error, 'Error at buttonHandler');

      return undefined;
    }
  };
}
