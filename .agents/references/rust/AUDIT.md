# Rust guideline audit

Reviewed 2026-11-21 against the [pinned reference manifest](../sources.json). The scope covers all
nine workspace crates, their fixtures and integration tests, workspace settings, and the Rust CI and
production build configuration. All five Rust references and their subguides are inventoried below.
The findings come from source inspection and the checks listed at the end. The
[crate guidance](../../../crates/AGENTS.md) owns the project's Rust rules and deviations.

## Findings and fixes

- **An offline database could pass verification with values the live readers could not decode..**
  The verifier now reads voice settings, guild emote settings, and added emotes as their live types.
  The storage tests exercise invalid JSON, valid JSON with incompatible types, old databases, and a
  read-only restore. [Storage](../../../crates/botge-storage/src/lib.rs) ·
  [Tests](../../../crates/botge-storage/src/tests.rs)
- **A catalog write could report the wrong conflict if the database changed between rejection and a
  second read..** Storage returns the outcome decided inside its write transaction. The application
  maps it to the same client-facing messages and emits a change notification only after commit.
  Existing contention tests now check the exact duplicate-name outcome.
  [Storage](../../../crates/botge-storage/src/lib.rs) ·
  [Application](../../../crates/botge-app/src/operations.rs)
- **A match could finish before its cancellation handle was recorded..** Scheduling and recording
  the handle now share the room state lock. The match's completion and last-seat handler use the
  same lock. Cancellation tests now start matches through the production scheduling method.
  [Room](../../../crates/botge-app/src/game/room.rs) ·
  [Tests](../../../crates/botge-app/src/game/tests.rs)
- **Duplicate application paths and undocumented re-exports obscured API ownership..** Catalog
  watches and metrics use their root exports through private modules. Public application and game
  re-exports use inline docs. The Catalog and Layer facade remains deliberate.
  [Application](../../../crates/botge-app/src/lib.rs) ·
  [Game](../../../crates/botge-app/src/game.rs)
- **Smaller standards gaps remained at source boundaries..** Emote authorization no longer takes an
  ambiguous administrator boolean. The autocomplete wait is named and documented, the catalog
  watcher logs a structured error field, and the executable's Tokio test dependency inherits the
  workspace declaration. [Authorization](../../../crates/botge-app/src/operations.rs) ·
  [Catalog watcher](../../../crates/botge-app/src/catalog_watch.rs) ·
  [Cargo](../../../crates/botge/Cargo.toml)

## Microsoft Pragmatic Rust Guidelines

Reviewed the complete [Microsoft snapshot](../cache/microsoft.txt), including its AI, application,
correctness, documentation, FFI, macro, performance, project, safety and universal subguides and all
four library subguides. Evidence for measured resource choices is in
[resource usage](../../../docs/RESOURCE_USAGE.md).

### AI, application and correctness

- **M-DESIGN-FOR-AI.** The crate map, bounded module interfaces and local tests give an entry point
  for source inspection.
- **M-NO-META-DESIGN-DOCUMENTATION.** Module docs describe current flows and effects. Release
  rationale and measurements live under docs.
- **M-RUST-SHAPED.** Uses Rust ownership and enums for state and outcomes. Removed the storage
  rejection readback and the administrator flag argument.
- **M-SINGLE-ITEM-PATH.** Fixed duplicate paths for application watch and metrics types. Catalog and
  Layer form the documented cross-crate facade.
- **M-TAUTOLOGICAL-TESTS.** Reviewed scenarios for observable results, including data restored from
  a copied database, contested writes, and task cancellation.
- **M-APP-ERROR.** The executable and private infrastructure code use anyhow. Adapter responses map
  stable failure categories and sanitized messages.
- **M-MIMALLOC-APPS.** The native executable and representative test binaries install mimalloc. Miri
  uses the system allocator.
- **M-TARGET-CPU.** Deliberate exception. The distributed AMD64 and ARM64 images use portable CPU
  targets.
- **M-PANIC-CONTINUATION.** The executable installs a fatal panic hook. Fixture recovery from
  isolated mutex poisoning exercises local failure paths.
- **M-PANIC-IS-STOP.** The executable tests process termination from a worker panic. Normal command,
  database and provider failures use result paths.
- **M-PANIC-MESSAGE.** A process panic hook preserves the diagnostic and location. Explicit panics
  in the reviewed source are confined to fixtures that exercise failure behavior.
- **M-PANIC-ON-BUG.** Invalid runtime inputs remain errors or denials. Workspace lints deny explicit
  panic shortcuts and unchecked indexing.
- **M-UNSAFE-IMPLIES-UB.** Workspace Rust forbids unsafe code. Dependencies and native components
  are beyond this first-party source check.
- **M-UNSAFE.** No first-party unsafe blocks or unsafe APIs were found in the Rust workspace.
- **M-UNSOUND.** Borrowing, locking and task ownership are checked by Rust and reviewed at the
  application/storage boundary. This audit makes no soundness claim for dependencies.

### Documentation, FFI and macros

- **M-CANONICAL-DOCS.** Clippy checks error and panic sections, including private helpers. Added the
  Tokio runtime precondition for starting a match and typed row verification errors.
- **M-DOC-INLINE.** Fixed application and game re-exports. Activity and emotes already inlined their
  exports.
- **M-FIRST-DOC-SENTENCE.** Reviewed the changed APIs and representative crate and module summaries.
  The approximate length is an editorial guideline.
- **M-MODULE-DOCS.** Entry points and major modules document ownership and runtime effects.
  Private-item Rustdoc checks the links and markup.
- **M-FFI-NAMING, M-FFI-TRANSLATES, M-ISOLATE-DLL-STATE.** No first-party FFI crate, foreign ABI, or
  dynamic-library state. FFmpeg is a child process.
- **M-EXAMPLE-OVER-PROC, M-MACRO-HELPERS, M-MACRO-LAST-RESORT, M-MACRO-MAIN-CRATE,
  M-MACRO-VERSION-PIN, M-MACROS-DONT-LIE, M-PROC-IMPL, M-PROC-IMPLIED-ITEMS.** No first-party macro
  or procedural macro API. Derive and test attributes come from locked dependencies.

### Performance

- **M-ASYNC-STACK-SIZE.** The workspace caps stack arrays. Media uses heap-backed buffers and
  bounded stages. No new future-size measurement was made.
- **M-AVOID-INDIRECTION.** Catalog snapshots use shared immutable slices and borrow emote records
  while iterating. Render and request paths retain ownership only as needed.
- **M-BOX-DST.** Catalog stores immutable collections as boxed slices and shared slices. Mutable
  construction buffers keep their capacity.
- **M-FAST-HASHER.** Deliberate exception. Runtime maps retain standard hashers for untrusted keys.
- **M-HOTPATH.** Existing resource measurements identify catalog search, autocomplete and rendering.
  This review made no performance claim from the behavior fixes.
- **M-INITIAL-CAPACITY.** Browser catalog deduplication uses iterator length. Batch changes, render
  inputs and bounded geometry preallocate where size is known.
- **M-LOG-OVERHEAD.** Metrics aggregate bounded route and command labels. No new per-entry logging
  or measured logging comparison.
- **M-MEM-REUSE.** Shared feed snapshots avoid cloning whole provider results. The write outcome
  removes the denial path's extra read, decode and string copies.
- **M-SHRINK-TO-FIT.** Snapshot builders convert to boxed or shared slices. Reused dynamic
  collections keep their capacity to avoid churn.
- **M-THROUGHPUT.** Voice reconciliation, provider refresh, Activity sockets and rendering are
  bounded. Background refreshes share in-flight work.
- **M-YIELD-POINTS.** Long-lived workers await I/O or timers. Blocking redb work stays off Tokio
  workers. Reviewed game cancellation and task ownership.

### Project, safety and universal guidance

- **M-CARGO-WORKSPACE.** Crates inherit edition, version, minimum toolchain and lints. The
  executable's Tokio test dependency now inherits its version and adds the test feature.
- **M-CRATES-FLAT-FOLDER.** All nine members are sibling directories under crates. The architecture
  test checks the layout.
- **M-CRATES-IN-WORKSPACE.** The workspace lists the members and centralizes local dependency
  versions. Production edges and fixture features are guarded by the architecture test.
- **M-LATEST-EDITION.** The workspace declares Rust edition 2024. The formatter separately pins
  style edition 2027.
- **M-MSRV.** The documented stable floor is 1.99.1 and the development nightly is pinned
  separately. This private workspace supports the declared production toolchain.
- **Safety subguide.** The first-party unsafe prohibition and lint policy apply to every member. See
  the Rust Reference review below.
- **M-DOCUMENTED-MAGIC.** Documented the provider wait for autocomplete. Existing rendering, socket,
  ticket and game limits have names or nearby explanations.
- **M-LINT-OVERRIDE-EXPECT.** Reviewed reasoned exceptions for shutdown, reconnect loops, bounded
  casts and fixtures. Workspace Clippy denies `allow` attributes.
- **M-LOG-STRUCTURED.** Runtime diagnostics use tracing. Fixed the catalog watcher to retain the
  error field and a single stable message.
- **M-PUBLIC-DEBUG.** The compiler requires Debug. OAuth and credential debug output omits token
  contents.
- **M-PUBLIC-DISPLAY.** Client-facing errors have Display messages. Data-only records use Serde for
  their protocol representation.
- **M-REGULAR-FN.** Stateless helpers are free functions. Operations bound to store, application or
  room state have receivers.
- **M-SHORT-NAMES.** Method and type names reflect their domain roles. The catalog conflict outcome
  distinguishes duplicate ID, duplicate name and capacity.
- **M-SMALLER-CRATES.** The workspace separates domain, storage, provider/rendering, application,
  adapters and test support.
- **M-STATIC-VERIFICATION.** The workspace has build, lint, Rustdoc, feature and coverage checks.
  The commands actually exercised in this review are listed below.
- **M-UPSTREAM-GUIDELINES.** Reviewed the pinned API, style, patterns and Rust Reference sections
  below against Botge's local deviations.
- **M-WEASEL-WORDS.** Names in the reviewed services identify purpose. SDK type names retain their
  upstream spelling in adapter code.

### Library building and interoperability

- **M-FEATURES-ADDITIVE.** The four local test-util features add fixture methods or dependencies.
  Production defaults are checked for activation paths.
- **M-OOBE.** Workspace dependencies resolve from the locked manifest. FFmpeg and Discord
  credentials are runtime prerequisites for their features.
- **M-SYS-CRATES.** No first-party native sys crate. Native dependencies use their own build
  integration.
- **M-DONT-LEAK-TYPES.** Domain stays independent of adapters. Botge intentionally uses shared
  dependencies such as Url, Tokio channels and adapter-specific types within the private workspace.
- **M-ESCAPE-HATCHES.** No public wrapper around a foreign ABI. Production clients remain
  encapsulated, with gated test configuration where needed.
- **M-FOREIGN-REEXPORTS.** Catalog and Layer are deliberate application facade exports. Other
  callers use the owning crate.
- **M-IMPL-ASREF.** Boundary methods generally borrow concrete Path, str or slices. Broader generic
  path wrappers are unnecessary for the private APIs.
- **M-IMPL-IO.** Pure domain logic has no I/O. HTTP, rendering and storage use explicit interfaces
  or fixture entry points at their ownership boundary.
- **M-IMPL-RANGEBOUNDS.** The reviewed public APIs do not take caller-supplied ranges. Internal
  loops use ordinary Rust ranges.
- **M-TYPES-SEND.** Spawned production tasks compile with Send. Capability traits explicitly require
  Send and Sync where shared across tasks.

### Library resilience and UX

- **M-AVOID-STATICS.** The Discord client static caches connections. Allocator statics configure the
  process. The game random helper has an atomic seed input counter. Room, ticket and catalog state
  belong to application instances.
- **M-BUILD-RESULT.** Fallible initialization returns results. Provider clients and stores
  initialize before workers run.
- **M-INTEGRATION-TESTS.** Architecture and compiled CLI tests live under tests. Module-owned
  protocol and failure fixtures stay near their implementations.
- **M-LOG-NOT-PRINT.** Runtime logs use tracing. The executable uses stdout for explicit CLI version
  output.
- **M-MOCKABLE-SYSCALLS.** Guild access and voice settings are injectable. Tests use temporary
  databases, loopback servers, Tokio time and fault fixtures.
- **M-NO-GLOB-REEXPORTS.** Production exports are explicit. Test modules may import their parent
  scope without exposing a public path.
- **M-STRONG-TYPES-GUARD.** Credentials hold a private string and reject malformed input at
  transport boundaries. Discord IDs and provider values are validated before use.
- **M-STRONG-TYPES.** Store mutations now return a typed outcome. Ordinary-role policy takes role
  IDs, with administrator handling in membership. Optional persisted settings express actual
  absence.
- **M-TEST-UTIL.** Test support stays development-only. Optional fixtures are gated, and the
  dependency-policy test inspects production edges.
- **M-ASYNC-FN.** Ordinary inherent operations use async fn. Capability traits deliberately say
  `impl Future + Send` to name the executor requirement.
- **M-AVOID-WRAPPERS.** Value inputs borrow or own directly. Rooms and feed snapshots use Arc where
  independent task lifetimes need shared ownership.
- **M-BALANCED-MODULES.** Large adapters and rendering pipelines split by concern. Ordered FFmpeg
  and fixture scenarios retain documented function-length exceptions.
- **M-COLLECTION-TRAITS.** Catalog supports borrowed IntoIterator and exact-size iteration.
  Construction explicitly distinguishes additions and retained provider feeds.
- **M-DI-HIERARCHY.** The application owns concrete storage and provider services. Generic traits
  isolate Discord, voice and round fixtures.
- **M-ERRORS-CANONICAL-STRUCTS.** The internal AccessError protocol uses a typed category and
  sanitized static message. The executable and infrastructure use anyhow as documented.
- **M-ESSENTIAL-FN-INHERENT.** Store, Application, Catalog and room handles expose their core
  behavior as inherent methods.
- **M-FROM-ERROR.** Standard conversion preserves infrastructure failures. Explicit mapping at trust
  boundaries adds context or deliberately replaces details with safe messages.
- **M-INIT-BUILDER.** Complex third-party clients use their builders. Small local values and fixture
  settings use direct construction.
- **M-INIT-CASCADED.** Configuration and service wiring stay in the executable. Storage and adapters
  receive only the dependencies they own.
- **M-NO-PRELUDE.** Crates use named imports and explicit exports.
- **M-PARAMETER-CONSISTENCY.** Application authorization methods consistently accept access
  capability, guild or user scope, then credentials and request data.
- **M-SERVICES-CLONE.** Deliberate exception. The application and live room state use explicit Arc
  sharing.
- **M-SIMPLE-ABSTRACTIONS.** The crate split follows actual responsibilities. The private catalog
  mutation helper uses ControlFlow to decide whether to commit the typed outcome.

## Rust API Guidelines

Reviewed every checklist item in the [API snapshot](../cache/api-guidelines.txt). The workspace
libraries are application components, so publication-specific recommendations are recorded as out of
scope or local choices.

- **Naming · C-CASE, C-WORD-ORDER.** Compiler and Clippy cover casing. Reviewed names read
  consistently with the domain and SDK terminology.
- **Naming · C-CONV, C-GETTER.** Conversions follow the Rust prefixes. Accessors such as item length
  and token borrowing omit a getter prefix.
- **Naming · C-ITER, C-ITER-TY.** Catalog exposes iter and borrowed IntoIterator. Its iterator type
  is Iter.
- **Naming · C-FEATURE.** Test features identify their fixture purpose and are absent from
  production defaults.
- **Interoperability · C-COMMON-TRAITS.** Domain settings and bounded outcomes implement useful
  equality and Debug. Resource-owning types avoid automatic Clone or serialization when that would
  conceal ownership.
- **Interoperability · C-CONV-TRAITS.** Standard From and Into conversions handle compatible values.
  Explicit checks handle HTTP and persisted input.
- **Interoperability · C-COLLECT.** Catalog is constructed from ordered additions and retained feed
  groups. Collecting arbitrary entries or extending in place would lose that distinction.
- **Interoperability · C-SERDE.** Persisted and protocol records declare their Serde layout.
  Operational handles do not need serialization.
- **Interoperability · C-SEND-SYNC.** Worker and adapter capabilities state their threading bounds.
  The compiler checks Send at spawn sites.
- **Interoperability · C-GOOD-ERR.** AccessError implements Display and Error. Storage refusal now
  exposes a typed outcome with no second read.
- **Interoperability · C-NUM-FMT, C-RW-VALUE.** No custom binary-number type or public generic
  reader/writer API. Packed colors and wire numbers use primitives.
- **Macros · C-EVOCATIVE, C-MACRO-ATTR, C-ANYWHERE, C-MACRO-VIS, C-MACRO-TY.** No authored macro
  API.
- **Documentation · C-CRATE-DOC, C-EXAMPLE, C-QUESTION-MARK.** All crates have module summaries and
  major use cases have examples or executable fixtures. Example coverage is selective. Doctests
  validate compilable examples.
- **Documentation · C-FAILURE, C-LINK.** Clippy and Rustdoc check fallible API sections and links.
  Added runtime and storage verifier notes.
- **Documentation · C-METADATA, C-RELNOTES.** The application crates are unpublished and inherit
  package metadata. Botge releases are maintained at the repository level.
- **Documentation · C-HIDDEN.** Private module docs are built for maintainers. Public re-exports
  inline the intended paths.
- **Predictability · C-SMART-PTR, C-OVERLOAD, C-DEREF.** No first-party smart-pointer facade,
  surprising operator overload, or Deref-based forwarding was found.
- **Predictability · C-CONV-SPECIFIC, C-METHOD, C-CTOR.** Concrete conversions and constructors stay
  with their types. Free functions handle operations without receivers.
- **Predictability · C-NO-OUT.** Results generally return owned outcomes. Explicit mutable
  parameters in internal image and state helpers represent resources they update.
- **Flexibility · C-INTERMEDIATE.** The storage caller receives the transaction's result directly.
  Catalog snapshots let consumers iterate without materializing another flat copy.
- **Flexibility · C-CALLER-CONTROL.** Domain and adapter inputs borrow where appropriate. Owning
  conversions are reserved for queued work and reusable buffers.
- **Flexibility · C-GENERIC.** Generics express actual capabilities and borrowed iterators. Concrete
  types keep internal boundaries readable.
- **Flexibility · C-OBJECT.** Current traits have concrete implementations and executor-bound
  futures. They have no dynamic-dispatch consumer.
- **Type safety · C-NEWTYPE, C-NEWTYPE-HIDE.** Credential and Store keep their representations
  private. NonZeroU64 distinguishes usable IDs from zero in parsed operations.
- **Type safety · C-CUSTOM-TYPE.** Removed the administrator flag argument. Catalog mutation and
  game phases use named variants.
- **Type safety · C-BITFLAG.** The Discord adapter retains the SDK's permission bitflags. Provider
  switches are individually named configuration fields.
- **Type safety · C-BUILDER.** Code uses builders for configured HTTP, Discord and process clients.
  Simple internal records use constructor parameters or defaults.
- **Dependability · C-VALIDATE.** Domain validators, bounded activity and provider inputs, and typed
  offline backup verification cover the reviewed boundaries.
- **Dependability · C-DTOR-FAIL, C-DTOR-BLOCK.** Guards release slots, cancel tasks or remove
  in-memory room state. Transaction success is explicit. Blocking database work runs off async
  workers.
- **Debuggability · C-DEBUG, C-DEBUG-NONEMPTY.** Missing Debug is a compiler error. Sensitive
  implementations give a useful redacted representation.
- **Future-proofing · C-SEALED, C-STRUCT-PRIVATE, C-STRUCT-BOUNDS.** Internal capability traits
  deliberately accept implementations in sibling crates. Protocol DTOs expose data fields for wiring
  and Serde. Invariant-bearing state is private, and generic bounds are applied where needed.
- **Necessities · C-STABLE.** Published-crate API stability is outside the scope of this private
  workspace. The executable's stable toolchain check applies.
- **Necessities · C-PERMISSIVE.** Workspace crates declare MIT. Host-filtered Cargo metadata
  includes MPL-2.0 dependencies such as symphonia and the hpke-rs family. The resolved graph
  diverges from the permissive-only guideline. Target-specific native and image components were
  outside this metadata check.

## Rust Style Guide

Reviewed the complete [style snapshot](../cache/style-guide.txt). Keep formatting mechanical. The
workspace's [rustfmt settings](../../../rustfmt.toml) deliberately use two-space indentation, Unix
newlines and style edition 2027 with language edition 2024.

- **Motivation, default style and reporting bugs.** The pinned formatter gives reproducible output.
  Local formatter settings use the guide's allowance for project choices.
- **Formatting conventions.** rustfmt checks indentation and line widths, block indentation,
  trailing commas, blank lines, whitespace and sorting. Clippy checks doc markup and the
  repository's semicolon style.
- **Items.** rustfmt covers functions, tuples, structs, unions, enums, traits, impls, modules,
  extern declarations, generic parameters, associated types and aliases. Import ordering, grouping
  and nesting follow the formatter configuration.
- **Statements.** Let statements and macro and expression statements use rustfmt. Clippy checks
  unnecessary annotations, borrowed patterns and semicolons on unit-returning expressions.
- **Expressions.** Covered by rustfmt for blocks, closures, literals, indexing, unary and binary
  operations, casts, calls, method chains, macros, control flow, matches, ranges and hexadecimal
  literals. Clippy adds bounds and conversion checks.
- **Patterns.** rustfmt covers the pattern layout. Clippy checks redundant rest patterns and
  explicit reference patterns.
- **Types and bounds.** rustfmt handles single-line and wrapped bounds and precise captures.
  Compiler and Clippy check unused lifetimes and unnecessary qualification.
- **Other style advice.** Clippy and source review cover names, conversions, module layout and Rust
  idioms. Botge organizes module docs by runtime responsibility.
- **Cargo.toml conventions.** Workspace inheritance centralizes metadata. The repo uses consistent
  manifest quoting and feature lists. A published-library metadata checklist does not apply.
- **Guiding principles and rationale.** Use format and lint checks for consistency. Keep manual
  decisions focused on ownership, naming, behavior and safety.
- **Rust style editions.** The workspace pins 2027 formatting and keeps language edition 2024. Older
  style editions explain historical differences and have no active target.
- **Nightly and frontmatter.** Production targets stable. Nightly test and tooling features are
  scoped to development, and there is no Rust source frontmatter.

## Rust Design Patterns

Reviewed the [complete book snapshot](../cache/design-patterns.txt), including idioms, design
pattern families, anti-patterns, functional Rust and design principles.

- **Introduction, participation, news and translations.** Context and edition provenance. These
  sections add no project checks.
- **Idioms for borrowed arguments, formatting, constructors and Default.** Borrow at boundaries, use
  captured format strings and ordinary constructors. Defaults represent actual absent settings or
  empty state.
- **Idioms for collection smart pointers, destructors, moving variant fields.** Borrow slices and
  snapshot records. Room handles and render permits clean up on drop. Match state uses explicit
  transitions and move or take operations for owned fields.
- **Idioms for on-stack dynamic dispatch, Option iteration and closure captures.** Concrete
  capability traits and enums cover the current choices. Optional data uses early returns or
  iterator adapters. Spawned work clones an Arc explicitly before moving the capture.
- **Idioms for private fields, non-exhaustive, easy doc initialization, temporary mutability.**
  State and storage representations are private. Private crates do not need a forward-compatibility
  layer on every record. Build values locally, then share immutable snapshots.
- **Idioms for returning a consumed argument on error.** No reviewed API needs the rejected emote
  returned to retry. Callers receive a precise outcome and can reconstruct or refresh the request.
- **FFI idioms for errors, accepting and passing strings.** There is no authored FFI surface. FFmpeg
  arguments and output use the typed process boundary.
- **Behavioral for command, interpreter and newtype.** Discord requests dispatch through named
  handlers, and validation parses narrow input formats. No general interpreter is needed. Credential
  and Store distinguish representations with their respective contracts.
- **Behavioral for RAII, strategy and visitor.** Locks, tickets, render permits and room lifetimes
  have explicit owners. Generic capabilities select real or fixture behavior. There is no
  traversable syntax tree that needs a visitor.
- **Creational for builder and fold.** Builders suit external clients with many settings. Iterators,
  explicit accumulators and direct constructors cover transformations and state initialization.
- **Structural for independent borrowing, small crates, unsafety, custom traits.** Application
  services and adapters own distinct state. No first-party unsafe module is needed. GuildAccess,
  Rounds and VoiceSettingsSource carry the actual substitution boundaries.
- **FFI patterns for object APIs and consolidated wrappers.** No opaque foreign handles, iterator
  adapters across an ABI, or raw pointer wrappers in first-party code.
- **Anti-patterns for cloning, deny warnings and Deref polymorphism.** Shared snapshots and explicit
  Arc clones state why ownership is needed. Deny warnings is deliberate for this workspace with
  pinned tooling and private crates. No Deref-based inheritance.
- **Functional Rust for imperative and declarative, type classes, optics.** Straight-line state
  transitions show effects. Iterators and traits handle pure transformations and capabilities. Serde
  derives cover data conversion without an optic abstraction.
- **Additional resources.** Talks and books are further reading. They do not add mandatory Botge
  rules.
- **Principles for SOLID, composition, DRY, KISS and Law of Demeter.** Runtime adapters depend on
  narrow application operations. The verifier shares the live record types and the application
  consumes a direct storage outcome. Keep crate boundaries aligned with real ownership.
- **Principles for contracts, encapsulation, command/query separation.** Input and mutation
  contracts are explicit. Redb commits before notifications, and a storage query cannot accidentally
  write.
- **Principles for least astonishment, modular units, self-documentation, uniform access, single
  choice, persistence closure.** Crate and module names identify the owning layer. Type names and
  methods expose the contract. Consistent snapshots and transaction boundaries preserve persisted
  state.

## Rust Reference on undefined behavior

Reviewed all sections of the [Rust Reference snapshot](../cache/undefined-behavior.txt). The
workspace's unsafe prohibition protects first-party source. It does not prove dependency or native
library soundness.

- **Introduction and soundness.** Workspace forbids unsafe source, and no first-party unsafe
  declaration or block was found. All code still depends on the soundness of its libraries.
- **Data races, pointer access and projection, aliasing, immutable bytes.** Shared state uses Arc,
  atomics and locks. Rust borrowing handles references and slices. The game issue was a
  state-ordering race, fixed by publishing its task handle under the state lock.
- **Intrinsics, CPU features, call ABI and assembly.** No first-party intrinsics, target-feature
  dispatch, external ABI declarations, or inline assembly. Production uses portable targets and
  process boundaries.
- **Rust runtime assumptions.** Panic behavior is set in one executable hook. CLI tests exercise
  fatal worker panics. Tokio and native dependencies are outside this proof boundary.
- **Pointed-to bytes, alignment and dangling pointers.** No raw pointer dereference, packed-field
  address calculation or custom allocation in first-party code. Use safe container and path APIs.
- **Invalid values.** Scalar, bool, char, str, enum, struct, union, function pointer, reference, and
  wide-pointer validity relies on safe construction and compiler-checked APIs. External payloads use
  Serde and explicit validators. There is no first-party union or provenance manipulation, and no
  construction from uninitialized bytes.

## Verification

- Offline validation of the pinned source and license snapshots.
- Nightly rustfmt and workspace Clippy with all targets and denied warnings.
- 52 targeted storage, application game and operations, domain emote, and Activity catalog tests.
- 8 architecture and CLI integration tests.
- Private-item Rustdoc and workspace doctests.
- Production binary build check with stable Rust 1.99.1.
- All 13 workspace feature configurations checked with Cargo Hack.

Verification was local and offline. Live Discord, production-data restore, Miri, full workspace
coverage, and representative AMD64 performance remain unverified. The license review covers the
Cargo metadata declarations for the host target.
