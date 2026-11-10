# <img src="assets/botge-icon.png" alt="Botge logo" width="48" height="48"> Botge

[![Build and deploy](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml/badge.svg?event=pull_request)](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml?query=event%3Apull_request)
[![Coverage threshold: 80% per file](https://img.shields.io/badge/coverage_threshold-80%25_per_file-blue)](.github/workflows/botgeql.yml)
[![CodeQL](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml/badge.svg?branch=main&event=push)](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml?query=branch%3Amain+event%3Apush)
[![License](https://img.shields.io/github/license/MrewyOrg/Botge)](LICENSE.txt)

Botge <img src="assets/botge-emoji.png" alt="Botge logo" width="14" height="14"> brings Twitch-style
emotes to Discord. The Rust bot serves the emote commands, guild catalog, and voice settings. The
[Discord Activity](activity/README.md) lets members browse and compose emotes and lets authorized
members add or remove 7TV emotes. Guild administrators configure emote sets, access, and voice from
the Activity.

See the [command guide](docs/COMMANDS.md) for the available commands and the
[architecture guide](docs/ARCHITECTURE.md) for how the bot, Activity, and deployment fit together.

## Repository layout

- [`src/`](src/) contains the Rust bot, including the gateway, Activity API, renderer, and storage.
- [`activity/`](activity/) contains the browser, Cloudflare Worker, and their tests. Vite builds to
  `activity/dist/`.
- [`tests/`](tests/) contains the Rust CLI, repository tooling, and optional Compose tests.
- [`botge_control/`](botge_control/) and [`nginx/`](nginx/) contain the VM controls and image cache
  configuration.
- [`scripts/`](scripts/) and [`.github/workflows/`](.github/workflows/) contain local checks, CI,
  and the approval-gated production deployment.

## Run with Docker

Before hosting, review [integration permissions and known gaps](docs/TERMS.md) and publish a
[deployment-specific privacy notice](docs/PRIVACY.md). For a Debian host, the
[Botge control guide](botge_control/README.md) sets up rootless Docker and restricted deployment
access.

For a manual installation, install [Docker with Compose](https://docs.docker.com/compose/install/)
and prepare the configuration:

```sh
git clone https://github.com/MrewyOrg/Botge.git
cd Botge
cp .env.example .env
cp botge.example.config.jsonc botge.config.json
```

Create an application in the
[Discord Developer Portal](https://discord.com/developers/applications). Set `DISCORD_TOKEN` in
`.env`. Install the app to your guild with the `bot` and `applications.commands` scopes. Grant the
bot permission to send attachments where members will use the emote commands. Voice requires **View
Channel** and **Connect**. The optional emoji status also requires **Voice Channel Status**.

### Start or update Botge

```sh
docker compose pull
docker compose up -d
docker compose logs -f botge
```

The default stack runs the Rust bot and nginx. For a local build, add the build override:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Use the [Activity setup](activity/README.md) to enable guild catalog and settings. The Compose
Activity override publishes the API on the host's loopback interface. The production Worker and API
tunnel are deployed separately.

### Configuration and data

- **`.env`** supplies Discord credentials and optional Twitch credentials. The Activity API requires
  `APP_ID`, `DISCORD_ACTIVITY_CLIENT_SECRET`, and `DISCORD_ACTIVITY_PUBLIC_KEY`.
- **`botge.config.json`** controls the emote provider switches. They default to false. Comments and
  trailing commas are supported. Twitch global emotes also require `TWITCH_CLIENT_ID` and
  `TWITCH_SECRET`.
- **Activity settings** control guild voice, emote set IDs, and who can manage added emotes.
- **`botge-data`** stores redb at `/app/data/botge.redb`. Botge creates the database on first
  startup and uses the same volume across container upgrades.

Recreate Botge after changing the host configuration. Include the same Compose overrides you used to
start the stack.

```sh
docker compose up -d --force-recreate botge
```

## Development

Install Rust and the native build prerequisites listed in the
[architecture guide](docs/ARCHITECTURE.md). Use Node.js and npm versions matching
[package.json](package.json) for the Activity and repository tools. The Rust render tests need
FFmpeg 9 or later with libwebp and FFprobe.

```sh
npm ci
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
npm run check
```

The pinned Rust nightly enables the 2027 formatting style and branch coverage. Run
`sh scripts/check-rust-coverage.sh` to check that each source file exceeds 80% branch coverage and
reaches at least 80% line, function, and region coverage. `npm run test:coverage -w activity` checks
the Activity and Worker. The [workflow guide](.github/workflows/README.md) describes pre-merge
production deployment and approvals.

## Project information

- [Privacy policy](docs/PRIVACY.md)
- [Terms of service](docs/TERMS.md)
- [Changelog](docs/CHANGELOG.md)
- [Roadmap](docs/ROADMAP.md)
- [Resource usage](docs/RESOURCE_USAGE.md)
- [Issue tracker](https://github.com/MrewyOrg/Botge/issues)

Botge is licensed under the [MIT License](LICENSE.txt).
