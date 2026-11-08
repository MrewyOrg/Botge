# Commands

## Emotes

| Command            | Action                                                  |
| ------------------ | ------------------------------------------------------- |
| `/emote`           | Send an emote by name, with an optional size.           |
| `/emote-search`    | Browse emotes and filter by name, provider, or type.    |
| `/emote-compose`   | Combine emotes, emojis, and images in a row or overlay. |
| `/emote-add`       | Add a 7TV emote to the server's bot catalog.            |
| `/emote-shortcuts` | Find the shortest text that uniquely matches an emote.  |

## Saved content and clips

| Command       | Action                                          |
| ------------- | ----------------------------------------------- |
| `/clip`       | Search Twitch clips by title, creator, or game. |
| `/media`      | Send saved media by name.                       |
| `/media-list` | Browse, rename, and delete saved media.         |
| `/quote`      | Send a saved quote by name.                     |
| `/quote-list` | Browse, rename, and delete saved quotes.        |

Use the message context menus **Save Media**, **Delete Saved Media**, **Save Quote**, and **Delete
Saved Quote** to manage saved content from a message.

## Reminders and other tools

| Command           | Action                                                          |
| ----------------- | --------------------------------------------------------------- |
| `/remind`         | Set a reminder here; days, hours, and minutes add together.     |
| `/reminders`      | Browse server reminders or filter to your own.                  |
| `/temporary`      | Send text or an attachment that disappears after 0–600 seconds. |
| `/chatgpt`        | Ask ChatGPT a question or analyze an image URL.                 |
| `/translate`      | Translate text into English.                                    |
| `/emoji-hunt`     | Find a server emoji hidden in a grid of spoilers.               |
| `/poe2-stats`     | Show Path of Exile 2 Steam player counts and reviews.           |
| `/settings`       | Configure server settings and personal bot preferences.         |
| `/clear-messages` | Delete earlier channel messages after confirmation.             |

The message context menus **Explain with ChatGPT** and **Translate to English** work on a selected
message. Commands retain their existing permissions and service requirements.

## Renamed commands

| Previous command            | Current command    |
| --------------------------- | ------------------ |
| `/emotes`                   | `/emote-compose`   |
| `/emotelist`                | `/emote-search`    |
| `/addemote`                 | `/emote-add`       |
| `/shortestuniquesubstrings` | `/emote-shortcuts` |
| `/pingme`                   | `/remind`          |
| `/pinglist`                 | `/reminders`       |
| `/medialist`                | `/media-list`      |
| `/quotelist`                | `/quote-list`      |
| `/transient`                | `/temporary`       |
| `/findtheemoji`             | `/emoji-hunt`      |
| `/poe2`                     | `/poe2-stats`      |
| `/clear`                    | `/clear-messages`  |

Command lists in `botge.config.json` accept old names as aliases; new configurations should use
current names. Including both aliases is rejected as a duplicate. An empty list disables that
command category. The next startup registers only current names with Discord.
