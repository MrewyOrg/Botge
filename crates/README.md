# Rust workspace

The workspace builds one Botge executable. Private crates enforce responsibility and dependency
direction; they are not separately published products. Package metadata, dependency versions and
lint policy come from the root manifest. Every crate is a sibling under `crates/`, except the
quantum certificate simulator in `quantum/proofs/certificate`, which lives with the other proofs;
the root manifest is workspace-only. Its default member is `botge`, so root-level `cargo run` and
`cargo build` continue to select the executable. Use `--workspace` to check every crate.

```text
botge — configuration, startup, health and dependency wiring
├── botge-app — authorized operations and composition admission
│   ├── botge-storage → botge-domain
│   └── botge-emotes → botge-domain
├── botge-discord → botge-app, botge-domain, botge-quantum
├── botge-activity → botge-app, botge-domain
├── botge-voice → botge-app, botge-domain
└── botge-quantum → botge-domain
botge-quantum-certificate — proof tooling; tests against botge-quantum (dev-dependency only)
```

- **Domain:** shared records, canonical IDs, settings validation, matching and catalog precedence.
  It has no database, HTTP framework, Discord SDK or network client dependency.
- **Storage:** redb schema and transactions. Its public operations are synchronous; the application
  runs them on blocking workers. Adapters do not depend on storage.
- **Emotes:** provider transport, immutable feed snapshots, event invalidation, bounded media
  downloads and FFmpeg rendering. It receives guild state from the application and never reads a
  database.
- **Application:** resolves current authorization, validates operations, coordinates provider and
  saved state, and owns composition admission. Writes commit before voice notification. Its error
  categories are independent of HTTP; adapters choose response status and formatting.
- **Discord:** gateway events, commands, Discord OAuth and permission lookups. It implements the
  application's `GuildAccess` capability. Composition runs through application operations.
- **Activity:** proxy signatures, bounded HTTP admission, request decoding and response mapping.
  Persistence, mutation authorization and batch sequencing belong to application operations.
- **Voice:** Songbird/Discord voice state and reconciliation. It consumes `VoiceSettingsSource`
  rather than importing storage. Tokio notification is the existing notification capability; another
  forwarding-only interface is unnecessary.
- **Quantum:** the rules behind `/quantum-emote`: the Proposition 2.1 register budget, the
  deterministic base and overlay pool slice, the request planner and caption, all Miri-checked, plus
  one bounded `reqwest` client for the Q# sidecar (3 s timeout, no retries, no classical fallback).
  It depends only on the domain and has no Discord, Axum or database dependency; the executable
  builds the client when `BOTGE_QUANTUM_URL` is set. `botge-quantum-certificate` simulates all 414
  admissible circuit configurations in interval arithmetic, proving the specification's certificate
  bounds, and checks that they match the budget's widths.

The executable supplies concrete implementations. Discord and Activity do not depend on each other.
The application has no Axum, Serenity, Songbird, redb or network-client dependency.
`crates/botge/tests/architecture.rs` checks allowed production edges, infrastructure dependencies
and fixture feature use. Cargo additionally rejects dependency cycles.

## Tests and fixtures

Unit scenarios live beside their owning module in `tests.rs` or `tests/`. Organize each file as
module contract, imports, local fixtures/helpers, then related scenarios. Keep setup, action and
assertions visible; table-driven cases suit repeated input boundaries. Stateful scenarios should
make failure ordering and side effects explicit.

`botge-test-support` supplies loopback servers, media and log fixtures. Optional `test-util`
features expose isolated fault/transport fixtures to development dependencies. Production
dependencies must not enable those features. Tests do not start a production Discord session.
Executable lifecycle tests exercise the real crates together; `crates/botge/tests/rust_cli.rs`
verifies the compiled CLI without credentials.

Native test and benchmark binaries use the executable's allocator; Miri uses the system allocator.
The [test guide](../tests/README.md) owns check commands and coverage gates.

## Serenity API review

Reviewed against stable [Serenity 0.12.5](https://docs.rs/serenity/0.12.5/serenity/) on 2026-11-15.
Gateway callbacks, typed interactions and IDs, command contexts/integration types, response
builders, attachments, pagination and permission calculations use supported APIs. Botge checks guild
access on every authenticated Activity request using gateway state and a bounded REST fallback for
member records missing from the cache.

Voice status uses `Http::edit_voice_status` with a typed serialized body. In this SDK version,
`EditChannel::status` performs the status update and then a separate channel PATCH; retaining the
status-only endpoint avoids the extra operation. OAuth code exchange and minimal bearer identity
lookup retain the bounded shared client, disabled redirects and existing sanitized error mapping.
Serenity's bot REST client handles guild/member/channel lookups and Discord rate limits.
