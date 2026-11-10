# Commands

| Command            | Action                                                               |
| ------------------ | -------------------------------------------------------------------- |
| `/emote-compose`   | Send one emote or compose up to 32 emotes, custom emoji, and images. |
| `/emote-shortcuts` | Find a short name fragment that resolves to the selected emote.      |
| `/clear-messages`  | Delete earlier unpinned messages in this channel after confirmation. |

`/emote-compose` and `/emote-shortcuts` suggest matching names from enabled sources as you type.
Compositions target 64 px in height by default. Single emotes keep their original size unless
resized. Use `size` for a specific size in pixels, `fullsize` for the 256 px preset, or `stretch` to
fill each overlay's column. In the Activity, open **My emote border** to choose a personal border
for rendered emotes.

Type `+Wave Hat` in a Discord message to compose the named emotes, or `+Wave` to send one. Use
`+Wave Hat:96` to set the composition height to 96 px. The size can be 24 to 256 px. For Discord
image links, put a space before the suffix. Keep the first name directly after the plus.

To enable the shortcut, turn on **Message Content Intent** under **Bot** in the Discord Developer
Portal, set `BOTGE_ENABLE_PREFIX_COMPOSE=true` in `.env`, and restart the bot. The bot needs to be
able to read message history, reply, and attach files in channels where the shortcut is used.

`/clear-messages` requires a server administrator and confirmation within one minute. Botge skips
pinned messages and messages sent after the command.

Compositions use the Activity preview's relative widths and centered overlays. An animated WebP
composition uses the longest source duration as its loop length. Shorter layers can loop within that
duration. Botge adjusts delays of 10 ms or less so browsers play the full animation at its intended
speed. Very dense bursts may lose intermediate frames. Resizing a single animated WebP preserves its
duration and loop count.

Use the [Botge Activity](../activity/README.md) to manage voice and guild emote sets. Open a 7TV
discovery result to add it, or open an individually added emote in the server catalog to remove it.
The operator must enable added 7TV emotes, and the user must have emote management access.

See the [roadmap](ROADMAP.md) for planned commands.
