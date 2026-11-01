<!-- @format -->

# Privacy Policy

This policy describes the data processed by the Botge software. The exact data processed depends on
which optional integrations are configured and on the operator's deployment of the bot. Discord also
processes data under its own [Privacy Policy](https://discord.com/privacy).

## Data received and processed

Botge receives Discord gateway events and interactions needed to operate the bot. Depending on the
event or command, this can include:

- Discord IDs for users, guilds, channels, roles, messages, and attachments;
- display names and other Discord metadata needed to identify the sender or target;
- command options, modal fields, message content, embeds, attachment URLs, and emoji information;
- guild permissions and role information needed to authorize settings and emote commands.

Ordinary messages are not saved by the standard command handlers. However, the optional Ollama chat
feature processes messages in the configured active channels, including messages that do not cause a
reply. It stores their author display name, message content, message ID, channel ID, and timestamp
in the configured persistent ChromaDB vector store. Bot replies are also indexed. The feature
additionally keeps a rolling in-memory context buffer.

## Data stored by Botge

The local databases and services can contain the following:

- `guildId`, broadcaster/Twitch name, configured 7TV/BTTV/FFZ emote-set identifiers, added emote
  URLs and aliases, and permitted role IDs;
- `userId`, the associated `guildId`, and emote display preferences (border enabled, color, and
  opacity);
- user-associated media names, media URLs, and the date they were added;
- user-associated quote names, quote content, and the date they were added;
- scheduled ping times, user IDs, channel IDs, optional ping messages, selected user IDs, and ping
  status;
- when the optional chat feature is enabled, message text and metadata in ChromaDB plus local
  sequence-number data used for retrieval.

Media, quotes, guild settings, emote settings, and user preferences remain stored until deleted by
the relevant command or by the Botge operator. Scheduled pings are normally deleted after they are
delivered; a pending ping remains stored until then. The code does not currently implement an
automatic retention period for ChromaDB chat records. Operators should therefore configure and purge
their databases according to their intended retention period.

Botge writes operational and error output to its process logs. In the Ollama chat feature, logs can
include prompts, generated replies, and error details. Log retention is controlled by the operator's
hosting environment.

## Data shared with third parties

Botge sends data to third parties only when the corresponding feature or integration is enabled:

- `/chatgpt` sends the supplied prompt and any supplied image URL to OpenAI. It also sends the
  Discord user ID as OpenAI's `safety_identifier` for abuse detection. See
  [OpenAI's Privacy Policy](https://openai.com/policies/privacy-policy).
- `/translate` sends the supplied text to DeepL.
- The optional Ollama and ChromaDB services receive chat text and metadata described above. They may
  be local services or separately hosted services, depending on configuration.
- Twitch, Reddit, 7TV, BetterTTV, FrankerFaceZ, Steam, Tenor, Discord, and other configured
  providers receive the identifiers, URLs, or requests needed for their respective features. Their
  own privacy policies and retention practices apply.

Botge does not sell personal data. A self-hosted operator controls the databases, logs, configured
services, and any additional data processing performed by their deployment.

## Changes to This Policy

We may update our Privacy Policy from time to time. Any changes will be posted on this page, and we
encourage you to review our Privacy Policy periodically.
