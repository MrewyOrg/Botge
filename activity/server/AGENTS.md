# Activity server guidance

- Keep the release command and its packages on the Go standard library. Development dependencies
  belong in `tools/go.mod`.
- Run `gofmt` with Go tabs. Document package members and fields, handle errors at their call sites,
  and keep lines within 100 columns when possible.
- Use the [Go reference audit](../../.agents/references/go/AUDIT.md) to review context propagation,
  time bounds, goroutine shutdown, private data, and test diagnostics.
- Keep the public key, asset inventory and clock on the handler. Validate startup configuration
  before listening. Authenticate every content request before path lookup or conditional handling.
- Keep representation files and the stage manifest private. Publish only exact manifest paths and
  preserve the origin's HTML Content Security Policy.
- Use real listeners for wire behavior, synthetic keys for signature tests and `fstest.MapFS` for
  focused handler tests. The [test guide](../../tests/README.md#go-activity-server) owns build,
  fuzzing, and per-file coverage commands. Live Discord testing requires separate authorization.
