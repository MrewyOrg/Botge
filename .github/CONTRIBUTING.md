# Contributing

Start with the [development wiki](https://github.com/MrewyOrg/Botge/wiki/Development) for setup and
the [architecture guide](../docs/ARCHITECTURE.md) for source contracts. Use a separate Discord test
application. Never commit credentials or runtime data.

Open feature and fix PRs against `dev`. Promotion to `main` comes only from the same repository's
`dev` branch and requires validation plus production approval before merge.

Git hooks run a subset of the checks automatically:

- [.husky/commit-msg](../.husky/commit-msg)
- [.husky/pre-commit](../.husky/pre-commit)

The pre-commit hook formats and lints staged files and builds the Activity. It does not run the
complete Rust and TypeScript test suites. Run the checks appropriate to the change from
[AGENTS.md](../AGENTS.md) and record results or limitations in the PR. CI is authoritative; local
hooks supplement it. Dependency vulnerabilities need a fix or a reviewed, time-bounded exception.
