# Resource usage

Rust uses mimalloc on native builds; Miri uses the system allocator because it cannot interpret the
allocator's C implementation. In synthetic ARM64 DHI/musl benchmarks, mimalloc reduced median
catalog/autocomplete/shortcut times by 30–41%, while peak benchmark-process RSS rose from about 4
MiB to 11 MiB. These are microbenchmarks, not a guarantee of production throughput or peak memory.
FFmpeg's separate process is unaffected by Rust's allocator selection.

Catalog requests retain immutable provider snapshots instead of cloning every cached record.
In-flight requests keep their prior snapshot when a provider refresh replaces the cache entry. With
1,000 synthetic records and mimalloc, retaining snapshots reduced the median catalog request
benchmark from 523 to 461 microseconds (12%, three ARM64 Linux/musl runs). Callgrind identifies URL
parsing/normalization as a remaining CPU cost; page-based Massif and allocator statistics also cover
the benchmark process. These profiles include fixture setup and do not model live traffic. The
measured authentication, command and catalog futures were 1,296, 6,552 and 392 bytes respectively;
tests enforce budgets so future growth requires review.

## Cache layout assessment

The current cache stores each feed in a contiguous `Arc<[Emote]>`; catalog views retain those owners
and borrow records. There is no per-record `Arc` chain to remove. The URL cache has at most 64
entries and evicts by expiry; lock sharding or a different eviction structure needs contention
measurements before adding synchronization complexity.

The remaining candidates are narrower than a complete cache rewrite:

- Precompute validated browser image paths when publishing snapshots if URL parsing still dominates
  representative profiles. Guild additions and 7TV updates must use the same validation path. Keep
  name precedence and compose-token eligibility request-specific across all selected feeds.
- Separate frequently read names, IDs and flags from rendering variants and tags only if cache-miss
  and allocation profiles show a benefit. Existing Callgrind artifacts record instruction counts
  (`Ir`), not cache misses, so they do not establish a cache-locality problem.
- Consider boxed immutable strings/collections in a snapshot-specific type if retained allocations
  dominate. `Emote` also represents mutable, persisted additions; changing it globally affects
  construction, updates and serialization. Measure the conversion and any duplicated derived data.

Keep the current layout until a candidate improves repeated native measurements without unacceptable
retained-memory growth. The default hashers remain appropriate for externally influenced keys.

## Native AMD64 validation

Production AMD64 latency and peak memory remain unverified. Local ARM64 results and emulated AMD64
timings cannot close that gap. Use an existing native AMD64 test host with the production CPU/memory
limits, dated Rust toolchain, musl target, DHI images and FFmpeg version. Record the source
fingerprint, CPU model, target, allocator and compiler flags; compare changes on the same host and
configuration.

The existing helper runs synthetic benchmarks without starting the bot:

```sh
python3 .agents/scripts/compare_benchmarks.py record /tmp/botge-before.json 3
# After the candidate change, on the same machine and configuration:
python3 .agents/scripts/compare_benchmarks.py record /tmp/botge-after.json 3
python3 .agents/scripts/compare_benchmarks.py compare /tmp/botge-before.json /tmp/botge-after.json
```

Set up the musl target and linker in that test environment before recording. The helper uses Cargo's
configured target; it does not select the production target or reproduce container limits itself.
Benchmark-process peak RSS includes fixture setup and is separate from bot/container peak memory.
Collect CPU time, allocation profiles, cache misses and peak RSS alongside wall-clock medians.

For runtime validation, use a separate Discord test application and explicit live-test
authorization. Measure idle and warm catalogs, concurrent cache misses/refreshes, 7TV snapshot
replacement, and voice connected while rendering animated emotes. Record request latency
distributions, process RSS and container/cgroup peak memory, including FFmpeg; check failures and
reconnect recovery under the 512 MiB limit. A microbenchmark improvement alone does not establish
runtime memory headroom.

## Runtime limits

| Resource            | Per-process bound                                                  |
| ------------------- | ------------------------------------------------------------------ |
| redb cache          | Configured at 8 MiB.                                               |
| Activity requests   | Eight admitted requests, at most two per credential; 4 KiB bodies. |
| Provider snapshots  | 64 cached feeds, each with a 4 MiB response limit.                 |
| Provider refreshes  | 16 in flight, shared across requests for the same feed.            |
| 7TV live updates    | One WebSocket for cached 7TV sets, with a 1 MiB message limit.     |
| Emote rendering     | Five admitted renders, four concurrent downloads per render.       |
| Composition files   | 32 inputs, 2 MiB each and 20 MiB combined.                         |
| Decoded inputs      | 4 Mi pixels per image; 16 Mi combined.                             |
| Rendered attachment | At most 20 MiB.                                                    |

Discord command rendering uses temporary files, a five-second FFprobe timeout per input, and a
25-second FFmpeg budget within a 40-second overall command deadline. Provider image downloads use
nginx when `LOCAL_CACHE_BASE` is set. The default Compose stack limits Botge to 512 MiB and provides
a 128 MiB temporary filesystem for rendering. A typical composition stages well under 1 MiB, and a
two-emote animated render peaked at about 22 MiB RSS for FFmpeg locally. Five concurrent worst-case
compositions (20 MiB inputs plus a 20 MiB attachment each) exceed the tmpfs; the excess renders fail
with an error instead of affecting the bot. Aggregate pixel budgets reject expensive sources before
FFmpeg encoding; these budgets reduce memory pressure but do not guarantee a particular peak memory
usage. Source cycles are limited to 256 Mi frame-pixels combined. Slash replies also enforce
Discord's reported upload limit. Image dimensions are counted before scaling, and frame-pixels sum
each source's canvas area multiplied by its packet count.

Test the peak on the production-size VM with voice connected while rendering animated emotes. See
the [test guide](../tests/README.md#live-discord-testing) for the live release checks.
