# External integrations

Keep provider-specific URLs, response types, and behavior in their provider directory. Shared
request and authentication code lives directly under `src/api/`.

- `http.ts`: native fetch with a five-minute timeout and status checks. `requestJson` returns
  `unknown`; validate provider payloads before using them. `HttpError` includes the status and
  endpoint without query strings or credentials. `requestResponse` can explicitly permit a status
  such as 401 when its caller handles that response.
- `bearer-api.ts`: shared bearer headers, validation, and one retry after an unauthorized request.
- `access-token.ts`: validates OAuth token responses, reads existing token files, and shares
  concurrent refreshes. A failed refresh can be retried.
- `../utils/write-file-atomically.ts`: writes state to a temporary file before replacing the
  destination, with private file permissions. Token and sequence files keep their existing paths and
  formats.
- `cached-url.ts`: rewrites supported CDN origins through the configured nginx cache.

## Providers

- `twitch/`: OAuth, Helix requests, clip enrichment, curated clip IDs, and Meilisearch indexing.
  Values use URL encoding; empty batches avoid requests. Meilisearch initialization reuses existing
  indexes and shares concurrent requests. Full Twitch timestamps are preserved.
- `reddit/`: the existing optional client, using shared OAuth handling and a descriptive User-Agent.
  Not enabled at startup.
- `ollama/`: chat/scoring, embedding requests, and Chroma conversation storage. `client.ts` owns
  HTTP calls; embedding requests use `/api/embed` with the configured embedding model.

Chroma initialization is lazy and cached. Message writes are ordered per channel, repeated upserts
reuse their sequence number, and missing sequence state is recovered from stored metadata.
`seqNums.json` keeps its existing channel-to-number format; malformed state is reported rather than
overwritten. Explicit sequence numbers advance the high-water mark for future messages. Existing
valid model-specific collection names are preserved. Changing the embedding model still requires a
deliberate re-indexing decision; vectors from different models must not be mixed.

## Adding or changing a client

Use the existing SDK for SDK-backed services. For direct HTTP integrations, use `requestJson` or
`requestResponse`. Extend `BearerApi` when the provider uses bearer tokens with validation and
401-based renewal. Keep token acquisition and provider-specific response conversion in that
provider's directory.

Test HTTP failures, invalid payloads, concurrency, and retries with stubbed fetch/SDK calls and
temporary token/state files. Keep real services and live `data/` out of routine checks.

## Response validation

Validate unknown JSON with `src/utils/validation.ts` guards and provider-specific parsers before
using domain types. `src/emotes/provider-data.ts` validates both HTTP snapshots and live 7TV
updates. Avoid narrowing assertions for external data.
