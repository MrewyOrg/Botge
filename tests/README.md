# Tests

Run commands from the repository root:

```sh
npm test -- --run
npm test -w activity
npm test -- --run --project Botge
npx vitest run tests/emotes
npx vitest run tests/api/http.test.ts
npm run typecheck
```

The default run covers both suites. Use the workspace command for the
[Activity tests](../activity/README.md#preview-and-build) or `--project Botge` for the bot and
repository tooling tests.

Group tests by their owning subsystem, matching `src/` where practical. Handler suites cover
commands, interactions, and messages. Add regression cases to the related suite.

The default run uses mocked external services and isolated temporary or in-memory storage. Import
individual modules; the entry-point smoke test mocks application startup before importing
`src/index.ts`. Mock loaded configuration modules when necessary so tests do not depend on local
settings or credentials. Restore mocks, timers, and environment changes after each test, and clean
up temporary storage.

Prefer tests of observable behavior, error recovery, boundary values, and concurrency. Share
fixtures only when several suites need the same setup; keep small fixtures local.

`npm run check` runs types, ESLint, unused-code checks, and local tests. `bot/application.test.ts`
tests startup with mocked services; the opt-in Compose suite checks real container startup.

ESLint policy tests live in `tooling/` and run code samples through the real configuration. The
small `requireValue` helper makes required fixture entries explicit under
`noUncheckedIndexedAccess`; it throws when a fixture is missing instead of hiding that failure.

Control protocol tests in `control/` run the handler and client against temporary command stubs.
They cover request validation, locking, Docker failures, and transport responses without accessing a
real socket, Docker daemon, or system account.

`npm run test:coverage` requires 80% statements, branches, functions, and lines in each source file.
It produces separate HTML reports for the bot at `coverage/index.html` and the Activity at
`coverage/activity/index.html`. Coverage identifies untested paths; it does not prove correctness.

## Compose integration

The Compose suite has its own package and lockfile. Install its dependencies and run it from the
repository root:

```sh
npm --prefix tests/integration ci
npm --prefix tests/integration run typecheck
BOTGE_TEST_COMPOSE=true npm --prefix tests/integration test
```

The test requires Docker, `.env`, and `botge.config.json`. It logs a real bot into Discord, so check
for an existing stack before running it. It builds the full Compose stack with an isolated project
name, named volumes, and a temporary nginx cache.
