# Go references

Reviewed 2026-11-21 for the Go Activity origin. The [audit](AUDIT.md) maps the guides to the
server's checks, review questions, and local exceptions. The [manifest](../sources.json) pins every
source and its SHA-256. Run `python3 .agents/scripts/cache_references.py` to populate the ignored
cache, or add `--check` to verify the cached bytes offline. On refresh, review changes that affect
the origin or its tooling and update the audit where they change a decision.

## Source inventory

- [Go website](https://github.com/golang/website/tree/0eef789c9f9a7cc074eab1b3fb2d96baea282546).
  `0eef789c9f9a`. Effective Go, Doc Comments, and the security guidance listed below.

- [Go language repository][go-language]. `7b2881024c95`. The Go 1.27.4 memory model.

- [Go wiki](https://github.com/golang/wiki/tree/fe2268bb04c953cd65bcae752e978912f5cbddaa).
  `fe2268bb04c9`. Review, testing, concurrency and comment guides.

- [Google Go Style][google-go]. `8bdadbb0732b`. Overview, Guide, Decisions, Best Practices.

- [Uber Go Style](https://github.com/uber-go/guide/tree/1d60a91aa5e87d443002e23c21903c49489dbde5).
  `1d60a91aa5e8`. Complete English guide, source table of contents, preface and every chapter file.

The Go materials include [Effective Go](../cache/go-effective.html),
[Doc Comments](../cache/go-doc-comments.md), and the [Memory Model](../cache/go-memory-model.html).
The [security landing page](../cache/go-security.md) and
[best practices](../cache/go-security-best-practices.md) are accompanied by these subguides.

- Vulnerability management [overview](../cache/go-vulnerability-management.md),
  [database](../cache/go-vulnerability-database.md),
  [CLI reference](../cache/go-vulncheck-command.go),
  [CLI tutorial](../cache/go-vulncheck-tutorial.md),
  [editor guidance](../cache/go-vulnerability-editor.md) and
  [editor tutorial](../cache/go-vulncheck-ide.md).
- [Security policy](../cache/go-security-policy.md),
  [threat model](../cache/go-security-threat-model.md),
  [advisory criteria](../cache/go-security-decisions.md),
  [validated cryptography](../cache/go-security-fips140.md),
  [advisory authority](../cache/go-security-vuln-cna.md), and
  [database service](../cache/go-security-vuln-database.md).
- [Fuzzing guide](../cache/go-fuzz.md), [technical details](../cache/go-fuzz-technical.md), and
  [tutorial](../cache/go-fuzz-tutorial.md).
- [Race detector](../cache/go-race-detector.html), [Go installation](../cache/go-install.html),
  [toolchain selection](../cache/go-toolchain.md), and the
  [release policy](../cache/go-release-history.html).
- [Code Review Comments](../cache/go-wiki-CodeReviewComments.md),
  [Test Comments](../cache/go-wiki-TestComments.md),
  [table-driven tests](../cache/go-wiki-TableDrivenTests.md),
  [concurrency review](../cache/go-wiki-CodeReviewConcurrency.md),
  [common mistakes](../cache/go-wiki-CommonMistakes.md),
  [comment directives](../cache/go-wiki-Comments.md),
  [testable examples](../cache/go-testable-examples.md), and
  [context arguments](../cache/go-context-and-structs.md).

The complete public Google text is in the [overview](../cache/go-google-index.md),
[Guide](../cache/go-google-guide.md), [Decisions](../cache/go-google-decisions.md), and
[Best Practices](../cache/go-google-best-practices.md). Those sources contain no separate include
fragments. The overview's Go Tips and unit-testing resources point to placeholders at this revision.

Uber's [compiled guide](../cache/go-uber-style.md) preserves section anchors. Its [pinned source
inventory][uber-sources] lists each chapter in build order. The cache stores each `src/<filename>`
as `go-uber-<filename>`, including [the summary](../cache/go-uber-SUMMARY.md) and
[the preface](../cache/go-uber-preface.txt).

## Licenses

The Go website and wiki publish their text under [CC BY 4.0](../cache/GO-CC-BY-4.0.txt) and code
under the [Go BSD license](../cache/GO-BSD-LICENSE.txt). Google Style is
[CC BY 3.0](../cache/GO-GOOGLE-LICENSE.txt). Uber's guide is
[Apache-2.0](../cache/GO-UBER-LICENSE.txt). Snapshots preserve the upstream bytes.

[go-language]: https://github.com/golang/go/tree/7b2881024c95a11ddb86663a616340aa3a88b67f
[google-go]: https://github.com/google/styleguide/tree/8bdadbb0732b387aaa26f553dd9033484d1a2071/go
[uber-sources]:
  https://github.com/uber-go/guide/blob/1d60a91aa5e87d443002e23c21903c49489dbde5/src/SUMMARY.md
