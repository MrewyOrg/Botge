# Rust bot architecture

The production image builds one [Rust binary](../Cargo.toml). Discord commands and the Activity API
share the same emote catalog. The [Activity and Worker](../activity/README.md) are TypeScript.

## Startup and dependencies

```mermaid
flowchart TD
    Start["Rust executable"] --> Store["Open redb database"]
    Start --> Discord["Connect Serenity to Discord"]
    Start --> API["Start Axum when Activity credentials are configured"]
    Discord --> Ready["Gateway ready"]
    Ready --> Voice["Reconcile saved voice settings with Songbird"]
    Store --> Voice
    API --> Store
    Discord --> Commands["Handle Discord commands"]
    Commands --> Catalog["Resolve emotes"]
    Commands --> Renderer["Render images with FFmpeg"]
    API --> Catalog
    Catalog --> Store
    Catalog --> Providers["Provider feeds and 7TV events"]
    Renderer --> Cache["Provider image cache"]
```

The root Cargo manifest builds one executable from [`src/`](../src/). The startup module wires the
dependencies together. The Activity routes validate input and translate failures into HTTP
responses. The Discord adapter exchanges OAuth codes and checks permissions. Storage owns redb
transactions, and the voice worker applies settings to Discord.

## Activity request flow

```mermaid
sequenceDiagram
    participant Browser as Activity
    participant Proxy as Discord proxy
    participant API as Axum
    participant Discord
    participant DB as redb
    participant Voice as Voice worker
    Browser->>Proxy: Send voice settings and OAuth code
    Proxy->>API: Forward signed request through the API tunnel
    API->>API: Verify Discord proxy signature
    API->>Discord: Exchange code and check guild membership and permissions
    alt Authorized guild administrator
        API->>DB: Commit guild voice settings
        API-->>Voice: Notify after a successful save
        API-->>Proxy: Return saved settings
        Voice->>Discord: Join, move, or disconnect
    else Authorization failed
        API-->>Proxy: Reject the request
    end
    Proxy-->>Browser: Return the response
```

The diagram shows a voice settings save. Discord maps `/` to the Worker, which verifies the signed
HTML request, and `/botge-api` to the bot's API tunnel. The API verifies signatures independently.

Guild owners and administrators can manage voice and emote settings. Members can read the server
catalog. Adding or removing emotes follows the server's emote management policy, and personal border
settings use the authenticated user's ID.

The API offers voice channels the bot can view and join. Startup, gateway resume, and a periodic
check reconcile the saved channel. Clearing it requests a disconnect. The optional voice status
emoji stays saved when the toggle is off.

## Emote catalog and rendering

Each guild catalog combines individually added emotes, configured provider sets, and global feeds in
that order. Only enabled providers contribute entries. A single 7TV WebSocket invalidates affected
snapshots after changes. Timed refreshes and a reconnect refresh cover missed events. Autocomplete
can use cached results when a provider is slow. The shared refresh continues in the background so
later requests can use the updated snapshot. Added emotes and guild settings use separate redb
tables. The add transaction checks duplicate IDs and names, and the API checks guild membership and
roles before writing.

Discord defers emote interactions while it resolves names and reads media. Downloads use provider
CDN allowlists and the nginx cache where available. The renderer admits one request at a time, caps
file sizes, and runs FFmpeg on local image files. Columns follow the Activity preview's proportions.
The renderer synchronizes each overlaying group before compositing so all layers retain their
timing. Animated compositions export WebP with variable frame delays and use the longest source
animation's duration.

## Validate the Rust bot

Install Rust through rustup and provide Opus development headers and libraries through your package
manager. Use `opus` and `pkg-config` on macOS with Homebrew or `libopus-dev` and `pkg-config` on
Debian.

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
sh scripts/check-rust-coverage.sh
npm run test:coverage -w activity
```

For a live test, export `DISCORD_TOKEN` and `APP_ID` for a separate Discord test application. Export
`DISCORD_ACTIVITY_CLIENT_SECRET` and `DISCORD_ACTIVITY_PUBLIC_KEY` to enable the local API on
`127.0.0.1:3080`. Start the bot from the repository root with a fresh test database and register the
commands on that application:

```sh
BOTGE_DATA_DIR="$(mktemp -d)" BOTGE_REGISTER_COMMANDS=true cargo run --locked
```

Enable Discord proxy authentication and build the test Activity with
`VITE_ENABLE_ACTIVITY_SETTINGS=true`. Point the test application's API URL mapping at the test
backend through the proxy described in the Activity guide. Check startup, channel selection and
deselection, reconnect, and status permissions on a test server.

## Deployment

```mermaid
flowchart LR
    Dev["dev → PR to main"] --> Quality["BotgeQL validation"]
    Quality --> Paths{"Image changes?"}
    Paths -->|Yes| Build["Build Linux AMD64 and ARM64 candidate"]
    Paths -->|No| Approval["Approve production job"]
    Build --> Approval
    Approval --> Deploy["Promote candidate or record existing image"]
    Deploy --> Merge["Merge to main"]
    Dev --> Security["CodeQL and repository checks"]
    Security --> Merge
```

The [deployment workflow](../.github/workflows/README.md) promotes the candidate digest and requests
the VM update through the control socket over Google Cloud IAP. The
[Activity Worker](../activity/README.md) has its own build and publish steps. For a live release
check, verify commands, guild catalog permissions, and voice in Discord. Check
[resource usage](RESOURCE_USAGE.md) during an animated composition with voice connected.

See the [roadmap](ROADMAP.md) for planned commands and integrations.
