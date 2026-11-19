<!-- cspell:words norc -->

# GitHub workflows

Release through `dev` → same-repository PR to `main` → passing checks → approved production
deployment → merge. Merging does not deploy again.

## Validation

[BotgeQL](botgeql.yml) runs on PRs to `dev` and is called by Build and Deploy for PRs to `main`. It
runs the commands in the [test guide](../../tests/README.md#checks) plus PR title and commit checks.
Pushes alone do not run it; changes to an open PR and PR title edits do. Dependabot PR titles and
Dependabot-signed commits skip commitlint: Dependabot writes lines naming long dependencies or
commit hashes that it cannot wrap, and merge commits never reuse PR titles.

Its stages run as parallel jobs: documentation and TypeScript, Rust static checks (including the
stable `rust-version` build), Rust tests and coverage, Miri, Rust feature and unused-dependency
checks, and iOS lint, tests and coverage on the standard `xcode-27` macOS runner with the newest
Xcode 27. A final `BotgeQL` job passes only when every stage succeeded or was skipped and change
detection succeeded, so rulesets keep requiring that one check name. The Rust jobs share the
[`rust-setup`](../actions/rust-setup/action.yml) composite action, referenced as `$/` so the actions
lockfile pins this repository's copy. It installs the nightly with each job's components, restores a
build cache named per job, and provides only the pinned test tools that job needs.

Change detection compares the complete PR against its base. Formatting, documentation, and commit
checks always run; other stages run when their inputs change. Editing BotgeQL exercises every stage.
Required jobs remain present when optional stages are skipped. Failed change detection fails
validation. Tests use temporary data, loopback fixtures, and mocks without deployment credentials.

Python checks run in the Shell and workflow lint job, using cached uv to install the locked tools;
the [helper guide](../../scripts/README.md) owns them. Each Rust job adds only the components it
needs to the nightly's minimal profile.

Cargo downloads, Miri's standard library, and build artifacts are cached per Rust job by toolchain
and manifests. Pinned coverage, cargo-hack, cargo-udeps, and FFmpeg tools have a separate cache
keyed by the job's tool set, their versions, the toolchain, and the FFmpeg installer, so workflow
edits reuse it; workflow lint caches actionlint. npm prefers cached downloads. Cache visibility
follows GitHub's branch rules; cold runs still install and compile dependencies.
[Closed PR cleanup](cleanup-caches.yml) removes merge-ref caches when a PR closes while preserving
branch caches. It checks out no code and has only cache-management permission. BuildKit stores
individual layers, so one image-building PR can create many cache entries.

## Security checks

[Dependency Security](dependency-security.yml) runs directly on PRs to `dev`, weekly, and on demand.
Build and Deploy calls it for PRs to `main`, avoiding duplicate audits. It reviews dependency
changes and audits the shared npm workspace, integration-test, and Cargo lockfiles. The Cargo audit
executable is cached by version and runner platform; warm runs skip compiler/tool installation. The
npm audits read the committed lockfiles directly without installing dependencies.

Dependency review, npm/Cargo audits, and Docker Scout block **critical** vulnerabilities. Cargo
maintenance warnings and advisories without severity scores are informational; scanner errors still
fail checks. Scout scans the immutable candidate on AMD64 and ARM64, including unfixed findings. See
[production contracts](../../docs/PRODUCTION.md#dependency-security) for triage and exceptions.

[CodeQL](codeql.yml) scans workflows, Rust, and TypeScript on PRs to `main`, pushes to `main`, and
scheduled/manual runs. PRs into `dev` are Dependabot updates, which reach CodeQL through the release
PR. All three analyses upload results even for unchanged languages to satisfy code-scanning
protection. Rust uses `build-mode: none`; the queries still analyze the extracted code. Regal checks
changed Rego inputs. Actions lockfile verification checks changed workflow references. The
assignment workflow handles metadata without checking out PR code.

Rust's buildless extractor still compiles build scripts and procedural macros. Its Cargo output
directory and dependency downloads are cached by runner, toolchain, and manifests. Each run still
extracts the current source and runs the complete security-and-quality suite; analysis databases and
query results are not reused from earlier commits.

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

The Dockerfile copies every workspace manifest and compiles locked dependencies against placeholder
packages before copying application sources. Dependency artifacts live in image layers so
`cache-mode: max` can export them; BuildKit cache mounts alone would not survive fresh CI runners.
Source-only rebuilds reuse that layer when the toolchain and workspace Cargo manifests are
unchanged. Cold builds and inaccessible or evicted caches still compile all dependencies. Both
compilation steps run offline, and only the final binary enters the runtime image.

The compiler runs on DHI Debian and targets musl for AMD64 or ARM64. DHI Alpine remains the runtime
because it supplies FFmpeg 9 with animated WebP decoding; Debian 13's packaged FFmpeg is older.
Cargo removes only the placeholder package's artifacts before compiling the real bot. The runtime
smoke check requires a real version response and verifies animated WebP as the runtime user.

`Deploy` then builds and deploys the Activity Worker with the same approval when Activity or Worker
inputs changed, after the bot so the page never calls an older API. The build turns on every
Activity feature flag (catalog, adds, settings, Guess and 7TV discovery) in its `Build the Activity`
step, because Vite reads them at build time and the page otherwise shows only the preview catalog. A
separate `Deploy demo` job runs only after `Deploy` succeeds, so the same approval releases it, and
builds and deploys the static demo when its inputs changed. It runs for every ready PR in the
`activity-demo` environment, without reviewers, so that environment always records a deployment for
the merge rule; unchanged runs succeed without uploading. Both use Wrangler from `activity/deploy/`,
which has its own lockfile so CI's `npm ci` never downloads Wrangler's native runtime. A failed
Activity deploy fails `production` and blocks the merge even though the bot is already updated;
redeploy or roll back the Worker with Wrangler before retrying.

The host handler verifies the running digest and gateway readiness, then saves the pin for
subsequent starts. Update host-side Compose and control files before the first digest deployment.
Previous images remain available for rollback. PRs without image changes still require production
approval but retain the running image without restarting it. See
[recovery contracts](../../docs/PRODUCTION.md) and the
[cost policy](../../docs/PRODUCTION.md#cost-policy).

## GitHub settings

These settings live outside workflow files:

- `main` requires a PR, up-to-date checks, and successful `production` and `activity-demo`
  deployments before merge.
- Required checks include `Validate / BotgeQL`, `Validate / Shell and workflow lint`,
  `Validate / check-pr-target / Check PR target`, the three `Security / Dependency` checks, CodeQL's
  language analyses, `Regal lint`, and `Verify actions lockfile`. The matrix covers Actions, Python,
  Rust and TypeScript; add the Python analysis to any explicit required-check list once it has run.
- The `production` environment requires approval and permits the PR merge refs used for deployment.
  Preserve its secrets and reviewer settings. It also holds `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` secrets and the `DISCORD_ACTIVITY_PUBLIC_KEY` variable. Create the token
  from Cloudflare's **Edit Cloudflare Workers** template and limit it to the deploying account, as
  [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
  describes.
- The `activity-demo` environment has no reviewers, permits the same merge refs, and holds the same
  two Cloudflare secrets.
- The organization Actions allowlist includes Scout. SHA pinning remains required; the committed
  lockfile supplies resolved SHAs. Default tokens are read-only and cannot approve PRs.

PRs to `main` must come from the same repository's `dev` branch. Dependency audit concurrency
includes the caller workflow name so unrelated runs cannot cancel each other.

## Local workflow checks

Optional local CodeQL runs use `.github/codeql/database/` for databases and `.github/codeql/output/`
for reports. Both directories are ignored except for `.gitkeep` files. Use CI's security-and-quality
suites; local CodeQL is not required before pushing. Python analysis covers repository helpers and
tests, including `.agents/`; virtual environments and cached references are excluded.

To run the Python suite locally with an installed CodeQL CLI:

```sh
codeql database create .github/codeql/database/python \
  --language=python --build-mode=none --source-root=. \
  --codescanning-config=.github/codeql/codeql-config.yml
codeql database analyze .github/codeql/database/python \
  codeql/python-queries:codeql-suites/python-security-and-quality.qls \
  --format=sarif-latest --output=.github/codeql/output/python.sarif
```

Use a fresh database path for each extraction. Analysis does not start the bot or run deployment.

Install [ShellCheck](https://www.shellcheck.net/) and
[actionlint](https://github.com/rhysd/actionlint), then run:

```sh
brew install shellcheck actionlint
npm run lint:shell
npm run lint:workflows
```

CI uses actionlint `v1.7.12`. The lint script checks temporary copies with `./` references because
that version predates GitHub's `$/` syntax; committed workflows retain `$/`.

The root `.shellcheckrc` enables every optional ShellCheck rule for scripts, including sourced
files. Script shebangs select Bash or POSIX shell. actionlint deliberately invokes ShellCheck with
`--norc` and its own workflow-specific exclusions, so embedded workflow commands use actionlint's
checks. The lint script copies `.github/actionlint.yaml` into its temporary workspace; this config
allows no custom runner labels and declares the `DISCORD_ACTIVITY_PUBLIC_KEY` variable. Add other
variables there when needed.

When action versions or workflow membership change, regenerate the lockfile with
[gh-actions-lock](https://github.com/github/gh-actions-lock); do not edit it manually:

```sh
gh actions-lock
gh actions-lock --verify
gh actions-lock --verify-local
```

Generation and provenance verification need GitHub authentication. The local check verifies coverage
only.
