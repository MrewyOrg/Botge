# Botge Emote Browser

The Activity can browse the current Discord server’s Botge emotes. Search by name, filter by source
or animation, and open a preview to copy the name. The local browser preview uses the curated
catalog or a built-in Botge emoji demo.

## Preview and build

The Activity has its own npm workspace and shares the repository’s lockfile. Browser code lives in
[`src/`](src/), and the Cloudflare entry point and authentication handler live in
[`worker/`](worker/).

From the repository root, run `npm ci` and `npm run dev -w activity`. Open the localhost URL printed
by Vite to preview the Activity in a browser. Run `npm run build -w activity` to write the static
site to `dist/activity/`.

Run `npm test -w activity` from the repository root to test the catalog, discovery, API, and Worker.
Run `npm run check:markup -w activity` to compile SCSS through Vite and validate the source and
built HTML.

## Emote Composer

Open an emote from **Catalog** and select **Add to composer**. Normal emotes form a row, and
zero-width emotes stack on the preceding column. Move or remove inputs to change the layout, then
use **Copy emotes** and paste them into the `emotes` field of Discord’s `/emote-compose` command.
The browser shows an approximate layout. Botge renders the final image.

With the server catalog enabled, the composer uses the server’s emote names and zero-width flags.
When multiple emotes share a name, only the one Botge resolves by that name can be composed. In the
local preview, a curated catalog can mark an entry with `"zeroWidth": true` to test layers.

## Publish a catalog

Add entries to `public/catalog.json` and put their images under `public/emotes/` before building.
For example:

```json
[
  {
    "name": "ExampleWave",
    "source": "Community",
    "image": "emotes/example-wave.webp",
    "animated": false
  }
]
```

Use artwork you have permission to publish publicly. Anyone with the site URL can load the catalog
and images. This version uses no user accounts, bot credentials, or server data.

## Launch in Discord

1. Deploy the [protected Cloudflare Worker](#protect-the-hosted-entry-page), or serve
   `dist/activity/` on a public HTTPS host if you want a public demo.
2. In Botge’s Discord Developer Portal, open **Activities → URL Mappings** and point `/` at that
   host. Enable **Activities** under **Activities → Settings**.
3. Open **Botge** in Discord’s App Launcher and choose **Launch**. Discord creates that entry point
   when Activities are enabled.

The frontend gets the application ID from Discord’s Activity proxy hostname and connects through the
Embedded App SDK. The browser preview skips that connection.

[Discord’s Activity setup guide][discord-setup] covers the portal setup.

[discord-setup]: https://docs.discord.com/developers/activities/building-an-activity

## 7TV discovery

Enable the public, non-NSFW 7TV Top and Trending views at build time after reviewing the
[hosting terms](../docs/TERMS.md#emotes-and-generated-images):

```sh
VITE_ENABLE_7TV_DISCOVERY=true npm run build -w activity
```

For Discord, add these URL mappings alongside the existing `/` mapping:

| Prefix     | Target        |
| ---------- | ------------- |
| `/7tv-api` | `7tv.io`      |
| `/7tv-cdn` | `cdn.7tv.app` |

Deploy the rebuilt site as described above. Use the same flag with `npm run dev -w activity` to
preview discovery locally.

### Add to this server

This optional action uses Botge’s added-emote catalog for the Discord server where the Activity is
open. It checks the same add permissions and duplicates as `/emote-add`. Use **Open on 7TV** to
manage an upstream set through 7TV.

1. Enable `general.use7TVAddedEmotes` in the bot’s configuration.
2. In Discord’s **OAuth2** page, add `https://127.0.0.1` under **Redirects** as the Activity
   placeholder. Set `DISCORD_ACTIVITY_CLIENT_SECRET` in the bot’s `.env` to the Client Secret from
   that page. The Activity requests only the `identify` scope for an add. Botge exchanges the code
   and checks the user’s Discord server membership and roles before writing.
3. Run the updated bot. For Compose, add `-f compose.activity.yaml` after the base stack file to
   publish the API on the host’s loopback interface at port 3080. On a `botge_control` installation,
   put the contents of that override in `compose.override.yaml` alongside the installed
   `compose.yaml`, then recreate the Botge container.
4. Point a public HTTPS reverse proxy or tunnel at `http://127.0.0.1:3080`. Add the `/botge-api` URL
   mapping with that public hostname as the target.
5. Build and upload the static site with both feature flags:

   ```sh
   VITE_ENABLE_7TV_DISCOVERY=true VITE_ENABLE_ACTIVITY_ADDS=true npm run build -w activity
   ```

The OAuth2 secret belongs in the bot’s environment. Test **Add to this server** from a 7TV discovery
result inside Discord with a user permitted to add emotes.

## Server catalog

Use **Platform** to pick a provider and **Added emotes** to show only individually added entries.

Enable `VITE_ENABLE_ACTIVITY_CATALOG=true` when building the Activity. In Discord, **Catalog** then
shows the current server’s enabled global, configured set, and individually added emotes. Members
can read the catalog, and **Refresh server emotes** reloads it. The local browser preview uses the
curated catalog.

Set up the same OAuth2 redirect, bot-side secret, HTTPS endpoint, and `/botge-api` mapping described
under [Add to this server](#add-to-this-server). Browsing does not require
`general.use7TVAddedEmotes`. Botge verifies server membership before returning emote metadata.

Add the CDN mappings for the providers the server uses:

| Prefix        | Target                 |
| ------------- | ---------------------- |
| `/7tv-cdn`    | `cdn.7tv.app`          |
| `/bttv-cdn`   | `cdn.betterttv.net`    |
| `/ffz-cdn`    | `cdn.frankerfacez.com` |
| `/twitch-cdn` | `static-cdn.jtvnw.net` |

To enable the server catalog, discovery, and adds in one build:

```sh
VITE_ENABLE_ACTIVITY_CATALOG=true VITE_ENABLE_7TV_DISCOVERY=true \
  VITE_ENABLE_ACTIVITY_ADDS=true npm run build -w activity
```

## Proxy authentication

To require Discord’s signed proxy headers for catalog reads and emote adds:

1. Enable **Proxy Authentication** in Botge’s **Activities → Settings**.
2. Copy the application **Public Key** from **General Information** into
   `DISCORD_ACTIVITY_PUBLIC_KEY` in the bot’s `.env`.
3. Recreate the bot container so it reads the updated environment. If you use a reverse proxy or
   tunnel for `/botge-api`, let it forward `X-Signature-Ed25519`, `X-Signature-Timestamp`, and
   `X-Discord-Proxy-Payload`.

With the key configured, the Activity API rejects missing, invalid, and expired signatures before
exchanging an OAuth code. OAuth and server membership checks still apply. The frontend build needs
no key or additional flags.

See [Discord’s proxy authentication guide][discord-proxy-auth].

[discord-proxy-auth]:
  https://docs.discord.com/developers/activities/development-guides/multiplayer-experience#validating-proxy-request-headers

### Protect the hosted entry page

The [Worker configuration](wrangler.jsonc) serves the Activity HTML only after verifying Discord’s
proxy signature. Direct visits receive `401` and a message to open Botge in Discord. JavaScript,
CSS, and images still use Cloudflare’s static asset serving. The local Vite preview works as usual.

Enable **Proxy Authentication** in Discord and build the Activity with the flags you want. From the
repository root, deploy using the application’s **Public Key** from **General Information**:

```sh
npm exec --ignore-scripts --package=wrangler -- wrangler deploy --config activity/wrangler.jsonc \
  --var DISCORD_ACTIVITY_PUBLIC_KEY:YOUR_APPLICATION_PUBLIC_KEY
```

This is the same public key used by the bot API. Keep `/` mapped to the Worker hostname. After
deploying, open the Worker URL directly to check for `401`, then launch Botge inside Discord to
confirm that Discord signs the initial page request.
