# <img src="assets/botge-icon.png" alt="Botge logo" width="48" height="48"> Botge

[![Build and deploy](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml/badge.svg?event=pull_request)](https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml?query=event%3Apull_request)
[![Coverage threshold: 80% per file](https://img.shields.io/badge/coverage_threshold-80%25_per_file-blue)](.github/workflows/botgeql.yml)
[![CodeQL](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml/badge.svg?branch=main&event=push)](https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml?query=branch%3Amain+event%3Apush)
[![License](https://img.shields.io/github/license/MrewyOrg/Botge)](LICENSE.txt)

Botge brings Twitch-style emotes to Discord. The Rust bot handles emote commands, voice, and the
Activity API. The TypeScript Discord Activity lets members browse and compose emotes and lets
authorized users manage server settings.

## Documentation

The [Botge wiki](https://github.com/MrewyOrg/Botge/wiki) is the main documentation site.

- [Commands](https://github.com/MrewyOrg/Botge/wiki/Commands)
- [Activity and server settings](https://github.com/MrewyOrg/Botge/wiki/Activity)
- [Hosting](https://github.com/MrewyOrg/Botge/wiki/Hosting) and
  [configuration](https://github.com/MrewyOrg/Botge/wiki/Configuration)
- [Operations](https://github.com/MrewyOrg/Botge/wiki/Operations) and
  [troubleshooting](https://github.com/MrewyOrg/Botge/wiki/Troubleshooting)
- [Development](https://github.com/MrewyOrg/Botge/wiki/Development)
- [Roadmap](https://github.com/orgs/MrewyOrg/projects/2/views/6)

## Source references

Implementation details stay versioned with the code.

- [`src/`](src/) contains the Rust bot. See the [architecture](docs/ARCHITECTURE.md).
- [`activity/`](activity/) contains the browser, Worker, and their
  [workspace tooling](activity/README.md).
- [`tests/`](tests/) documents the [test suites and coverage](tests/README.md).
- [`botge_control/`](botge_control/) contains the
  [Debian installation and control scripts](botge_control/README.md).
- [GitHub workflows](.github/workflows/README.md) describe validation and approved deployment.
- [Production contracts](docs/PRODUCTION.md) cover readiness, image verification, and recovery.

## Project information

The [cost policy](docs/PRODUCTION.md#cost-policy) requires new tooling and infrastructure to remain
free to use.

Review the [terms](docs/TERMS.md) and [privacy guidance](docs/PRIVACY.md) before hosting. See
[releases](https://github.com/MrewyOrg/Botge/releases),
[discussions](https://github.com/MrewyOrg/Botge/discussions), and
[issues](https://github.com/MrewyOrg/Botge/issues).

Botge is licensed under the [MIT License](LICENSE.txt).
