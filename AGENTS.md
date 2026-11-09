# Project guidance

Botge is a TypeScript Discord bot for Twitch-style emotes, clips, saved media, quotes, reminders,
translation, and optional AI integrations. Read [README.md](README.md) for setup and configuration.

## Project map

- `src/index.ts`: calls `startApplication` from `src/application.ts`, which owns service
  construction, scheduled jobs, and login. Test application startup with mocked services; importing
  the application module alone does not start the bot.
- `src/bot/`: bot orchestration, managers, command dispatch, and reminder registration.
- `src/handlers/`: Discord entry points grouped into `commands/`, `interactions/`, and `messages/`.
  Shared component IDs and current settings permission checks live beside interaction handlers.
- `src/discord/`: guild/user models, permissions, command definitions and registration.
- `src/emotes/`: catalogs, provider stores, live 7TV subscriptions, URLs, and `rendering/` helpers.
  See [the emote guide](src/emotes/README.md) for source priority and WebSocket recovery.
- `src/message-builders/`: Discord response builders and their supporting functions.
- `src/api/`: external integrations grouped by provider (`twitch/`, `reddit/`, `ollama/`), plus
  shared URL caching; `src/database/`: SQLite persistence.
- See [the API guide](src/api/README.md) for shared HTTP/authentication helpers and vector-store
  state compatibility.
- New database classes use the shared bases and register in `src/database/open-databases.ts`. See
  [the database guide](src/database/README.md) for examples and compatibility requirements.
- `src/config/`: configuration parsing/defaults, shared loaded configuration, Ollama prompt
  resolution, and runtime directory paths. `load-config.ts` can be imported safely in tests;
  `botge-config.ts` and `ollama-config.ts` read local configuration when imported.
- `src/utils/`: general-purpose helpers; `src/types.ts`: shared types.
- `tests/`: Vitest suites grouped by subsystem; see [the test guide](tests/README.md). The opt-in
  Docker Compose suite lives in `tests/integration/`.
- `compose.yaml` and `compose.full.yaml`: container stacks. `compose.build.yaml` opts into a local
  build with the `Dockerfile`; nginx configuration lives in `nginx/`.
- `botge_control/` and `scripts/botge-control`: Linux deployment and control tooling. Read
  [the control guide](botge_control/README.md) before changing this tooling.

## Development and validation

Use npm and the committed `package-lock.json`. Follow `package.json` engine requirements and
`.nvmrc`; install dependencies with `npm ci` when needed.

- Build application: `npm run build`.
- Check production compilation: `npm run build:production` (use a temporary `--outDir` when needed).
- Check all TypeScript projects: `npm run typecheck`.
- Run the standard offline checks: `npm run check` (types, ESLint, Knip, and local tests).
- Find unused files, exports, and dependencies: `npm run knip`.
- Generate coverage reports: `npm run test:coverage`; generated reports live in `coverage/`. Each
  source file must reach 80% statements, branches, functions, and lines.
- Type-check tests separately: `npx tsc --project tests --noEmit`.
- Run local tests once: `npm run test:run` (no credentials or services required; Compose is skipped
  unless `BOTGE_TEST_COMPOSE=true` is set).
- Run a focused test: `npx vitest run tests/<area>/<name>.test.ts`.
- Lint TypeScript: `npm run eslint`.
- Check Markdown: `npm run markdownlint`.
- Check spelling: `npm run cspell`.
- Lint shell scripts: `npm run lint:shell` (requires ShellCheck).
- Lint workflows and inline shell: `npm run lint:workflows` (requires actionlint and ShellCheck).
- Format changed files: `npx prettier --write <files>`.

Choose checks appropriate to the change. For TypeScript changes, build and run relevant tests;
type-check tests when changing them. For documentation changes, check formatting and Markdown.
Report checks that failed or could not run, including the reason.

`npm test` invokes Vitest without forcing a single run. Use `npx vitest run` for a single run. Opt
into the real Compose integration with
`BOTGE_TEST_COMPOSE=true npx vitest run tests/integration/compose.test.ts`. It requires Docker,
`.env`, and `botge.config.json`, and logs a real bot into Discord. It uses a unique test project,
isolated named volumes, and a temporary nginx cache. Check for an existing stack before running it.
`npm start` prunes Docker images and starts the stack; it is not a validation command.

## Implementation conventions

- The ongoing refactor focuses on modernization, cleanup, and correctness while preserving the
  project's purpose. The large existing changes are part of that refactor; preserve them.
  `botge_control/` and its associated deployment tooling are a separate new feature, outside the
  refactor scope unless explicitly requested.
- A request to "check" a file means review correctness, modernity, and useful improvements. Apply
  fixes within the requested scope while preserving the file's fundamental purpose.
- Follow nearby code and the repository's ESLint, Prettier, and TypeScript configurations. Use two
  spaces, single quotes, and semicolons.
- Group imports at the top: Node built-ins, external packages, then project modules, with a blank
  line between groups. Sort module paths and named imports alphabetically, keeping type-only imports
  beside their source module. Preserve the order of imports used only for side effects.
- Use camelCase for variables and parameters, PascalCase for types/classes, and UPPER_SNAKE_CASE for
  fixed module constants. Mutable counters use camelCase. Prefer descriptive names over trailing
  underscores; preserve external API and stored-data field names.
- Use ESM and `.ts` extensions for relative TypeScript imports. Use `import type` for type-only
  imports and retain explicit types where required by isolated declarations.
- Use readonly properties and arrays for data inputs and snapshots, and ReadonlyMap/ReadonlySet for
  collections that callers only read. Keep state and shared registries mutable where they are
  updated. Use `MutableArray<T>` from `src/types.ts` for parameters that intentionally modify an
  array; ordinary array parameters are checked by the readonly rule. Narrow helper inputs to the
  fields or methods they use before adding lint exceptions.
- Preserve the existing separation between handlers, message builders, API clients, and database
  classes. Keep domain-specific helpers beside their owners; reserve `utils/` for general-purpose
  functions. Extend existing modules before adding another abstraction or dependency.
- When adding commands, add names in `src/discord/command-names.ts` and definitions in
  `src/discord/slash-commands.ts` or `src/discord/context-menu-commands.ts`. Command selection lives
  in `src/discord/commands.ts`, dispatch in `src/bot/create-command-handlers.ts`, and registration
  in `src/discord/update-commands.ts`. Default command lists come from `command-names.ts`; keep the
  schema's enums/defaults synchronized. Explicit config lists override these defaults.
- When changing configuration, keep `src/config/load-config.ts` validation/defaults, shared types,
  `botge.config.schema.json`, `botge.example.config.jsonc`, and setup documentation consistent.
  Schema defaults alone do not apply runtime defaults. Preserve explicit false values and empty
  command lists. Use `.env.example` for environment examples.
- Use `src/api/http.ts` for bounded HTTP requests and status handling; use Node's built-in global
  `WebSocket` for 7TV. Keep WebSocket enabled in `node.config.json`.
- Validate untrusted API/WebSocket data before narrowing it to domain types. The unsafe assertion
  rule is enabled for application code; documented exceptions cover SQLite mapping and partial test
  doubles. Async event and timer callbacks must start work through a synchronous callback and handle
  rejections.
- Add focused regression coverage for behavior changes when useful; avoid tests that only repeat
  implementation details. Keep external services mocked where practical.

## Workspace and runtime data

- Preserve existing uncommitted work and keep edits scoped to the task.
- Edit source files rather than generated `dist/` output or `coverage/` reports. Leave
  `node_modules/` generated.
- Treat `.env` and `botge.config.json` as local configuration. Do not expose credentials or copy
  local values into examples, documentation, tests, or commits.
- Preserve `data/`, SQLite databases, Docker volumes, and `nginx/cache/`. Use isolated temporary
  data for tests that write files or databases.
- Deployment scripts can alter host accounts, Docker services, and stored data. Validate script
  changes without executing setup, teardown, import, or deployment as routine checks.

Keep this file concise and update it when project workflows change. Link to existing documentation
instead of duplicating setup instructions.

Workflow triggers, production approvals, and local lint setup are documented in
[the workflow guide](.github/workflows/README.md). Keep the pre-merge deployment flow intact.
