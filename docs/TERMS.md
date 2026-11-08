# Terms of Service and hosting guidance

Last reviewed: 2026-11-08.

Botge is self-hosted software. The **operator** runs an instance and must review these use and
integration requirements. These terms do not certify legal clearance for features, images, or
deployments. Provider terms can change; linked originals and negotiated agreements control.

The operator must publish their identity, contact details, applicable deployment terms, and a
[privacy notice](PRIVACY.md) before inviting users. Repository maintainers do not automatically
operate or support another person's instance. Mandatory consumer and privacy rights remain
unaffected.

## Software, artwork, and user content

Botge's software license is [MIT](../LICENSE.txt). It permits hosting, modification, and
redistribution subject to its notice requirements. Deployment rules do not remove those
software-license rights. The license does not grant rights in third-party emotes, clips, GIFs,
brands, or submitted content.

The supplied `assets/botge-icon.png` and `assets/banner.png` were generated with OpenAI tools. They
may be reused with Botge under the repository's license to the extent the project has rights to
grant. AI generation is not proof of non-infringement, exclusivity, trademark availability, or
copyright protection. OpenAI assigns its output rights to the customer to the extent permitted by
law, but outputs can resemble other outputs and third-party rights remain applicable. See the
applicable [OpenAI terms](https://openai.com/policies/eu-terms-of-use/) and
[services agreement](https://openai.com/policies/services-agreement/). No trademark-clearance search
has been performed for these assets. In the United States, purely AI-generated expression is not
copyrightable without sufficient human authorship; other jurisdictions may differ. See the
[Copyright Office's AI report](https://www.copyright.gov/newsnet/2025/1060.html).

Users must have the rights or other lawful authorization needed for material they ask Botge to save,
quote, translate, analyze, render, or publish, including someone else's selected message or
attachment. Submitting content does not transfer ownership to Botge or waive another person's
rights. Uploading through a bot still requires the rights necessary under
[Discord's terms](https://discord.com/terms).

## Discord and acceptable use

Users must follow Discord's [terms](https://discord.com/terms) and
[Community Guidelines](https://discord.com/guidelines). Operators must also follow the
[Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
and [Developer Policy][discord-developer-policy], including permitted API access, necessary intents,
data security, deletion requests, and applicable app-review requirements.

Do not use an instance for illegal content, intellectual-property infringement, sexual exploitation,
hate or harassment, graphic violence, malware, phishing, unsolicited messaging, or attacks on other
accounts or services. Do not circumvent provider authentication, subscriptions, access controls,
quotas, or feature restrictions. The operator may restrict access or disable integrations when
necessary to enforce these rules or provider requirements.

## Emotes and generated images

This applies to `/emote`, `/emote-compose`, `/emote-search`, `/emote-add`, `/emote-shortcuts`, and
the `+` message shortcut. Some paths display provider images; rendering paths fetch image data,
process it with FFmpeg, and upload a new Discord attachment. The optional nginx cache also retains
source images. Public CDN access, an API response, an uploader's approval, or an open-source client
license does not by itself establish the rights to all artwork or its underlying characters and
photographs.

- **7TV**: Its terms retain uploader ownership and grant service-related rights to 7TV. No blanket
  license for Botge to modify and publish all emotes elsewhere was found. Obtain appropriate rights
  and clarify provider permission for this use. [Terms](https://7tv.app/tos).
- **BetterTTV (BTTV)**: Its terms provide a copyright complaint process, but no express blanket
  license for arbitrary off-platform modification and redistribution was found. Do not treat public
  availability as permission. [Terms](https://betterttv.com/terms).
- **FrankerFaceZ (FFZ)**: Its terms expressly require permission from both FFZ and the original
  owner for downloading, hosting, modifying, or redistributing hosted content. API access by
  applications unrelated to Twitch also needs permission. Treat this integration as requiring
  explicit clearance. [Terms](https://www.frankerfacez.com/terms).
- **Twitch emotes**: Published trademark guidance requires express permission for emote use and
  warns of third-party rights. Global emotes are excluded from the developer agreement's definition
  of Program Materials. Do not interpret API access as a blanket artwork license.
  [Guidelines](https://www.twitch.tv/p/nl-nl/legal/trademark/),
  [agreement](https://legal.twitch.com/legal/developer-agreement).

These findings distinguish an express restriction from a permission that could not be confirmed;
they do not establish that every individual use is unlawful. Own or properly licensed artwork and
applicable legal exceptions can change the result. Resizing, stretching, recoloring, overlaying, or
combining images does not automatically supply authorization or make a use exempt from copyright.
Attribution alone cannot replace a required license. Link-only output is not an automatic exception
to provider API terms either.

Unicode emoji rendered by Botge use [Twemoji](https://github.com/jdecked/twemoji). Its graphics are
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), separately from its MIT
code. Credit Twemoji and its contributors, link the license and source, and identify modifications
when sharing adapted artwork. Botge can resize and combine those graphics. This notice records the
project's attribution; operators must make appropriate attribution available in their deployment and
outputs as required. Discord custom emoji and external image URLs have their own rights
requirements.

FFmpeg's software license does not license the media it processes. Image/container distributors must
also retain applicable notices and satisfy the actual FFmpeg build's LGPL/GPL and dependency
obligations. See [FFmpeg's legal guidance](https://www.ffmpeg.org/legal.html).

## Twitch clips: links, indexing, and optional embed services

`/clip` normally posts the clip's Twitch URL. It does **not** download, modify, or re-upload the
video. Sharing an available original link matches Twitch's documented sharing mechanism. This is
narrower than permission to copy the video elsewhere. See [Twitch sharing guidance][twitch-sharing].

There are two unresolved deployment-dependent issues:

- **Persistent metadata:** Botge stores API clip records in Meilisearch. Scheduled refreshes
  normally update/add records rather than remove every disappeared clip; there is no automatic index
  expiry. The indexed developer agreement restricts stored copies, limits its temporary-cache
  exception, requires honoring deletions, and restricts re-syndication of API data. A two-hour
  refresh is not itself a retention or deletion policy. Operators need an applicable
  authorization/exception and lifecycle controls before treating the current index as cleared.
- **Custom embeds:** setting `EMBED_SERVER_TWITCH` replaces the original URL with an external
  service URL. This repository does not implement that service, so its behavior was not reviewed.
  Check whether it redirects, uses the authorized Twitch player, proxies video, or hosts its own
  files. Do not assume it has the same permission as sharing an original link. Website player
  requirements apply when using Twitch's [embed integration][twitch-embedding].

See the [developer agreement][twitch-agreement], especially Schedule 1's storage requirements.
Twitch's current legal pages rendered incompletely during this review; some agreement and emote
findings rely on indexed official text. Verify the latest wording and any account-specific
permissions with Twitch. **The default link-sharing path is supported; the complete current
indexing/custom-embed setup has not been established as compliant.**

## Other commands and integrations

### Saved media, quotes, and Tenor

`/media`, `/media-list`, `/quote`, `/quote-list`, their save/delete context menus, and the `.`
shortcut store or redisplay user-selected content. Media records store URLs, not permanent archival
copies of all files. Do not save or republish another person's private message, image, or quote
without the necessary rights and privacy authorization. Names and references do not guarantee future
availability.

The optional Tenor API resolves saved Tenor URLs into preview images. Tenor requires visible
attribution for retrieved content, such as its prescribed browsing/shared-GIF labels. The current
media builder links the source but has no explicit Tenor attribution label; operators must resolve
that display gap before relying on API previews as compliant. A Tenor result does not clear every
underlying right. See
[Tenor attribution requirements](https://developers.google.com/tenor/guides/attribution).

### OpenAI and Ollama

`/chatgpt` and **Explain with ChatGPT** send content to the operator's OpenAI API account. The
context menu can send another person's message and image/attachment URLs. Operators must have
authority to process those inputs, enforce applicable age/access restrictions and
[usage policies](https://openai.com/policies/usage-policies/), and follow the
[API services agreement](https://openai.com/policies/services-agreement/). Outputs may be wrong or
infringing and should not be represented as guaranteed accurate or human-authored.

Optional Ollama chat embeds, stores, retrieves, and analyzes messages from configured channels even
when nobody invokes a command or receives a reply. The code performs inference and retrieval, not
model training. Discord's policy prohibits training AI/ML models on API message content without
Discord's express permission; user consent alone does not override that restriction. Do not enable
provider training/data-sharing options or train on collected messages on that assumption. Inference
still needs a disclosed, permitted purpose and appropriate privacy authorization. Review the
selected models' licenses and any hosted [Ollama service terms](https://ollama.com/terms); a
runtime's software license does not license every model. Retention/deletion gaps are described in
[PRIVACY.md](PRIVACY.md).

### Translation

`/translate` and **Translate to English** send supplied or selected message text to DeepL. Its
current API terms require disclosure of unmodified API output using DeepL branding/domain unless
otherwise agreed. Current replies contain only translated text, so that disclosure needs attention.
The free API Developer plan prohibits processing personal data; a paid plan still needs appropriate
legal authorization and processing arrangements. Botge does not detect the plan or remove personal
data. See [DeepL API terms](https://www.deepl.com/en/pro-license_embedded), sections 8.1 and 8.3.

### Steam statistics and dormant Reddit code

`/poe2-stats` combines Steam's player-count API with review summaries parsed from Steam store HTML.
The [Web API terms](https://steamcommunity.com/dev/apiterms) allow documented API uses subject to
conditions, limits, and no implied endorsement; that is not blanket authorization for website
scraping. Review the separate store-page fetching against Valve's current
[Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/) and access rules or use
an authorized interface. The combined implementation has not received legal clearance.

A Reddit client exists in the repository, but current startup/command wiring does not invoke it. If
enabling it, obtain required API approval, including separate commercial authorization where
applicable, and comply with attribution, approved-use and deletion requirements. A token alone does
not establish approval. See [Reddit's Data API terms](https://redditinc.com/policies/data-api-terms)
and [Responsible Builder Policy][reddit-builder-policy].

### Reminders, temporary messages, settings, and emoji grids

`/remind` and `/reminders` publish reminder content and mentions into Discord channels; avoid spam
and unwanted mentions. Server reminder listings may reveal messages to other server members.
`/temporary` tries to delete its reply after the delay, but is not a confidentiality or erasure
guarantee; restarts, errors, recipients, and service retention can preserve copies.
`/clear-messages` is destructive and only removes Discord messages it can access, not copies in
Botge's stores, AI providers, or backups. `/settings` changes access and preferences; it does not
grant content licenses or erase stored data. `/emoji-hunt` uses server emoji; the same Discord and
artwork rules apply.

## Operator responsibilities and service terms

Before hosting, publish enabled features, recipients, retention periods, a reachable privacy/contact
route, and the rights-handling procedure described in [PRIVACY.md](PRIVACY.md). Only enable features
for which the required permissions and operational controls are in place. Source-provider defaults
and an enabled command are technical settings, not legal approval. Disabling slash commands alone
may leave message shortcuts, provider loading, caches, and background integrations active.

This review records known gaps; publishing these terms does not repair them, secure permissions,
remove cached data, or implement retention and attribution. Keep provider credentials private and
respect quotas, deletion notices, and takedown requests. For a commercial or public deployment with
uncertain rights, obtain provider clarification and advice for the relevant jurisdiction.

Botge is provided as is under its software license. Integrations may change or stop working, and AI
or translated output can be inaccurate. Operators may limit or discontinue their service, subject to
applicable law and their published commitments. No term excludes liability or statutory rights that
cannot lawfully be excluded. Operators must provide any jurisdiction-specific terms they require and
notify users of material changes as applicable; this document does not select a jurisdiction for all
independent hosts.

For deployment access, privacy, or copyright requests, contact that deployment's operator. The
[issue tracker](https://github.com/MrewyOrg/Botge/issues) is for software issues; do not post
private messages, credentials, or deletion-request evidence there.

[twitch-sharing]: https://help.twitch.tv/s/article/how-to-share-a-stream?language=en_US
[twitch-embedding]: https://dev.twitch.tv/docs/embed/video-and-clips/
[twitch-agreement]: https://legal.twitch.com/legal/developer-agreement
[discord-developer-policy]:
  https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy
[reddit-builder-policy]:
  https://support.reddithelp.com/hc/en-us/articles/16471395473812-Moderation-Bots-Tooling
