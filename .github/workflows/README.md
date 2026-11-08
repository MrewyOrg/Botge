# GitHub workflows

Release through `dev` → same-repository PR to `main` → passing checks → approved production
deployment → merge. Merging does not deploy again.

## Validation and deployment

[BotgeQL](botgeql.yml) runs on pushes to `dev`/`main`, PRs to `dev`, and as a reusable workflow for
PRs to `main`. It checks formatting, documentation, commit conventions, types, ESLint, unused code,
test coverage, ShellCheck, and actionlint. Coverage appears in the job log. PR title edits rerun
validation.

Before testing, CI copies `botge.example.config.jsonc` to `botge.config.json`. Tests use the example
defaults and mocked services; no deployment configuration or credentials are needed.

[Build and Deploy](build-and-deploy.yml) calls that validation before building an image. Draft PRs
are validated but do not build or deploy until marked ready. Each image has a candidate tag derived
from its PR and merge commit. Builds leave `latest` unchanged.

After `production` environment approval, `Deploy` verifies the PR still targets `main` from the
current same-repository `dev` head and has a current tested merge commit. It promotes the
candidate's immutable digest to `latest` and updates the server through the control socket over
Google Cloud IAP. Promotion and deployment share a concurrency group; newer runs cannot cancel an
active deployment. Stale runs fail. Cancel obsolete approval requests after pushing another commit.

A PR without image-affecting changes still enters the approved production job and records that the
existing image was retained. It does not restart the stack. Image-affecting paths follow the
Dockerfile inputs. Deployment success means Compose completed successfully; it does not establish
that the bot logged into Discord.

CodeQL analyzes workflows and TypeScript on relevant pushes and PRs, and runs a full scheduled scan.
Regal checks Rego changes. The Actions lockfile workflow verifies changed workflow references. The
assignment workflow handles metadata without checking out PR code.

## Repository settings

These settings live in GitHub, outside the workflow files:

- Protect `main`; require a PR, the validation and security checks, and a successful `production`
  deployment before merge. Require the branch to be up to date so checks cover the current base.
- Keep required reviewers on the `production` environment, and retain its existing deployment
  secrets. Its branch policy must allow the PR refs used by this pre-merge deployment process.
- Select current check names in branch protection: `Validate` includes `BotgeQL` and
  `Shell and workflow lint`. Require CodeQL, Regal, and Actions lockfile verification as
  appropriate; remove obsolete check names.

Workflows enforce the `dev` source branch and reject forks for PRs into `main`. They do not modify
repository protection rules or environment approvals.

## Local linting

Install [ShellCheck](https://www.shellcheck.net/) and
[actionlint](https://github.com/rhysd/actionlint), then run:

```sh
brew install shellcheck actionlint
npm run lint:shell
npm run lint:workflows
```

CI installs ShellCheck from Ubuntu packages and actionlint at `v1.7.12`. Workflow lint also uses
ShellCheck for inline shell blocks. The wrapper validates temporary copies with equivalent `./`
local references because actionlint 1.7 predates GitHub's `$/` syntax. Committed references retain
`$/` for GitHub and the Actions lockfile tool.

When changing action versions or workflow membership, regenerate the lockfile with the
[gh-actions-lock extension](https://github.com/github/gh-actions-lock). Do not hand-edit it:

```sh
gh actions-lock
gh actions-lock --verify
gh actions-lock --verify-local
```

Generation and full provenance verification require GitHub authentication. The local check only
verifies coverage of workflow references.
