# Botge roadmap

The Rust bot covers emote composition, shortcuts, voice, message clearing, and the Discord Activity.
See the [command guide](COMMANDS.md) for the available features.

## Remaining ports

- [ ] **Reminders** — `/remind` and `/reminders`. Decide how scheduling, delivery retries, and
      missed reminders should work before implementing them.
- [ ] **Quotes** — `/quote`, `/quote-list`, and the save and delete context menus.
- [ ] **Saved media** — `/media`, `/media-list`, the save and delete context menus, and the `.`
      message shortcut. Review preview attribution and link expiration.
- [ ] **Twitch clips** — `/clip`. Review link sharing, metadata retention, and embeds before
      choosing a storage or search design.
- [ ] **Translation** — `/translate` and the message context menu. Review provider data handling and
      output attribution.
- [ ] **AI** — `/chatgpt`, the explanation context menu, and optional Ollama replies. Decide whether
      conversation memory belongs in the port and how retention and deletion would work.

## Other features to decide on

- [ ] `/temporary` for expiring replies.
- [ ] `/emoji-hunt` for the server emoji game.
- [ ] `/poe2-stats` for Path of Exile 2 statistics.
- [ ] Tenor previews for saved media, Twitch channel emote sets, and direct provider links.

The Activity replaces server settings and adding and removing emotes. `/emote-compose` handles
single emotes and uses autocomplete for discovery.
