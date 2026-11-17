# Rust bot architecture

The production image builds one [Rust binary](../crates/botge/Cargo.toml). Discord commands and the
Activity API share the same emote catalog. The [Activity and Worker](../activity/README.md) are
TypeScript.

## Diagram exports

The PNG diagrams describe the current workspace and service flows. The revised architecture,
request-flow and development-workflow diagrams have editable Mermaid counterparts in
[`diagrams/`](diagrams/). The workspace guide defines the complete dependency policy:

- [Workspace architecture](architecture.png) ([Mermaid](diagrams/architecture.mmd)): adapters,
  application operations, domain records, providers, and persistence.
- [Request and data flow](request-flow.png) ([Mermaid](diagrams/request-flow.mmd)): Discord
  compositions and authenticated Activity voice settings.
- [Deployment topology](deployment.png): Compose services, persistent data, and the optional API
  tunnel.
- [Development and release workflow](development-workflow.png)
  ([Mermaid](diagrams/development-workflow.mmd)): local hooks, language checks, and approved
  deployment.
- [Startup and shutdown](startup.png): initialization, optional services, and gateway readiness.
- [Discord interactions](discord-interactions.png): extensible command, autocomplete, modal, and
  message handling.

Diagrams show architectural boundaries rather than an exhaustive feature list. New ports reuse the
command and interaction handlers; only implemented handlers are active. The request-flow diagram
illustrates emote rendering and an Activity voice-settings save. Personal border requests identify
the caller without requiring guild authorization.

## Startup and dependencies

```mermaid
flowchart TD
    Start["Rust executable"] --> Store["Open redb database"]
    Start --> Discord["Connect Serenity to Discord"]
    Start --> API["Start Axum when Activity credentials are configured"]
    Start --> Health["Internal health listener :3081"]
    Discord --> Health
    Discord --> Ready["Gateway ready"]
    Ready --> Voice["Reconcile saved voice settings with Songbird"]
    App["Application operations"] --> Store
    Voice --> App
    API --> App
    Discord --> Commands["Handle Discord commands"]
    Commands --> App
    App --> Catalog["Resolve emotes"]
    App --> Renderer["Render images with FFmpeg"]
    Catalog --> Providers["Provider feeds and 7TV events"]
    Renderer --> Cache["Provider image cache"]
```

The root Cargo manifest is a virtual workspace. The executable lives in
[`crates/botge/`](../crates/botge/), alongside the private libraries in [`crates/`](../crates/). The
startup module wires the dependencies together. The Activity routes validate input and translate
failures into HTTP responses. The Discord adapter exchanges OAuth codes and checks permissions.
Storage owns redb transactions, and the voice worker applies settings to Discord.

The larger services separate their internal responsibilities into child modules:

- [`commands.rs`](../crates/botge-discord/src/commands.rs) dispatches to
  [`commands/`](../crates/botge-discord/src/commands/): composition, message prefixes, autocomplete,
  shortcuts, registration, and cleanup.
- [`activity.rs`](../crates/botge-activity/src/activity.rs) shares authentication and state across
  the voice, catalog, personal border, and guessing game routes in
  [`activity/`](../crates/botge-activity/src/activity/).
- [`game.rs`](../crates/botge-app/src/game.rs) keeps the guessing game's rooms, rounds, and scores
  in memory: it owns tickets, seats, and the emote pool, and
  [`game/`](../crates/botge-app/src/game/) holds one room's state and scoring, the match task, and
  token generation. A room belongs to one Activity instance in one guild and closes with its last
  connection. The Activity adapter issues a one-use ticket to a verified guild member, seats the
  WebSocket that presents it, and serves each round's image under a random token so the emote's name
  stays on the server until the reveal.
- [`providers.rs`](../crates/botge-emotes/src/emotes/providers.rs) keeps networking and snapshots
  separate from [`normalization.rs`](../crates/botge-emotes/src/emotes/providers/normalization.rs)
  and [`events.rs`](../crates/botge-emotes/src/emotes/providers/events.rs).
- [`rendering.rs`](../crates/botge-emotes/src/emotes/rendering.rs) coordinates downloads and
  encoding; its [`child modules`](../crates/botge-emotes/src/emotes/rendering/) own layout planning,
  media probing, and WebP timing.

Feature tests live in each child module's `tests.rs`. Parent test modules retain shared fixtures and
scenarios that exercise dispatch, authentication, networking, or the complete render pipeline.

### Workspace boundaries

The [workspace guide](../crates/README.md) defines the private crate responsibilities and allowed
production dependencies. Domain records and pure rules sit below storage and provider services.
Application operations authorize and coordinate those services; Discord and Activity translate
transport requests without owning database access. Authorization calls the application's injected
`GuildAccess` capability, implemented by `botge-discord`. Voice consumes an application
settings-source capability. The executable wires concrete services together.

The dependency-policy integration test guards these edges and keeps fixture features out of
production declarations. Cargo rejects cycles. Shared metadata and lint policy live in the root
manifest; validation, coverage and build inputs include every workspace crate.

The internal health listener is independent of the Activity API. It exposes process liveness at
`/healthz`, gateway readiness at `/readyz`, and operation counters at `/metrics`. Ready/Resumed
enables readiness; reconnect stages remove it without failing liveness. `--healthcheck` checks local
readiness, and `--verify-database` reads an offline redb backup without loading Discord credentials.
See [production operations contracts](PRODUCTION.md).

## Activity request flow

```mermaid
sequenceDiagram
    participant Browser as Activity
    participant Proxy as Discord proxy
    participant API as botge-activity
    participant App as botge-app
    participant Discord as botge-discord / Discord
    participant DB as botge-storage
    participant Voice as botge-voice
    opt No usable access token
        Browser->>Proxy: Send OAuth code to /auth
        Proxy->>API: Forward signed exchange request
        API->>API: Verify proxy signature
        API->>Discord: Exchange one-use code
        Discord-->>API: Access token and lifetime
        API-->>Proxy: Return token (no-store)
        Proxy-->>Browser: Keep token in memory and authenticate SDK
    end
    Browser->>Proxy: Send voice settings and bearer token
    Proxy->>API: Forward signed request through the API tunnel
    API->>API: Verify proxy signature and decode request
    API->>App: Save voice settings
    App->>Discord: Identify token holder and check current guild/channel permissions
    alt Authorized guild administrator
        App->>DB: Commit guild voice settings on blocking worker
        DB-->>App: Committed settings
        App-->>Voice: Notify after successful commit
        App-->>API: Return saved settings
        API-->>Proxy: Return HTTP response
        Voice->>App: Load saved settings through settings source
        App->>DB: Read saved voice settings
        DB-->>App: Settings snapshot
        App-->>Voice: Saved settings
        Voice->>Discord: Reconcile gateway membership and optional status
    else Authorization failed
        App-->>API: Sanitized access error (no write)
        API-->>Proxy: Reject the request
    end
    Proxy-->>Browser: Return the response
```

The diagram shows a voice settings save. Discord maps `/` to the Worker, which verifies the signed
HTML request and sends it with a strict same-origin Content-Security-Policy, and `/botge-api` to the
bot's API tunnel. The API verifies signatures independently. Each request checks the token holder
and their guild membership with Discord; only the guild's role definitions and owner are reused for
30 seconds. Responses over 1 KiB are gzip-compressed when the client accepts it.

Guild owners and administrators can manage voice and emote settings. Members can read the server
catalog. Adding or removing emotes follows the server's emote management policy, and personal border
settings use the authenticated user's ID.

The API offers voice channels the bot can view and join. Startup, gateway resume, and a periodic
check reconcile the saved channel. A call that is already connected only has its status refreshed;
guilds that keep failing are retried with backoff up to an hour, and saving settings retries at
once. Clearing it requests a disconnect. The optional voice status emoji stays saved when the toggle
is off.

## Emote catalog and rendering

Each guild catalog combines individually added emotes, configured provider sets, and global feeds in
that order. Only enabled providers contribute entries. A single 7TV WebSocket invalidates affected
snapshots after changes. Timed refreshes and a reconnect refresh cover missed events. Autocomplete
can use cached results when a provider is slow. The shared refresh continues in the background so
later requests can use the updated snapshot. Requests retain immutable provider snapshots rather
than cloning their records; an in-flight request keeps its previous view across a refresh. Bounded
provider JSON normalization and shortcut searches run on blocking workers. Added emotes and guild
settings use separate redb tables. The add transaction checks duplicate IDs and names, and the API
checks guild membership and roles before writing.

Discord defers emote interactions while it resolves names and reads media. Downloads use provider
CDN allowlists and the nginx cache where available. The renderer admits up to five requests at once,
caps file sizes, and runs FFmpeg on local image files. Columns follow the Activity preview's
proportions. The renderer synchronizes each overlaying group before compositing so all layers retain
their timing. Animated compositions export WebP with variable frame delays and use the longest
source animation's duration.

## Checks and deployment

The [test guide](../tests/README.md) owns toolchains, check commands, coverage gates and live
testing. The [workflow guide](../.github/workflows/README.md) owns CI, the release PR, image
promotion and approved deployment; the development-workflow diagram above summarizes it.
[Production contracts](PRODUCTION.md) cover readiness, backups and the cost policy. See the
[roadmap](https://github.com/orgs/MrewyOrg/projects/2/views/6) for planned commands and
integrations.
