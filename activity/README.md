# Botge Emote Browser

Browse the current Discord server’s Botge emotes, search by name or tags, and filter by provider,
animation, or overlay status. Open an emote to copy its name or add it to the composer. The local
browser preview uses the curated catalog or a built-in Botge emoji demo.

## Preview and build

The Activity has its own npm workspace and shares the repository’s lockfile. Browser code lives in
[`src/`](src/), and the Cloudflare entry point and authentication handler live in
[`worker/`](worker/).

From the repository root, run `npm ci` and `npm run dev -w activity`. Open the localhost URL printed
by Vite to preview the Activity in a browser. Run `npm run build -w activity` to write the static
site to `activity/dist/`.

Run these checks from the repository root:

```sh
npm test -w activity
npm run test:coverage -w activity
npm run check:markup -w activity
```

The Activity suite covers the browser and Worker without starting the bot or building the site.
Coverage reports are written to `coverage/activity/` with an 80% minimum for each source file. The
markup check compiles SCSS through Vite and validates the source and built HTML. Tests for the bot’s
Activity API live beside [the Rust API implementation](../src/activity/tests.rs).

## Emote Composer

Open an emote from **Catalog** and select **Add to composer**. Normal emotes form a row, and
overlaying emotes stack on the preceding column. Move or remove inputs to change the layout, then
use **Copy emotes** and paste them into the `emotes` field of Discord’s `/emote-compose` command.
The browser shows an approximate layout. Botge renders the final image.

With the server catalog enabled, the composer uses the server’s emote names and overlaying flags.
When multiple emotes share a name, only the one Botge resolves by that name can be composed. In the
local preview, a curated catalog can mark an entry with `"overlaying": true` to test layers.

Select **Trending this week** or **Top all time** to browse 7TV. In Discord, discovery emotes can be
composed by ID when the operator enables `use7TVAddedEmotes`. Adding them to the composer does not
add them to the server.

Click an emote to see its tags. Right-click for a compact menu of available actions. Use **Select
emotes** to add several to a composition or, if you manage server emotes, add or remove up to 12 at
a time. The tag search uses comma-separated terms. Discovery searches 7TV tags, and the catalog
searches available provider tags and Botge labels such as **Animated**, **Overlaying**, or
**Added**.

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
   `activity/dist/` on a public HTTPS host if you want a public demo.
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

## Server catalog, emote access, and voice

The server catalog shows enabled global emotes, configured guild sets, and individually added
emotes. Members can browse the catalog. Guild administrators can open **Server emote settings** to
configure provider sets and grant add/remove access to role IDs or to all members. Open an emote in
7TV discovery to add it. Open an individually added emote in the catalog to remove it.

Open **Bot voice settings** to select a channel, optionally set the emoji status, or choose **Stay
disconnected**. Botge remembers the selection across restarts.

1. Set the desired provider switches in `botge.config.json`. Enable `use7TVAddedEmotes` for add and
   remove.
2. Add `https://127.0.0.1` to the application's OAuth2 redirects. Set `APP_ID`,
   `DISCORD_ACTIVITY_CLIENT_SECRET`, and `DISCORD_ACTIVITY_PUBLIC_KEY` in the bot environment. The
   Activity requests the `identify` scope, and the bot checks the permissions required by each
   request.
3. Run the Rust bot. On Compose, use `compose.activity.yaml` to publish the API on port 3080 of the
   host loopback interface. On a `botge_control` installation, put its contents in the installed
   `compose.override.yaml`.
4. Map `/botge-api` to your HTTPS proxy or Funnel for that API. Keep the root mapping on the
   Activity Worker's hostname.
5. Build the site and publish it as described below:

   ```sh
   VITE_ENABLE_ACTIVITY_CATALOG=true VITE_ENABLE_ACTIVITY_SETTINGS=true \
     VITE_ENABLE_7TV_DISCOVERY=true VITE_ENABLE_ACTIVITY_ADDS=true npm run build -w activity
   ```

Add the CDN mappings for the providers you enable:

| Prefix        | Target                 |
| ------------- | ---------------------- |
| `/7tv-cdn`    | `cdn.7tv.app`          |
| `/bttv-cdn`   | `cdn.betterttv.net`    |
| `/ffz-cdn`    | `cdn.frankerfacez.com` |
| `/twitch-cdn` | `static-cdn.jtvnw.net` |

## Proxy authentication

The Rust API requires Discord’s signed proxy headers for Activity requests:

1. Enable **Proxy Authentication** in Botge’s **Activities → Settings**.
2. Copy the application **Public Key** from **General Information** into
   `DISCORD_ACTIVITY_PUBLIC_KEY` in the bot’s `.env`.
3. Recreate the bot container so it reads the updated environment. If you use a reverse proxy or
   tunnel for `/botge-api`, let it forward `X-Signature-Ed25519`, `X-Signature-Timestamp`, and
   `X-Discord-Proxy-Payload`.

The Activity API rejects missing, invalid, and expired signatures before exchanging an OAuth code.
Server settings require a membership check. **My emote border** saves the color for the
authenticated Discord user. Configure the public key on the Worker and in the bot environment.

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
