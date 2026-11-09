# <img src="assets/botge-icon.png" alt="Botge logo" width="48" height="48"> Botge

[![Version](https://img.shields.io/github/package-json/v/MrewyOrg/Botge)](package.json)
[![Build and deploy](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml/badge.svg?event=pull_request)](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml?query=event%3Apull_request)
[![Coverage threshold: 80% per file](https://img.shields.io/badge/coverage_threshold-80%25_per_file-blue)](vitest.config.ts)
[![CodeQL](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml/badge.svg?branch=main&event=push)](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml?query=branch%3Amain+event%3Apush)
[![License](https://img.shields.io/github/license/MrewyOrg/Botge)](LICENSE.txt)

Botge brings Twitch-style emotes to Discord, including search, composition, and zero-width overlays.
It also supports Twitch clips, saved media and quotes, reminders, translation, and AI.

## Features

- **Emotes:** `/emote` and `/emote-search` search 7TV, BTTV, FFZ, and Twitch. `/emote-compose`
  combines emotes, emoji, and images, including animated and zero-width overlays.
- **Emote tools:** `/emote-add` adds emotes; `/emote-shortcuts` finds the shortest text that
  uniquely identifies each emote.
- **Twitch clips:** `/clip` searches a configured channel's clips by title, creator, or category.
- **Saved content:** `/media`, `/media-list`, `/quote`, and `/quote-list` save and retrieve named
  media and quotes.
- **Reminders:** `/remind` and `/reminders` schedule and manage pings; `/temporary` sends messages
  that disappear after a chosen duration.
- **AI and translation:** `/chatgpt` uses OpenAI; `/translate` translates text to English with
  DeepL.
- **Server tools:** `/emoji-hunt` creates an emoji search grid; `/settings` configures emote sets,
  permissions, and personal emote borders.

Message context menus support translation, AI explanations, and saving media or quotes. Optional
Ollama chat uses conversation history in ChromaDB. See the [command guide](docs/COMMANDS.md) for all
commands and configuration aliases.

## Run with Docker

Before hosting, review [integration permissions and known gaps](docs/TERMS.md) and publish a
[deployment-specific privacy notice](docs/PRIVACY.md). Public API access does not establish content
or processing rights.

For a Debian 13 host, the [Botge control guide](botge_control/README.md) sets up rootless Docker and
restricted deployment access without cloning the repository.

For a manual installation, install [Docker with Compose](https://docs.docker.com/compose/install/)
and get the project files:

```bash
git clone https://github.com/MrewyOrg/Botge.git
cd Botge
cp .env.example .env
cp botge.example.config.jsonc botge.config.json
```

### Set up Discord

Create an application in the
[Discord Developer Portal](https://discord.com/developers/applications):

1. Copy its application ID and bot token into `APP_ID` and `DISCORD_TOKEN` in `.env`, replacing the
   example values.
2. Enable **Message Content Intent** on the application's Bot page. Botge requests this privileged
   intent when connecting to Discord; see [Discord's intent documentation][discord-intents].
3. Install the application to your server with the `bot` and `applications.commands` scopes. Grant
   the channel permissions needed to view channels, send messages, embed links, attach files, and
   read message history.

### Start the bot

The default stack runs the published Botge image and nginx:

```bash
docker compose up -d
docker compose logs -f botge
```

Botge registers the configured application commands on startup. Open `/settings` in Discord to
choose the server's Twitch channel and emote sets. Server owners and administrators can configure
settings access and emote-management permissions. Open **Bot voice channel** to choose a voice
channel. Botge joins when you submit the selection and after each restart. Save with the selection
empty to disconnect. Botge needs **View Channel** and **Connect** permissions in the selected
channel.

To update or stop this stack:

```bash
docker compose pull
docker compose up -d
docker compose stop
```

## Configuration

- **`.env`** holds credentials and optional integration settings. Start with
  [.env.example](.env.example).
- **`botge.config.json`** controls emote sources, enabled commands, and Ollama chat. Start with
  [botge.example.config.jsonc](botge.example.config.jsonc); see the
  [JSON schema](botge.config.schema.json) for options and defaults. Comments and trailing commas are
  supported. All general boolean switches default to `false`; enable emote sources after reviewing
  [TERMS.md](docs/TERMS.md). 7TV has separate global, personal, and added-emote switches; direct 7TV
  URLs use the added-emote switch. See the [emote guide](src/emotes/README.md) for details. For
  Ollama, uncomment and enable its example block, configure models and service URLs, and add Discord
  channel IDs. Keep credentials in `.env`.
- **`/settings`** controls server-specific emote sets, permissions, and voice channel, plus personal
  display settings. If you previously used `general.joinVoiceChannels`, remove it from
  `botge.config.json` and choose the channel in Discord.

Recreate Botge after changing `.env` or `botge.config.json`:

```bash
docker compose up -d --force-recreate botge
```

Remove unused commands from `general.activeSlashCommands` and `general.activeContextMenuCommands`;
providing a command in these lists does not configure its integration automatically.

### Optional integrations

| Feature                  | Configuration                                                |
| ------------------------ | ------------------------------------------------------------ |
| Twitch emotes and lookup | `TWITCH_CLIENT_ID` and `TWITCH_SECRET`.                      |
| Twitch clip search       | Twitch credentials, Meilisearch, and `MEILI_MASTER_KEY`.     |
| OpenAI responses         | `OPENAI_API_KEY`.                                            |
| DeepL translation        | `DEEPL_API_KEY`.                                             |
| Ollama chat              | `ollama.enabled`, an Ollama server and models, and ChromaDB. |

API keys go in `.env`; Ollama options go in `botge.config.json`. For clip search, enable
`general.updateClipsOnStartup` to refresh clips when Botge starts.

The [full Compose stack](compose.full.yaml) runs the published Botge image alongside nginx,
Meilisearch, and ChromaDB. After configuring the integrations you want, start the full stack:

```bash
docker compose -f compose.full.yaml up -d
```

To return to the default stack, run `docker compose up -d --remove-orphans`. This removes the
optional service containers and keeps their named volumes. Ollama runs separately.

### Build Botge locally

Add [`compose.build.yaml`](compose.build.yaml) after the stack file to build from the repository:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Use `compose.full.yaml` as the first file to build locally with Meilisearch and ChromaDB. Leave out
the build override to use the published image.

### Stored data

Botge stores its SQLite databases and temporary files in the `botge-data` named volume, mounted at
`/app/data`. The full stack also persists Meilisearch and ChromaDB in their own named volumes. The
nginx cache lives in `nginx/cache` on the host.

Both stacks run Botge with a read-only root filesystem. `/app/data` stays writable for persistent
state and rendering files; `/tmp` uses a separate temporary filesystem limited to 32 MiB.

Keep backups of `.env`, `botge.config.json`, and persistent data. See the
[import instructions](botge_control/README.md#import-an-existing-data-folder) when moving an
existing data folder into an installation managed by Botge control.

## Development

Use the [VS Code dev container](.devcontainer/devcontainer.json), or install Node.js and npm
versions matching [package.json](package.json). Prepare the configuration files as above. Docker is
needed to run the Compose stack and integration tests. The Docker image supplies FFmpeg and FFprobe
for emote rendering.

```bash
npm ci
npm run check
```

`npm run check` runs type checks, ESLint, Knip, and local tests without credentials or external
services. Run `npm run test:coverage` for coverage, including HTML at `coverage/index.html`. The
coverage badge documents the enforced 80% per-file minimum for statements, branches, functions, and
lines. The build badge tracks PR validation and deployment; CodeQL tracks push scans on `main`.

See the [test guide](tests/README.md) for focused checks and the opt-in Compose suite, which starts
a real bot. [GitHub workflows](.github/workflows/README.md) gate approved production deployments
before merging `dev` into `main`. [Contributing](.github/CONTRIBUTING.md) covers Git hooks.

These checks do not guarantee correctness. Use `npm audit` for dependency advisories. See
[resource usage](docs/RESOURCE_USAGE.md) for runtime limits and [docs](docs) for architecture
diagrams and the changelog.

### Source layout

`src/index.ts` calls the startup function in `src/application.ts`. The rest of the source is grouped
by responsibility:

| Directory           | Responsibility                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `api/`              | External integrations grouped by provider, and shared URL caching. |
| `bot/`              | Orchestration, service managers, command dispatch, and reminders.  |
| `config/`           | Configuration loading and runtime directory paths.                 |
| `database/`         | SQLite persistence.                                                |
| `discord/`          | Guild/user models, permissions, and command registration.          |
| `emotes/`           | Matching, asset conversion, provider URLs, and rendering helpers.  |
| `handlers/`         | Discord command, interaction, and message event handlers.          |
| `message-builders/` | Discord response builders.                                         |
| `utils/`            | General-purpose helpers.                                           |

Shared types live in `src/types.ts`. Helpers specific to a domain live alongside that domain.

## Project information

- [Privacy policy](docs/PRIVACY.md)
- [Terms of service](docs/TERMS.md)
- [Changelog](docs/CHANGELOG.md)
- [Issue tracker](https://github.com/MrewyOrg/Botge/issues)

Botge is licensed under the [MIT License](LICENSE.txt).

Unicode emoji artwork comes from [Twemoji](https://github.com/jdecked/twemoji), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Botge can resize and combine the artwork;
see the [attribution and hosting guidance](docs/TERMS.md#emotes-and-generated-images).

[discord-intents]: https://docs.discord.com/developers/events/gateway#privileged-intents
