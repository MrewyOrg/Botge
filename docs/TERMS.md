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

The supplied `assets/botge-icon.png` and `activity/src/assets/banner.png` were generated with OpenAI
tools. They may be reused with Botge under the repository's license to the extent the project has
rights to grant. AI generation is not proof of non-infringement, exclusivity, trademark
availability, or copyright protection. OpenAI assigns its output rights to the customer to the
extent permitted by law, but outputs can resemble other outputs and third-party rights remain
applicable. See the applicable [OpenAI terms](https://openai.com/policies/eu-terms-of-use/) and
[services agreement](https://openai.com/policies/services-agreement/). No trademark-clearance search
has been performed for these assets. In the United States, purely AI-generated expression is not
copyrightable without sufficient human authorship; other jurisdictions may differ. See the
[Copyright Office's AI report](https://www.copyright.gov/newsnet/2025/1060.html).

Users must have the rights or other lawful authorization needed to render or publish material with
Botge, including someone else's attachment. Submitting content does not transfer ownership to Botge
or waive another person's rights. Uploading through a bot still requires the rights necessary under
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

`/emote-compose` and the `+` message shortcut download images, process them with FFmpeg, and upload
Discord attachments. The optional nginx cache retains source images. Public CDN or API access and
open-source software licenses do not establish rights to the artwork. The Activity’s optional 7TV
discovery displays provider-hosted images and lets authorized members save references.

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

FFmpeg's software license does not license the media it processes. Image/container distributors must
also retain applicable notices and satisfy the actual FFmpeg build's LGPL/GPL and dependency
obligations. See [FFmpeg's legal guidance](https://www.ffmpeg.org/legal.html).

## Server controls

`/clear-messages` deletes earlier unpinned messages in the selected channel after administrator
confirmation. Copies held by Discord, recipients, or backups may remain.

## Operator responsibilities and service terms

Before hosting, publish enabled features, recipients, retention periods, a reachable privacy/contact
route, and the rights-handling procedure described in [PRIVACY.md](PRIVACY.md). Only enable features
for which the required permissions and operational controls are in place. Source-provider defaults
and an enabled command are technical settings, not legal approval. Disable provider switches and the
message shortcut separately when withdrawing access.

This review records known gaps; publishing these terms does not repair them, secure permissions,
remove cached data, or implement retention and attribution. Keep provider credentials private and
respect quotas, deletion notices, and takedown requests. For a commercial or public deployment with
uncertain rights, obtain provider clarification and advice for the relevant jurisdiction.

Botge is provided as is under its software license. Integrations may change or stop working.
Operators may limit or discontinue their service, subject to applicable law and their published
commitments. No term excludes liability or statutory rights that cannot lawfully be excluded.
Operators must provide any jurisdiction-specific terms they require and notify users of material
changes as applicable; this document does not select a jurisdiction for all independent hosts.

For deployment access, privacy, or copyright requests, contact that deployment's operator. The
[issue tracker](https://github.com/MrewyOrg/Botge/issues) is for software issues; do not post
private messages, credentials, or deletion-request evidence there.

[discord-developer-policy]:
  https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy
