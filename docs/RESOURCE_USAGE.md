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
| Decoded inputs      | 4 Mi pixels per image; 16 Mi combined.                         |
| Rendered attachment | At most 20 MiB.                                                |

Discord command rendering uses temporary files, a five-second FFprobe timeout per input, and a
25-second FFmpeg budget within a 40-second overall command deadline. Provider image downloads use
nginx when `LOCAL_CACHE_BASE` is set. The default Compose stack limits Botge to 512 MiB and provides
a 64 MiB temporary filesystem for rendering. Aggregate pixel budgets reject expensive sources before
FFmpeg encoding; these budgets reduce memory pressure but do not guarantee a particular peak memory
usage. Source cycles are limited to 256 Mi frame-pixels combined. Slash replies also enforce
Discord's reported upload limit. Image dimensions are counted before scaling, and frame-pixels sum
each source's canvas area multiplied by its packet count.

Test the peak on the production-size VM with voice connected while rendering animated emotes. See
the [architecture guide](ARCHITECTURE.md#deployment) for the live release checks.
