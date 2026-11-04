/** @format */

import {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  MessageFlags,
  type Message,
  type ModalSubmitInteraction,
  type MessageContextMenuCommandInteraction
} from 'discord.js';

import type {
  Media,
  Quote,
  ReadonlyEmbed,
  ReadonlyAttachment,
  OpenAIResponseInput,
  OpenAIResponseInputImage
} from '../../types.ts';

import { logError } from '../../utils/public/log-error.ts';

import { CONTEXT_MENU_COMMAND_NAMES } from '../../modules/discord/commands.ts';
import type { DatabaseManager } from '../../modules/bot/database-manager.ts';
import type { ApiManager } from '../../modules/bot/api-manager.ts';

const MAX_DISCORD_MESSAGE_LENGTH = 2000 as const;

const DISCORD_EMOJIS_JOINED = ((): string | undefined => {
  const { DISCORD_EMOJIS } = process.env;
  if (DISCORD_EMOJIS === undefined) return undefined;

  return DISCORD_EMOJIS.split(',').join(' or ');
})();

const ADD_MEDIA_MODAL_BASE_CUSTOM_ID = 'addMediaModal' as const;
const ADD_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID = 'addMediaModalNameTextInput' as const;
const REMOVE_MEDIA_MODAL_BASE_CUSTOM_ID = 'removeMediaModal' as const;

const ADD_QUOTE_MODAL_BASE_CUSTOM_ID = 'addQuoteModal' as const;
const ADD_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID = 'addQuoteModalNameTextInput' as const;
const REMOVE_QUOTE_MODAL_BASE_CUSTOM_ID = 'removeQuoteModal' as const;

const MODAL_CUSTOM_ID_SEPARATOR = '-' as const;

let ADD_MEDIA_MODAL_COUNTER = 0;
let REMOVE_MEDIA_MODAL_COUNTER = 0;

let ADD_QUOTE_MODAL_COUNTER = 0;
let REMOVE_QUOTE_MODAL_COUNTER = 0;

type getMediaUrlFromMessageReturnType =
  | { readonly type: 'success'; readonly mediaUrl: string }
  | { readonly type: 'feedback'; readonly message: string };

function getMediaUrlFromMessage(message: Message): getMediaUrlFromMessageReturnType {
  const { embeds } = message;
  const { attachments } = message;

  if (embeds.length === 0) {
    if (attachments.size === 0) {
      return {
        type: 'feedback',
        message: 'There are no embeds/attachments in the target message.'
      };
    }
  }

  if (embeds.length !== 1) {
    if (attachments.size === 0)
      return {
        type: 'feedback',
        message: 'There are no embeds/attachments in the target message.'
      };
    else if (attachments.size > 1)
      return { type: 'feedback', message: 'Target message has more than one embeds/attachments.' };

    const attachmentUrl = attachments.at(0)?.url;
    if (attachmentUrl === undefined)
      return { type: 'feedback', message: 'Something went wrong. Please try again later.' };

    return { type: 'success', mediaUrl: attachmentUrl };
  } else {
    const embedUrl = embeds[0].url;

    if (embedUrl === null) return { type: 'feedback', message: "Target message's url is empty." };

    if (
      !embedUrl.startsWith('https://tenor.com/view/')
      && !embedUrl.startsWith('https://cdn.discordapp.com/attachments/')
      && !embedUrl.startsWith('https://media.discordapp.com/attachments/')
    ) {
      return {
        type: 'feedback',
        message: 'Currently the only supported media are Tenor links and attachments.'
      };
    }

    return { type: 'success', mediaUrl: embedUrl };
  }
}

export function messageContextMenuCommandHandler(
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>
) {
  return async (interaction: MessageContextMenuCommandInteraction): Promise<void> => {
    const defer =
      (
        interaction.commandName !== CONTEXT_MENU_COMMAND_NAMES.addMedia
        && interaction.commandName !== CONTEXT_MENU_COMMAND_NAMES.removeMedia
        && interaction.commandName !== CONTEXT_MENU_COMMAND_NAMES.addQuote
        && interaction.commandName !== CONTEXT_MENU_COMMAND_NAMES.removeQuote
      ) ?
        interaction.deferReply()
      : undefined;

    try {
      if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.chatGptExplain) {
        const { openai } = apiManager;

        if (openai === undefined) {
          await defer;
          await interaction.editReply('ChatGPT command is not available right now.');
          return;
        }

        const { content } = interaction.targetMessage;
        const instructions = ((): string => {
          let instruction = 'Be concise.';

          if (DISCORD_EMOJIS_JOINED !== undefined)
            instruction += ` You use ${DISCORD_EMOJIS_JOINED} frequently at the end of your sentences.`;

          return instruction;
        })();

        const input = ((): OpenAIResponseInput => {
          const inputText = ((): string => {
            const content_ = content !== '' ? `"${content}"` : '';
            return `Explain ${content_}`;
          })();

          const inputImages = ((): OpenAIResponseInput | undefined => {
            const { embeds, attachments } = interaction.targetMessage;

            const embeds_ = embeds
              .map((embed: ReadonlyEmbed) => embed.url)
              .filter((embedUrl) => embedUrl !== null);
            const imageUrls =
              embeds_.length > 0 ?
                embeds_
              : attachments.map((attachment: ReadonlyAttachment) => attachment.url);
            const images: OpenAIResponseInputImage[] = imageUrls.map((imageUrl) => ({
              type: 'input_image',
              image_url: imageUrl,
              detail: 'low'
            }));

            return images.length > 0 ?
                [
                  { role: 'user', content: inputText },
                  { role: 'user', content: images }
                ]
              : undefined;
          })();

          return inputImages ?? [{ role: 'user', content: inputText }];
        })();

        const response = await openai.responses.create({
          model: 'gpt-6-astra',
          input: input,
          max_output_tokens: 400,
          instructions: instructions,
          safety_identifier: interaction.user.id
        });

        const messageContent = response.output_text;
        const reply =
          messageContent.length > MAX_DISCORD_MESSAGE_LENGTH ?
            messageContent.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 5) + ' ...'
          : messageContent;

        await defer;
        await interaction.editReply(reply);
      } else if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.addMedia) {
        const { mediaDatabase } = databaseManager;

        const getMediaUrlFromMessage_ = getMediaUrlFromMessage(interaction.targetMessage);

        if (getMediaUrlFromMessage_.type === 'feedback') {
          await interaction.reply({
            content: getMediaUrlFromMessage_.message,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const userId = interaction.user.id;
        const { mediaUrl } = getMediaUrlFromMessage_;
        if (mediaDatabase.mediaUrlExists(userId, mediaUrl)) {
          await interaction.reply({
            content: 'There already is a media added with this link.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const modalCustomId = `${ADD_MEDIA_MODAL_BASE_CUSTOM_ID}${MODAL_CUSTOM_ID_SEPARATOR}${ADD_MEDIA_MODAL_COUNTER++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Add Media')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Name')
              .setDescription('The name of the media.')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(ADD_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID)
                  .setMaxLength(32)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder('namege')
                  .setRequired(true)
              )
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (modalSubmitInteraction_: ModalSubmitInteraction): boolean =>
              modalSubmitInteraction_.customId === modalCustomId,
            time: 60000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return;

        const mediaName = modalSubmitInteraction.fields.getTextInputValue(
          ADD_MEDIA_MODAL_NAME_TEXT_INPUT_CUSTOM_ID
        );
        if (mediaDatabase.mediaNameExists(userId, mediaName)) {
          await modalSubmitInteraction.reply({
            content: 'There already is a media added with this name.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const media: Media = { url: mediaUrl, name: mediaName, dateAdded: new Date(Date.now()) };
        mediaDatabase.insert(userId, media);
        await modalSubmitInteraction.reply({
          content: `Added media with the name ${mediaName}.`,
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.removeMedia) {
        const { mediaDatabase } = databaseManager;

        const getMediaUrlFromMessage_ = getMediaUrlFromMessage(interaction.targetMessage);

        if (getMediaUrlFromMessage_.type === 'feedback') {
          await interaction.reply({
            content: getMediaUrlFromMessage_.message,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const userId = interaction.user.id;
        const { mediaUrl } = getMediaUrlFromMessage_;
        const mediaName = mediaDatabase.getMediaName(userId, mediaUrl);
        if (mediaName === undefined) {
          await interaction.reply({
            content: 'You do not have a media added with this link.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const modalCustomId = `${REMOVE_MEDIA_MODAL_BASE_CUSTOM_ID}${MODAL_CUSTOM_ID_SEPARATOR}${REMOVE_MEDIA_MODAL_COUNTER++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Are you sure?')
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`You are about to delete '${mediaName}'.`)
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (modalSubmitInteraction_: ModalSubmitInteraction): boolean =>
              modalSubmitInteraction_.customId === modalCustomId,
            time: 30000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return;

        mediaDatabase.delete(userId, { name: mediaName, url: mediaUrl });
        await modalSubmitInteraction.reply({
          content: `Removed media ${mediaName}.`,
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.translate) {
        const { deepLClient } = apiManager;

        if (deepLClient === undefined) {
          await defer;
          await interaction.editReply('Translate is not available right now.');
          return;
        }

        const { content } = interaction.targetMessage;

        const textResult = await deepLClient.translateText(content, null, 'en-US', {
          modelType: 'prefer_quality_optimized',
          formality: 'default'
        });

        await defer;
        await interaction.editReply(textResult.text);
      } else if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.addQuote) {
        const { quoteDatabase } = databaseManager;

        const userId = interaction.user.id;
        const { content } = interaction.targetMessage;

        if (quoteDatabase.quoteContentExists(userId, content)) {
          await interaction.reply({
            content: 'There already is a quote added with this content.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const modalCustomId = `${ADD_QUOTE_MODAL_BASE_CUSTOM_ID}${MODAL_CUSTOM_ID_SEPARATOR}${ADD_QUOTE_MODAL_COUNTER++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Add Quote')
          .addLabelComponents(
            new LabelBuilder()
              .setLabel('Name')
              .setDescription('The name of the quote.')
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(ADD_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID)
                  .setMaxLength(32)
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder('namege')
                  .setRequired(true)
              )
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (modalSubmitInteraction_: ModalSubmitInteraction): boolean =>
              modalSubmitInteraction_.customId === modalCustomId,
            time: 60000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return;

        const quoteName = modalSubmitInteraction.fields.getTextInputValue(
          ADD_QUOTE_MODAL_NAME_TEXT_INPUT_CUSTOM_ID
        );
        if (quoteDatabase.quoteNameExists(userId, quoteName)) {
          await modalSubmitInteraction.reply({
            content: 'There already is a quote added with this name.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const quote: Quote = { content: content, name: quoteName, dateAdded: new Date(Date.now()) };
        quoteDatabase.insert(userId, quote);
        await modalSubmitInteraction.reply({
          content: `Added quote with the name ${quoteName}.`,
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.commandName === CONTEXT_MENU_COMMAND_NAMES.removeQuote) {
        const { quoteDatabase } = databaseManager;

        const userId = interaction.user.id;
        const { content } = interaction.targetMessage;
        const quoteName = quoteDatabase.getQuoteName(userId, content);

        if (quoteName === undefined) {
          await interaction.reply({
            content: 'You do not have a quote added with this link.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const modalCustomId = `${REMOVE_QUOTE_MODAL_BASE_CUSTOM_ID}${MODAL_CUSTOM_ID_SEPARATOR}${REMOVE_QUOTE_MODAL_COUNTER++}`;
        const modal = new ModalBuilder()
          .setCustomId(modalCustomId)
          .setTitle('Are you sure?')
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`You are about to delete '${quoteName}'.`)
          );
        await interaction.showModal(modal);

        const modalSubmitInteraction = await interaction
          .awaitModalSubmit({
            filter: (modalSubmitInteraction_: ModalSubmitInteraction): boolean =>
              modalSubmitInteraction_.customId === modalCustomId,
            time: 30000
          })
          .catch(() => undefined); //timeout catch
        if (modalSubmitInteraction === undefined) return;

        quoteDatabase.delete(userId, { name: quoteName, content: content });
        await modalSubmitInteraction.reply({
          content: `Removed quote ${quoteName}.`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      logError(error, 'Error at contextMenuCommandHandler');

      await defer;
      await interaction.editReply('Failed to provide output.');
    }
  };
}
