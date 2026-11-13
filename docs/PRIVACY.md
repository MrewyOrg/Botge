# Privacy Policy and deployment notice

Last reviewed: 2026-11-10.

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

The bot receives Discord interaction options, guild and channel IDs, and voice state events. The
Activity uses Discord OAuth with the `identify` scope. Botge exchanges the short-lived code and
checks guild membership and roles for catalog, server settings, and added-emote requests. The
personal emote border setting uses the authenticated Discord user ID.

When the operator enables the `+` emote shortcut, the bot receives message content and checks for
that prefix. It uses matching message contents to resolve emotes and reply, without storing them.

The redb file stores guild voice selections, voice status text, provider set references, role IDs,
the guild's emote-management setting, metadata for individually added emotes, and emote border
colors keyed by Discord user ID. The operator controls retention and deletion.

`/clear-messages` fetches Discord channel history to check message IDs and pin status. The bot uses
that history during deletion and does not store it.

Emote renders download provider or Discord images and create temporary files, which the renderer
removes when the request ends. The rendered attachment is sent to Discord. nginx may retain provider
images in its cache. The Activity frontend is served by Cloudflare, and the bot API can be reached
through the operator's HTTPS tunnel.

## Activity, logs, and retention

Optional 7TV discovery sends searches, filters, and page requests through Discord’s Activity proxy.
Enabled providers receive requests for emote catalogs, set updates, and images. When opening the
server catalog or changing settings, Botge verifies Discord's signed proxy metadata. OAuth access
tokens stay in Activity memory until renewal or closure and are sent to the bot for identification
on each API operation. Botge does not persist them; the browser does not put them in local storage.

Botge joins the configured voice channel muted and does not record or transcribe voice. Clearing the
setting removes the saved channel ID. Botge stores the optional channel status and its toggle.

Botge writes operational and error logs. Logs can contain identifiers, image URLs, and diagnostics.
nginx may record requested paths and network addresses. Discord and recipients can retain uploaded
attachments. Removing a database record does not erase existing backups or third-party copies.

## Data requests

Contact the deployment's operator for access, correction, export, deletion, or retention requests.
Identify the relevant deployment and account or server privately. Keep private evidence out of
public issues. Botge does not provide a comprehensive export or deletion command. Operators must
verify requests and address stored settings, logs, caches, and backups as applicable.

Discord's [Developer Terms][discord-developer-terms] require an accessible route for modification
and deletion requests. See the [hosting terms](TERMS.md) for provider restrictions.

[discord-developer-terms]:
  https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service
