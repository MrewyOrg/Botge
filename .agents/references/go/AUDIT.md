# Go baseline audit

Reviewed 2026-11-21 against the [pinned guides and subguides](README.md). Scope is the Go Activity
origin, its tests, and its build and validation tools.

## Routine checks

- **Style and structure.** `gofumpt` and `gci` own formatting and import order. Revive and the
  100-column check cover common conventions. Review names, control flow, and code boundaries. Follow
  [Effective Go][effective], [Google Go Style][google] and [Uber Go Style][uber].
- **Documentation.** `godoclint` and `godot` check package and declaration comments, including
  private declarations. The fixture-tested field checker requires comments on production struct
  fields. Review whether the comments explain effects and error contracts. [Go Doc Comments][docs]
- **Correctness and dependencies.** Vet, Staticcheck and `errcheck` cover common errors and
  unchecked assertions. Startup and file errors add context and preserve causes for `errors.Is`.
  `depguard` and Go's resolved import check restrict the release binary to the standard library.
  Development tools have their own module. [Go Code Review Comments][review]
- **Tests.** Use standard-library helpers, named cases, stable comparisons and got/want diagnostics.
  Go tests use signature fixtures with explicit JSON field names. Loopback tests exercise the
  compiled binary and the image. Fuzz targets check that accepted paths resolve to public assets and
  selected encodings are available and acceptable. [Test Comments][testing] · [Fuzzing guide][fuzz]

## Security decisions

- **Signed content.** The origin verifies Discord's Ed25519 proof before looking up assets or
  applying conditional responses. Only the health route accepts unsigned requests. Route tests
  exercise both contracts. [Go security threat model][threat]
- **Input and logs.** The handler serves a fixed embedded inventory, and the HTTP listener bounds
  headers and request time. Request logs record status, duration and byte count without raw paths or
  proof. The log test verifies that request contents stay out of logs. [Go security
  decisions][security]
- **Toolchain and scanning.** The module, doctor, CI and hardened builder share the pinned Go patch.
  The check script verifies module integrity and runs pinned `govulncheck` on source and the static
  Linux AMD64 binary. Review Go patch releases and dependency updates against those pins. [Go
  security best practices][best-practices] · [Go toolchain guide][toolchain]

## Concurrency decisions

- **Shared state.** The server prepares the public key and asset inventory before opening the
  listener. Requests only read that state. The race suite exercises concurrent requests. [Go Memory
  Model][memory] · [Go race detector][race]
- **Lifetime and cancellation.** Startup passes its context to the listener. Shutdown retains
  context values, gives active requests a fresh bounded deadline and joins the serve goroutine.
  Tests check context forwarding, graceful shutdown and deadline errors. `contextcheck` and `noctx`
  run in CI. [Go concurrency review][concurrency] · [Go context guidance][context]

## Local choices

- Use ordinary Go names for private declarations and the formatter's whitespace. Use keyed
  production literals and omit fields whose zero value is intended. Keep standard HTTP parameter
  names and scoped error checks. [Uber naming][uber-names] · [Uber initializers][uber-fields]
- Keep focused tests in their packages for private invariants. Use parallelism where the test is
  checking concurrency. Process and build tests control their own sequence. [Google test
  packages][test-package]
- Scope the subprocess and loopback exceptions to the affected test files and diagnostic codes.
  `nolintlint` requires specific names and explanations for inline suppressions. [Lint
  settings][lint]

## Verification

The baseline review passed the configured linter checks, the race-enabled per-file coverage gate,
both vulnerability scans and the smoke test on a rebuilt Linux AMD64 image. The pinned reference
cache passed offline checksum verification.

[effective]: https://go.dev/doc/effective_go
[google]: https://google.github.io/styleguide/go/guide
[uber]: ../cache/go-uber-style.md
[docs]: https://go.dev/doc/comment
[review]: https://go.dev/wiki/CodeReviewComments
[testing]: https://go.dev/wiki/TestComments
[fuzz]: https://go.dev/doc/security/fuzz/
[threat]: https://go.dev/security/threat-model
[security]: https://go.dev/security/decisions
[best-practices]: https://go.dev/doc/security/best-practices
[toolchain]: https://go.dev/doc/toolchain
[memory]: https://go.dev/ref/mem
[race]: https://go.dev/doc/articles/race_detector
[concurrency]: https://go.dev/wiki/CodeReviewConcurrency
[context]: https://go.dev/blog/context-and-structs
[uber-names]: ../cache/go-uber-global-name.md
[uber-fields]: ../cache/go-uber-struct-field-zero.md
[test-package]: https://google.github.io/styleguide/go/decisions#test-package
[lint]: ../../../activity/server/.golangci.yml
