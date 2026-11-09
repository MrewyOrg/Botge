# Privacy Policy and deployment notice

Last reviewed: 2026-11-08.

This describes Botge's optional features and known gaps; each host needs a deployment-specific
privacy notice. The **operator** controls configuration, accounts, storage, hosting, logs, and
access. Contact that operator about your data. Repository maintainers do not automatically receive
other operators' databases or logs. Discord separately processes data under its
[privacy policy](https://discord.com/privacy).

## What an operator must publish

Before inviting users, the operator must make a deployment-specific notice readily available and
identify their name/contact route, enabled integrations and AI channels, purposes and applicable
legal bases, recipients, hosting locations and international transfers, retention periods, and how
to request access, correction, export, deletion, or other applicable rights. Explain how to complain
to the relevant regulator where required. Do not assume adding the bot to a server constitutes every
member's consent to AI indexing or sending their messages to another provider. See the
[European Commission's GDPR information](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)
where EU data-protection law applies. Other applicable laws may impose different requirements.

The behavior below does not establish that an operator has the necessary permissions, security,
retention, or request-handling processes.

## Data received and purposes

Botge receives Discord events and interactions for accessible servers/channels and enabled commands.
This can include user, server, channel, role, message and attachment IDs; names and display names;
message text, embeds, attachment/emoji URLs; command options and modal fields; and membership and
permission information. It uses these to authorize actions, retrieve and render emotes, respond to
commands, save selected content, manage settings, and deliver reminders.

Normal message handling recognizes `+` emote and `.` saved-media shortcuts. With Ollama disabled,
ordinary chat is not routinely copied into a persistent conversation database. This does not mean
Botge cannot receive message content, keep temporary interaction state, or produce content-bearing
error logs. Server-wide Message Content access is requested; the Discord message-history SDK cache
is disabled, while other bounded SDK/menu caches remain in memory.

Replies, saved-content listings, reminders, image outputs, translations, and AI explanations can be
visible to other people in the destination channel. Some controls use private interaction replies,
but users should not assume every command is private. `/reminders` can list other reminders in the
server. A context-menu invocation can process another person's selected message.

## Persistent storage and retention

The deployment can store:

- **SQLite settings:** server IDs, broadcaster names, provider emote-set references, added emote
  URLs and aliases, role IDs, user IDs and server assignments, border preferences and legacy opacity
  data.
- **Saved content:** media URLs or quote text, names, owner user IDs, and dates added. Quotes need
  not retain the original author's user ID. Media saving normally stores a reference, not a
  permanent archival copy of the attachment. URLs may expire or contain signed access tokens.
- **Reminders:** creation/due-time information, channel and user IDs, additional recipients, message
  text, and recipient/status flags. Successful delivery normally removes the pending database row;
  failed or unavailable-channel deliveries can leave it stored. Posted reminders remain on Discord.
- **Twitch search:** Meilisearch indexes containing clip API records, such as IDs, URLs, creator and
  broadcaster information, titles, categories, timestamps, counts, and thumbnails. Records are
  associated with a server's index. Updates do not provide comprehensive deletion synchronization or
  automatic expiry. This requires operator review under [TERMS.md](TERMS.md).
- **Credentials/state:** operator-supplied credentials and service URLs in deployment configuration,
  cached Twitch access tokens under `data/`, and command-registration state. The dormant Reddit
  client can cache a token if separately enabled. Keep these out of public reports and repositories.

Settings, saved content, and preferences have no general automatic expiry. Removing Botge from a
server releases live subscriptions/objects, but does not erase its database records, user
assignments, or search index. The operator must define and enforce retention rather than retain
information indefinitely merely because the software permits it.

Emote rendering downloads source images and writes output under `data/tmp`. A request attempts
cleanup when it finishes; startup also clears that temporary directory. A crash or cleanup failure
can leave files until later cleanup. The optional nginx proxy has a separate persistent image cache,
currently configured with 6,000-minute cache validity/inactivity settings and stale-response
support. These settings do not guarantee deletion at an exact age. Cache entries and access logs can
outlive a rendering request. Uploaded attachments remain subject to Discord's retention and users'
copies.

SQLite data is not encrypted by Botge itself. Other services, disk encryption, access restrictions,
backups and retention are the operator's responsibility. Secure the databases and credentials, avoid
publicly exposed unauthenticated services, and include backup copies in the deletion procedure.

## Optional Ollama conversation memory

Ollama is disabled by default. If enabled, eligible non-bot messages in configured
`activeChatChannels` are added to rolling in-memory context and submitted for persistent indexing,
including messages that do not cause a reply. A message that fails processing or exceeds an
admission limit may not be indexed; this is not a complete archive.

The vector record uses the Discord message ID as its record key. It stores author display name,
channel ID, sequence number, timestamp, plaintext message text, and an embedding. The vector text
includes the display name. Bot replies are also indexed. Local sequence-number files track channel
ordering. Display names and embeddings can still identify people.

The configured Ollama endpoint receives text for embeddings, recent conversation text for reply
scoring, and recent/retrieved conversation text for generation. The ChromaDB endpoint receives the
stored text, vectors, and metadata and handles similarity queries. Retrieval is scoped to the
channel, but past messages can influence or appear in later generated replies visible in that
channel. Losing access to a source message on Discord does not itself remove its stored copy.

This code performs inference and retrieval, not model training. It does not implement a chat-record
TTL, user opt-out workflow, account-wide erasure command, or synchronization of Discord message
edits and deletions with ChromaDB. Clearing a Discord channel, removing the bot, disabling Ollama,
or removing an active channel from configuration does not purge persisted history. Restarting clears
process memory but not ChromaDB, logs, or backups. Operators must implement or supply the necessary
request handling and deletion/retention controls before enabling this processing.

## External recipients

Requests generally reveal the deployment's outbound IP and normal transport information to the
recipient. Links and attachment URLs can also be fetched by Discord, providers, or their proxies;
people opening a link contact its destination under that service's rules.

- **OpenAI:** `/chatgpt` sends the prompt and optional image URL. **Explain with ChatGPT** sends the
  selected message text plus image URLs chosen from embeds or attachments. Both send the invoking
  user's Discord ID, without hashing, as `safety_identifier`. OpenAI may fetch those URLs. The
  Responses API calls do not set `store: false`, so the provider's default application-state
  retention applies; this is separate from abuse-monitoring retention. API data is not used for
  training by default, but operator opt-ins/account controls matter. Do not promise zero retention.
  See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- **DeepL:** `/translate` and **Translate to English** send submitted or selected message text.
  Review [DeepL's privacy policy](https://www.deepl.com/en/privacy) and the applicable API plan. Its
  [API terms](https://www.deepl.com/en/pro-license_embedded) restrict personal-data processing on
  the free API Developer plan. The current bot does not detect that plan or redact personal data.
- **Ollama and ChromaDB:** receive the conversation data described above. A `localhost` or container
  hostname is not proof that all processing stays on one host; the configured endpoint, selected
  model, cloud routing, and operator's hosting arrangements determine the recipients and locations.
- **Twitch, 7TV, BTTV and FFZ:** receive provider/broadcaster/set/emote IDs and requests used for
  catalogs, live subscriptions, clips, and source images. Source images may pass through nginx.
- **Tenor/Google:** with `TENOR_API_KEY` configured, media-list previews send saved Tenor IDs and
  API credentials to Tenor's API, then use returned image URLs. Botge does not send a Discord user
  ID in that preview request.
- **Steam/Valve:** `/poe2-stats` requests the game page and aggregate player counts. It does not
  send a Discord user ID or perform Steam-account authentication.
- **Other hosts:** supplied image URLs are fetched for rendering. Custom `EMBED_SERVER_TWITCH`
  endpoints receive clip identifiers when their generated links are fetched. A special server's
  curated clip list is fetched from a public Google-hosted spreadsheet. Twemoji images are fetched
  through jsDelivr. The repository's Reddit client is not wired into current startup or commands; it
  makes no routine Reddit requests in this implementation.

The software does not include an advertising/data-sale feature. Operators must disclose any
additional analytics, resale, transfers, or modified processing they introduce and comply with the
relevant platform restrictions. Self-hosting does not prevent configured external providers from
processing data under their own terms.

## Logs, voice, and copies outside the bot

Botge writes operational/error output to process logs. Current Ollama logging includes channel
names, reply scores/reasons, and generated reply text. Errors from SDKs or subprocesses may contain
URLs, identifiers, content fragments, and diagnostic details. nginx access logs can contain
requested paths and network addresses. Container log rotation is a size limit, not a guaranteed
time-based retention period. Hosting services and backups can keep other copies.

If voice is enabled through `/settings`, Botge stores the server and voice channel IDs in its local
SQLite database so it can rejoin on startup. Clearing the selection removes the active record. Botge
joins self-muted and does not record, transcribe, or process voice.

Deleting a saved record removes the active database entry, not necessarily every recoverable
database page, backup, posted message, or third-party copy. `/temporary` attempts to delete its bot
reply after a delay and `/clear-messages` deletes accessible Discord messages; neither is a deletion
mechanism for ChromaDB, provider-side AI state, source messages elsewhere, screenshots, or backups.

## Requests, choices, and policy changes

Users should contact the deployment's operator for access, correction, export, deletion, retention
questions, or objections to optional processing. Identify the deployment and relevant user/channel/
message IDs privately where possible. Vector metadata uses display names rather than a separate
author-user-ID field, so operators may need message references to locate records accurately; names
can change or be shared by multiple people. Do not submit private request evidence to public issues.

There is no built-in comprehensive export/erasure command. Operators must verify requests
proportionately and address active databases, conversation records/embeddings, memory, caches,
provider-side state and backups as applicable. Restrictions or legal retention requirements should
be explained, not silently treated as an unlimited exemption. Disabling a feature stops its future
configured processing; it does not automatically delete existing copies.

Discord's
[Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
require a reachable modification/deletion request route and deletion in the circumstances they
specify, subject to applicable legal retention duties. This generic notice and an operator contact
are not a substitute for actually fulfilling those requests. Operators should update their notice
and inform affected users of material changes as required before changing how an instance processes
data. For the integration review and known hosting restrictions, see [TERMS.md](TERMS.md).
