# Resource usage

| Resource            | Per-process bound                                              |
| ------------------- | -------------------------------------------------------------- |
| redb cache          | Configured at 8 MiB.                                           |
| Activity requests   | Eight admitted requests, each with a 4 KiB JSON body limit.    |
| Provider snapshots  | 64 cached feeds, each with a 4 MiB response limit.             |
| Provider refreshes  | 16 in flight, shared across requests for the same feed.        |
| 7TV live updates    | One WebSocket for cached 7TV sets, with a 1 MiB message limit. |
| Emote rendering     | One admitted render, four concurrent downloads per render.     |
| Composition files   | 32 inputs, 2 MiB each and 20 MiB combined.                     |
| Rendered attachment | Under 8 MiB.                                                   |

Discord command rendering uses temporary files, a two-second FFprobe timeout per input, and a
15-second FFmpeg timeout. Provider image downloads use nginx when `LOCAL_CACHE_BASE` is set. The
default Compose stack limits Botge to 512 MiB and provides a 32 MiB temporary filesystem for
rendering.

Test the peak on the production-size VM with voice connected while rendering animated emotes. See
the [architecture guide](ARCHITECTURE.md#deployment) for the live release checks.
