# GitHub workflows

Release through `dev` → same-repository PR to `main` → passing checks → approved production
deployment → merge. Merging does not deploy again.

## Validation

[BotgeQL](botgeql.yml) runs on PRs to `dev` and is called by Build and Deploy for PRs to `main`. It
checks formatting, documentation, commit conventions, Rust lints, Rustdoc, and coverage, TypeScript
types, ESLint, unused code, Activity HTML/SCSS, tests, ShellCheck, and actionlint. Pushes alone do
not run it; changes to an open PR and PR title edits do.

Change detection compares the complete PR against its base. Formatting, documentation, and commit
checks always run; other stages run when their inputs change. Editing BotgeQL exercises every stage.
Required jobs remain present when optional stages are skipped. Failed change detection fails
validation. Tests use temporary data, loopback fixtures, and mocks without deployment credentials.
Rust coverage requires at least 90% lines, functions, regions, and branches per source file. The
combined TypeScript suite requires 90% statements, branches, functions, and lines per runtime source
file, including repository tooling, the Activity, and its Worker. Declaration-only files are
excluded.

Development, CI, and Docker share the dated Rust channel in `rust-toolchain.toml`. Development uses
the default profile, LLVM tools, and standard-library sources. CI selects the minimal profile plus
Clippy, rustfmt, and LLVM tools; Docker installs only the minimal profile. Both build with bundled
Opus.

Cargo downloads and artifacts are cached by toolchain and manifests. Coverage/FFmpeg tools have a
separate cache; workflow lint caches actionlint. npm prefers cached downloads. Cache visibility
follows GitHub's branch rules; cold runs still install and compile dependencies.
[Closed PR cleanup](cleanup-caches.yml) removes merge-ref caches when a PR closes while preserving
branch caches. It checks out no code and has only cache-management permission. BuildKit stores
individual layers, so one image-building PR can create many cache entries.

## Security checks

[Dependency Security](dependency-security.yml) runs directly on PRs to `dev`, weekly, and on demand.
Build and Deploy calls it for PRs to `main`, avoiding duplicate audits. It reviews dependency
changes and audits the shared npm workspace, integration-test, and Cargo lockfiles. The Cargo audit
executable is cached by version and runner platform; warm runs skip compiler/tool installation.

Dependency review, npm/Cargo audits, and Docker Scout block **critical** vulnerabilities. Cargo
maintenance warnings and advisories without severity scores are informational; scanner errors still
fail checks. Scout scans the immutable candidate on AMD64 and ARM64, including unfixed findings. See
[production contracts](../../docs/PRODUCTION.md#dependency-security) for triage and exceptions.

[CodeQL](codeql.yml) scans workflows, Rust, and TypeScript on PRs to `dev`/`main`, pushes to `main`,
and scheduled/manual runs. All three analyses upload results even for unchanged languages to satisfy
code-scanning protection. Rust uses `build-mode: none`; the queries still analyze the extracted
code. Regal checks changed Rego inputs. Actions lockfile verification checks changed workflow
references. The assignment workflow handles metadata without checking out PR code.

## Candidate and deployment

[Build and Deploy](build-and-deploy.yml) validates drafts but builds and deploys only ready PRs. PR
openings, updates, edits, and ready-for-review events can trigger it. Image-path filtering runs
alongside validation and audits; builds wait for all three to pass.

For image-affecting changes, native AMD64 and ARM64 runners build in parallel. The candidate tag
identifies the PR and tested merge commit. Scout must pass before `production` approval. After
approval, `Deploy` rechecks the same-repository `dev` head, `main` target, open PR, and tested merge
commit. It promotes the candidate digest to `latest` and requests the VM update through the control
socket over Google Cloud IAP. Promotion and deployment share a concurrency group and cannot cancel
each other. Cancel obsolete approval requests after updating a PR.

The host handler verifies the running digest and gateway readiness, then saves the pin for
subsequent starts. Update host-side Compose and control files before the first digest deployment.
Previous images remain available for rollback. PRs without image changes still require production
approval but retain the running image without restarting it. See
[recovery contracts](../../docs/PRODUCTION.md) and the
[cost policy](../../docs/PRODUCTION.md#cost-policy).

## GitHub settings

These settings live outside workflow files:

- `main` requires a PR, up-to-date checks, and successful `production` deployment before merge.
- Required checks include `Validate / BotgeQL`, `Validate / Shell and workflow lint`,
  `Validate / check-pr-target / Check PR target`, the three `Security / Dependency` checks, CodeQL's
  three language analyses, `Regal lint`, and `Verify actions lockfile`.
- The `production` environment requires approval and permits the PR merge refs used for deployment.
  Preserve its secrets and reviewer settings.
- The organization Actions allowlist includes Scout. SHA pinning remains required; the committed
  lockfile supplies resolved SHAs. Default tokens are read-only and cannot approve PRs.

PRs to `main` must come from the same repository's `dev` branch. Dependency audit concurrency
includes the caller workflow name so unrelated runs cannot cancel each other.

## Local workflow checks

Optional local CodeQL runs use `.github/codeql/database/` for databases and `.github/codeql/output/`
for reports. Both directories are ignored except for `.gitkeep` files. Use CI's security-and-quality
suites; local CodeQL is not required before pushing.

Install [ShellCheck](https://www.shellcheck.net/) and
[actionlint](https://github.com/rhysd/actionlint), then run:

```sh
brew install shellcheck actionlint
npm run lint:shell
npm run lint:workflows
```

CI uses actionlint `v1.7.12`. The lint script checks temporary copies with `./` references because
that version predates GitHub's `$/` syntax; committed workflows retain `$/`.

When action versions or workflow membership change, regenerate the lockfile with
[gh-actions-lock](https://github.com/github/gh-actions-lock); do not edit it manually:

```sh
gh actions-lock
gh actions-lock --verify
gh actions-lock --verify-local
```

Generation and provenance verification need GitHub authentication. The local check verifies coverage
only.
