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
Xcode 27, Go Activity checks, and shell, workflow, Python, and Swift documentation checks. A final
`BotgeQL` job passes when every applicable stage succeeds and change detection succeeds, so rulesets
can keep requiring the same check name. The Rust jobs share the
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

The Linux tooling job also runs the Python Swift documentation check. The iOS job saves the tools
cache after the pinned tools build, before running checks that may fail. The cache key includes the
selected Xcode build and Swift package inputs. A PR cache can help later runs on the same PR.
SwiftLint's analyzer reads the log of one clean, coverage-instrumented build, and the serial
simulator suite tests those same products. See [Apple's build and test actions][xcode-test-actions]
and [GitHub's cache scope rules][cache-scope].

[xcode-test-actions]:
  https://developer.apple.com/documentation/xcode/configuring-your-xcode-cloud-workflow-s-actions
[cache-scope]: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching

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
alongside audits. Its result tells BotgeQL when the release job will qualify the Activity image, so
one build and image smoke test suffice. Go lint, unit tests, coverage, and vulnerability checks
still run when their inputs change. Candidate builds wait for validation and audits to pass. An
updated PR cancels obsolete builds for the same candidate platform.

Native AMD64 and ARM64 runners qualify the Rust bot. A native AMD64 runner qualifies the Activity
server. Each runner builds a local OCI archive with an SBOM and build provenance, scans the runtime
manifest's attached SPDX SBOM with Scout, and smoke-tests the image from that archive. The Rust
builds push their tested archives to Docker Hub by digest. The Activity build retains its tested
archive as a GitHub Actions artifact for seven days. Rerun the Activity build if the archive expires
before approval.

The Rust publication job assembles the platforms under `mrewy/botge:pr-<number>-<merge SHA>`,
verifies the published SBOMs and attests the candidate digest.

Each changed image must pass qualification before `production` approval. After approval, `Deploy`
rechecks the same-repository `dev` head, `main` target, open non-draft PR, and tested merge commit.
For Activity changes, it downloads the archive by artifact ID and verifies its SHA-256. For Rust
changes, it requests the digest-pinned VM update over Google Cloud IAP and tags the healthy digest
as `latest`. It then uploads any Activity candidate to Artifact Registry, verifies the published
SBOM, attests the image and deploys the same digest to Cloud Run. Both deployments share the
production concurrency group. Cancel obsolete approval requests after updating a PR.

The Dockerfile copies every workspace manifest and compiles locked dependencies against placeholder
packages before copying application sources. Dependency artifacts live in image layers so the signed
BuildKit cache can export them with `mode=max` across fresh CI runners. Source-only rebuilds reuse
that layer when the toolchain and workspace Cargo manifests are unchanged. Cold builds and
inaccessible or evicted caches still compile all dependencies. Both compilation steps run offline,
and only the final binary enters the runtime image.

The compiler runs on DHI Debian and targets musl for AMD64 or ARM64. DHI Alpine remains the runtime
because it supplies FFmpeg 9 with animated WebP decoding; Debian 13's packaged FFmpeg is older.
Cargo removes only the placeholder package's artifacts before compiling the real bot. The runtime
smoke check requires a real version response and verifies animated WebP as the runtime user.

The host handler verifies the running digest and gateway readiness, then saves the pin for
subsequent starts. Update host-side Compose and control files before the first digest deployment.
Previous images remain available for rollback. PRs without image changes still require production
approval but retain the running image without restarting it. See
[recovery contracts](../../docs/PRODUCTION.md) and the
[cost policy](../../docs/PRODUCTION.md#cost-policy).

## GitHub settings

These settings live outside workflow files:

- `main` requires a PR, up-to-date checks, and a successful `production` deployment before merge.
- Required checks include `Validate / BotgeQL`, `Validate / Shell and workflow lint`,
  `Validate / check-pr-target / Check PR target`, the three `Security / Dependency` checks, CodeQL's
  language analyses, `Regal lint`, and `Verify actions lockfile`. The matrix covers Actions, Go,
  Python, Rust and TypeScript. Add the Python analysis to any explicit required-check list once it
  has run. The Go row stages the Activity assets and builds the origin for manual extraction.
- The `production` environment requires approval and permits the PR merge refs used for deployment.
  Preserve its bot deployment secrets and reviewer settings.
- The organization Actions allowlist includes Scout. SHA pinning remains required; the committed
  lockfile supplies resolved SHAs. Default tokens are read-only and cannot approve PRs.

PRs to `main` must come from the same repository's `dev` branch. Dependency audit concurrency
includes the caller workflow name so unrelated runs cannot cancel each other.

### Activity deployment on Cloud Run

Configure these Actions variables in the `production` environment.

- **`ACTIVITY_ARTIFACT_REGISTRY_IMAGE`.**
  `us-central1-docker.pkg.dev/xmrewy-project/xmrewy-containers/botge-activity-server`
- **`ACTIVITY_CLOUD_RUN_SERVICE`.** `botge-activity`
- **`ACTIVITY_GCLOUD_DEPLOY_SERVICE_ACCOUNT`.**
  `xmrewy-run-deploy@xmrewy-project.iam.gserviceaccount.com`
- **`ACTIVITY_CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`.**
  `xmrewy-run@xmrewy-project.iam.gserviceaccount.com`
- **`DISCORD_ACTIVITY_PUBLIC_KEY`.** The public key for the production Discord application

The approved job reuses the `GCLOUD_WORKLOAD_IDENTITY_PROVIDER` environment secret. Its [Workload
Identity provider][google-federation] must allow the Botge repository in the `production`
environment to impersonate the Activity deployer. Give the deployer Artifact Registry Writer on
`xmrewy-containers`, Cloud Run Developer, and Service Account User on the runtime account. The
separate VM deployment continues to use `GCLOUD_SERVICE_ACCOUNT`.

The first approved deployment creates the service. A Google Cloud administrator must then grant
`roles/run.invoker` to `allUsers` on that service so Discord can reach it. Keep the Cloud Run
invoker check enabled. Subsequent deployments preserve this IAM policy. Cloud Run starts the
revision using the internal `/healthz` probe and sends traffic to the ready revision. Each run
records the deployed digest, revision, and URL. Use that URL's hostname for Discord's `/` mapping.
The Activity verifier requires Discord's signature to serve content. Keep `/botge-api` pointed to
the [Rust bot's HTTPS endpoint](../../activity/README.md#api-https-endpoint).

Follow the [cost policy](../../docs/PRODUCTION.md#cost-policy) before approving a deployment. Keep
tagged candidates within the shared Artifact Registry free allowance and preserve deployed and
rollback digests when configuring cleanup of old `activity-pr-*` tags. Qualify the Discord mapping
on a separate test application before the production cutover. See the
[live Discord test procedure](../../tests/README.md#live-discord-testing).

[google-federation]:
  https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines

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

### Go Activity origin

Run the Go suite locally after the per-file statement gate and before a release candidate's Discord
smoke test. Stage with the same command as CI and use the nested Go module as the extraction root.

```sh
set -eu
export GOTOOLCHAIN=local GOWORK=off
sh scripts/activity/stage-activity-server.sh
db=$(mktemp -d .github/codeql/database/go-XXXXXXXX)
codeql database create "$db/db" --language=go --source-root=activity/server \
  --command='go build -a -mod=readonly ./...'
codeql database analyze "$db/db" \
  codeql/go-queries:codeql-suites/go-security-and-quality.qls \
  --format=sarifv2.1.0 --output=".github/codeql/output/${db##*/}.sarif"
```

Confirm extraction includes the command and origin packages. Review the SARIF and record the
candidate revision, CodeQL CLI version, query pack version and findings.

### Workflow and shell lint

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
checks. The lint script copies `.github/actionlint.yaml` into its temporary workspace. This config
declares the Activity deployment variables and recognizes the standard `xcode-27` preview runner
label.

When action versions or workflow membership change, regenerate the lockfile with
[gh-actions-lock](https://github.com/github/gh-actions-lock); do not edit it manually:

```sh
gh actions-lock
gh actions-lock --verify
gh actions-lock --verify-local
```

Generation and provenance verification need GitHub authentication. The local check verifies coverage
only.
