# Botge iOS app

A native SwiftUI app for iPhone (iOS 27 or later) that signs in with Discord and offers the
Activity's features: emotes, the Guess game and server settings, plus its own settings. It talks to
one Botge deployment through the bearer-only app API (`/app/v1`).

## Layout

| Path                 | Contents                                                       |
| -------------------- | -------------------------------------------------------------- |
| `project.yml`        | XcodeGen specification; the Xcode project is generated from it |
| `Config/`            | Shared build settings and your local deployment values         |
| `Botge/`             | App target: screens, app model, assets, Info.plist             |
| `BotgeKit/`          | Framework: Discord login, API client, images, preferences      |
| `BotgeLiveActivity/` | Widget extension for the Guess Live Activity                   |
| `BotgeKitTests/`     | Swift Testing unit tests, including `LockdownTests`            |
| `BotgeUITests/`      | XCUITest flows against fixture data                            |
| `TestPlans/`         | Default and Lockdown Mode test plans                           |
| `Tools/`             | Pinned XcodeGen, SwiftFormat and SwiftLint                     |

`Botge.xcodeproj`, `DerivedData/`, `Tools/.build/` and `Tools/bin/` are generated and ignored.

## First run

You need macOS with Xcode 27 (open it once to install the iOS 27 simulator).

1. From the repository root, build the pinned tools once: `npm run setup:ios`.
2. Copy `Config/Botge.local.example.xcconfig` to `Config/Botge.local.xcconfig` and set:
   - `DISCORD_APPLICATION_ID`: your Discord application ID (`APP_ID` in `.env`).
   - `BOTGE_API_BASE_URL`: your Botge API plus `/app/v1`. Write `https:/$()/` instead of `https://`,
     because xcconfig treats `//` as a comment. For a bot on this Mac, use
     `http:/$()/127.0.0.1:3080/app/v1` in the simulator. A real iPhone needs the Mac's LAN address,
     such as `http:/$()/192.168.0.12:3080/app/v1`, with `ACTIVITY_BIND_HOST` set to that address or
     `0.0.0.0` in `.env`. Plain HTTP is allowed only to local network addresses.
   - `BOTGE_BUNDLE_PREFIX`: a reverse-DNS prefix only you use, such as `dev.yourname.botge`.
   - `DEVELOPMENT_TEAM`: your team ID, needed only for a real device (see below).
3. Generate the project: `npm run generate:ios`. Repeat after adding or removing files.
4. Open `ios/Botge.xcodeproj` in Xcode, pick the **Botge** scheme and an iPhone simulator (for
   example iPhone 17e), and press Run (⌘R).

### Server and Discord setup

- Start the bot with `BOTGE_APP_API=true`. The app routes use the same port and tunnel as the
  Activity API.
- In the Discord Developer Portal, under OAuth2, add the redirect
  `discord-<APP_ID>:/authorize/callback` and turn on **Public Client**. The app holds no client
  secret and logs in with PKCE. The Activity's secret-based login keeps working.

### On your iPhone with a free Apple ID

1. In Xcode, open Settings → Accounts and add your Apple ID.
2. Select the **Botge** target → Signing & Capabilities, choose your personal team, and copy its
   team ID into `DEVELOPMENT_TEAM`.
3. Connect the iPhone, turn on Developer Mode (Settings → Privacy & Security), choose it as the run
   destination and press Run. On first launch, trust your developer certificate in Settings →
   General → VPN & Device Management.
4. Free signing expires after seven days: run from Xcode again to renew it.

## Features

- **Emotes:** the server catalog and 7TV Trending and Top, with search, filters, the composer and,
  for emote managers, adding and removing emotes one at a time or in batches.
- **Guess:** create a room and share its code, or join one by code. App rooms (`app-<code>`) are
  separate from Discord Activity rooms. The Emotes tab is hidden during a match, and a Live Activity
  shows the round on the Lock Screen.
- **Server:** voice settings, emote sources and emote managers for administrators, and everyone's
  personal emote border.
- **Settings:** appearance, App Lock, haptics and animation, image cache, legal documents and
  logout.
- **Siri, Spotlight and Shortcuts:** "Search emotes in Botge" asks for a search and opens the Emotes
  tab; "Play Guess in Botge" opens the Guess tab. Both can be assigned to the Action button.

With `npm run run:ios -- --fixtures`, the app uses offline fixture data: one administrator server, a
small catalog, and a scripted one-round Guess room whose answer is `catJAM`.

## Checks

From the repository root:

- `npm run format:ios` formats Swift with SwiftFormat.
- `npm run check:ios` runs SwiftFormat in lint mode and SwiftLint with every rule and `--strict`.
- `npm run test:ios` regenerates the project, runs unit and UI tests on the iPhone 17e simulator and
  requires 90% line coverage in every BotgeKit file.
- `npm run test:ios:lockdown` runs the Lockdown Mode plan; see the
  [test guide](../tests/README.md#lockdown-mode).
- `npm run test:ios:only -- EmoteLinkTests DiscoveryUITests` runs only the named suites or tests
  (`Target/Suite/test` also works) and prints one result line per test.
- `npm run run:ios` builds, installs and launches the app on the iPhone 17e simulator;
  `npm run run:ios -- --fixtures` signs in with the UI-test fixtures and never reaches the network.

The commit hook formats and lints staged Swift files. Xcode also runs SwiftLint on every build.
Conventions and exceptions are in the [Swift references](../.agents/references/swift/README.md).

## Editing

Edit in Xcode: it understands the generated project fully. VS Code with the recommended
`swiftlang.swift-vscode` extension gives highlighting and partial completion. Format on save is off
for Swift there, because that extension formats with Apple's swift-format; use `npm run format:ios`
or let the commit hook format.

## Troubleshooting

- **A new Swift file is not found:** the Xcode project is generated. Run `npm run generate:ios` (the
  check scripts do this for you) after adding, moving or deleting files.
- **The simulator shut down:** parallel UI test runs boot clones and shut the original down.
  `npm run run:ios` boots it again. The clones live in `~/Library/Developer/XCTestDevices`; remove
  them with `xcrun simctl --set testing delete all` when disk space runs low.
- **The simulator is signed out:** a changed `BOTGE_BUNDLE_PREFIX` installs a separate app with its
  own Keychain, so log in again and delete the old app.
- **SwiftFormat and SwiftLint disagree:**
  - SwiftFormat rewrites `count == 0` to `isEmpty`, so custom collections need an `isEmpty`.
  - Write `public nonisolated`; SwiftLint's modifier order is configured to match SwiftFormat.
  - SwiftFormat moves a property attribute with labelled arguments to its own line, which
    `attributes` rejects; drop the labels, as with the bare `@Parameter var search` whose title
    comes from its name.
  - A Sendable class that must be `nonisolated` clashes on `final nonisolated` order; make it an
    `actor` with `nonisolated` members instead, as `FixtureGameSocket` does.
  - SwiftFormat puts the brace of a multi-line `if`/`while` condition on its own line, which
    `opening_brace` rejects. Move the extra conditions into a `guard` inside the loop.
- **"Not available due to missing import":** `MemberImportVisibility` is on, so import the module
  that declares a member you use, such as `CoreGraphics` for `CGImage.width`.
- **A modifier does not exist on `ToolbarItem`:** apply it to the item's content instead, as with
  `.badge`.

## Lockdown Mode

The app avoids everything Lockdown Mode restricts: it has no web views, renders legal documents
natively, decodes images with ImageIO and falls back to a still frame or a placeholder. Discord's
login page in the system sheet is the only web content and can load more slowly in Lockdown Mode.
