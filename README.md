<h1 align="center">
  <img src="assets/botge-icon.png" alt="Botge logo" width="96" height="96"><br>
  Botge
</h1>

<p align="center">7TV emotes for Discord, in chat, in an Activity and on iPhone.</p>

<p align="center">
  <a
    href="https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml?query=event%3Apull_request"
    ><img
      src="https://github.com/MrewyOrg/Botge/actions/workflows/build-and-deploy.yml/badge.svg?event=pull_request"
      alt="Build and deploy"
  /></a>
  <a
    href="https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml?query=branch%3Amain+event%3Apush"
    ><img
      src="https://github.com/MrewyOrg/Botge/actions/workflows/codeql.yml/badge.svg?branch=main&amp;event=push"
      alt="CodeQL"
  /></a>
  <a
    href="https://github.com/MrewyOrg/Botge/releases/latest"
    ><img
      src="https://img.shields.io/github/v/release/MrewyOrg/Botge"
      alt="Latest release"
  /></a>
  <a
    href="LICENSE.txt"
    ><img
      src="https://img.shields.io/github/license/MrewyOrg/Botge"
      alt="License"
  /></a>
</p>

<p align="center">
  <a
    href="crates/"
    ><img
      src="https://img.shields.io/badge/Rust-000000?logo=rust&amp;logoColor=white"
      alt="Rust"
  /></a>
  <a
    href="activity/"
    ><img
      src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&amp;logoColor=white"
      alt="TypeScript"
  /></a>
  <a
    href="activity/server/"
    ><img
      src="https://img.shields.io/badge/Go-00ADD8?logo=go&amp;logoColor=white"
      alt="Go"
  /></a>
  <a
    href="ios/"
    ><img
      src="https://img.shields.io/badge/Swift-F05138?logo=swift&amp;logoColor=white"
      alt="Swift"
  /></a>
  <a
    href="quantum/"
    ><img
      src="https://img.shields.io/badge/Q%23-5C2D91"
      alt="Q#"
  /></a>
</p>

Botge brings 7TV emotes to Discord: send and stack them in chat, browse and compose them in a
Discord Activity, play a guessing game, and manage each server's catalog from the web or an iPhone.

## Features

| Feature                          | What it does                                               |
| -------------------------------- | ---------------------------------------------------------- |
| :speech_balloon: **Chat emotes** | Stack emotes and images with `/emote-compose` or `+emote`  |
| :art: **Discord Activity**       | Browse, compose and manage emotes, with catalog history    |
| :dart: **Guess**                 | Multiplayer emote guessing in the Activity and the iOS app |
| :iphone: **iOS app**             | Native SwiftUI app with a Lock Screen Live Activity        |
| :atom_symbol: **Quantum emotes** | `/quantum-emote` draws a pair from a simulated Q# circuit  |
| :wrench: **Server tools**        | Voice status, `/emote-shortcuts` and `/clear-messages`     |

## Documentation

The [Botge wiki](https://github.com/MrewyOrg/Botge/wiki) is the main documentation site.

- [Using Botge: commands and Activity](https://github.com/MrewyOrg/Botge/wiki/Activity)
- [Hosting and configuration](https://github.com/MrewyOrg/Botge/wiki/Hosting)
- [Operations and troubleshooting](https://github.com/MrewyOrg/Botge/wiki/Operations)
- [Development](https://github.com/MrewyOrg/Botge/wiki/Development)
- [Roadmap](https://github.com/orgs/MrewyOrg/projects/2/views/6)

## Repository

| Path                               | What it holds                                            |
| ---------------------------------- | -------------------------------------------------------- |
| [`crates/`](crates/)               | Rust bot: commands, voice, storage and the Activity API  |
| [`activity/`](activity/)           | TypeScript Discord Activity and its signed Go origin     |
| [`ios/`](ios/)                     | SwiftUI iOS app, `BotgeKit` and the Live Activity widget |
| [`quantum/`](quantum/)             | Q# circuit, FastAPI sidecar, specification and proofs    |
| [`botge_control/`](botge_control/) | Debian installation and control scripts                  |
| [`scripts/`](scripts/)             | Python and shell helpers                                 |
| [`tests/`](tests/)                 | Cross-language tests and coverage gates                  |

Implementation details stay versioned with the code:

- [Architecture](docs/ARCHITECTURE.md) and the [Rust workspace guide](crates/README.md)
- [Activity guide](activity/README.md), [iOS guide](ios/README.md) and
  [quantum setup and VS Code guide](quantum/README.md)
- [Tests and coverage](tests/README.md) and [helper scripts](scripts/README.md)
- [GitHub workflows](.github/workflows/README.md) for validation and approved deployment
- [Production contracts](docs/PRODUCTION.md) for readiness, image verification and recovery

## Contributing

Start with the [Development](https://github.com/MrewyOrg/Botge/wiki/Development) wiki page and the
[test guide](tests/README.md). Ask questions in
[discussions](https://github.com/MrewyOrg/Botge/discussions) and report bugs in
[issues](https://github.com/MrewyOrg/Botge/issues).

## Project information

The [cost policy](docs/PRODUCTION.md#cost-policy) requires new tooling and infrastructure to remain
free to use.

Review the [terms](docs/TERMS.md) and [privacy guidance](docs/PRIVACY.md) before hosting. See
[releases](https://github.com/MrewyOrg/Botge/releases) for changes.

Botge is licensed under the [MIT License](LICENSE.txt).
