# Privacy Policy and deployment notice

Last reviewed: 2026-11-19.

This describes Botge's optional features and known gaps; each host needs a deployment-specific
privacy notice. The **operator** controls configuration, accounts, storage, hosting, logs, and
access. Contact that operator about your data. Repository maintainers do not automatically receive
other operators' databases or logs. Discord separately processes data under its
[privacy policy](https://discord.com/privacy).

## What an operator must publish

Before inviting users, the operator must make a deployment-specific notice readily available and
identify their name/contact route, enabled integrations, purposes and applicable legal bases,
recipients, hosting locations and international transfers, retention periods, and how to request
access, correction, export, deletion, or other applicable rights. Explain how to complain to the
relevant regulator where required. See the
[European Commission's GDPR information](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)
where EU data-protection law applies. Other applicable laws may impose different requirements.

The behavior below does not establish that an operator has the necessary permissions, security,
retention, or request-handling processes.

## Data received and stored

The bot receives Discord interaction options, guild and channel IDs, voice state events, and guild
member join, update and leave events. It keeps guilds' roles and channels and members' roles in
memory to check Activity permissions and does not store them. The Activity uses Discord OAuth with
the `identify` scope. Botge exchanges the short-lived code and checks guild membership and roles for
catalog, server settings, and added-emote requests. The personal emote border setting uses the
authenticated Discord user ID.

When the operator enables the `+` emote shortcut, the bot receives message content and checks for
that prefix. It uses matching message contents to resolve emotes and reply, without storing them.

The redb file stores guild voice selections, voice status text, provider set references, role IDs,
the guild's emote-management setting, metadata for individually added emotes, and emote border
colors keyed by Discord user ID. Botge retains up to 32 managed catalog revisions per guild.
Revisions contain saved emote references, 7TV set and role settings, timestamps, and the Discord
account ID of the member who made the edit. Only current guild administrators can read or restore
history. The operator controls the database and its backups.

`/clear-messages` fetches Discord channel history to check message IDs and pin status. The bot uses
that history during deletion and does not store it.

Emote renders download provider or Discord images and create temporary files, which the renderer
removes when the request ends. The rendered attachment is sent to Discord. nginx may retain provider
images in its cache. The operator can make the bot API reachable through a public HTTPS tunnel or
reverse proxy.

## Activity, logs, and retention

The Go origin verifies Discord's signature before serving the Activity page or assets. Its request
logs record status, duration and byte count. Optional 7TV discovery sends searches, filters, and
page requests through Discord’s Activity proxy. 7TV receives requests for emote catalogs, set
updates, and images. When opening the server catalog or changing settings, Botge verifies Discord's
signed proxy metadata. OAuth access tokens stay in Activity memory until renewal or closure and are
sent to the bot with each API operation. Botge does not persist them, and the browser does not put
them in local storage. To avoid asking Discord on every operation, the bot keeps a keyed hash of
each token with its account ID in memory for up to five minutes, and member records it fetched from
Discord for up to 30 seconds.

An open server catalog keeps a connection to the bot that reports when the catalog changed. It
carries no catalog data and closes within an hour. In the guessing game, players in the same
Activity instance see each other's Discord account IDs, scores, round winners, and wrong guesses
shortened to 40 characters. Rooms exist only in memory and end when every player leaves.

Botge joins the configured voice channel muted and does not record or transcribe voice. Clearing the
setting removes the saved channel ID. Botge stores the optional channel status and its toggle.

Botge writes operational and error logs. Logs can contain identifiers, image URLs, and diagnostics.
nginx may record requested paths and network addresses. Discord and recipients can retain uploaded
attachments. Removing a database record does not erase existing backups or third-party copies.

## iOS app

The operator can enable the iOS app API with `BOTGE_APP_API=true`. The app opens Discord's login
page in the system sign-in sheet, which keeps the Discord password out of the app, and requests only
the `identify` scope. It exchanges the code with Discord itself using PKCE and keeps the resulting
access and refresh tokens in the device Keychain, available only on that device and excluded from
backups and iCloud. Logging out revokes the access token when Discord is reachable and deletes both.

The app sends the access token to the operator's Botge server with each request, as the Activity
does, and the server applies the same membership checks and token handling described above. To list
servers in the app, Botge checks the caller's membership in each server it has joined. App players
in the guessing game share a room with other app players, not with a Discord Activity. A room is
named by a code that players share themselves; Botge keeps rooms, scores and wrong guesses only in
memory while the room is open, as for the Activity.

During a match the app shows a Live Activity on the Lock Screen and in the Dynamic Island with the
server name, round, countdown, score and place. It is created and updated on the device without a
push server, so it is visible to anyone who can see the locked phone, and it ends with the match.
With App Lock on, a match's Live Activity shows only the round and countdown; the server name and
score are never handed to iOS. Siri, Spotlight and Shortcuts can open the app to search emotes or
the Guess tab; a spoken search is handled by Siri under Apple's terms, and the app receives only the
search text, which stays on the device.

App settings, including the chosen server, stay on the device. Face ID or the passcode is checked by
iOS; Botge never receives biometric data. Emote images are downloaded from the providers' CDNs and
cached on the device until the cache is cleared in Settings or iOS removes it. The last loaded
server catalog and 7TV rankings are also kept in the device's cache, so they show at once on the
next launch; clearing the cache or logging out deletes them. Optional 7TV discovery sends searches
directly from the device to 7TV. The app contains no analytics, advertising, or tracking, and its
privacy manifest declares no collected data.

## Data requests

Contact the deployment's operator for access, correction, export, deletion, or retention requests.
Identify the relevant deployment and account or server privately. Keep private evidence out of
public issues. Botge does not provide a comprehensive export or deletion command. Operators must
verify requests and address stored settings, logs, caches, and backups as applicable.

Discord's [Developer Terms][discord-developer-terms] require an accessible route for modification
and deletion requests. See the [hosting terms](TERMS.md) for provider restrictions.

[discord-developer-terms]:
  https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service
