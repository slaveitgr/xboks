<div align="center">

<img src="docs/branding/xboks-logo.png" alt="XBOKS" width="180">

# XBOKS

**A Linux home for your PC games.**

Browse your library, discover games, and bring your desktop into a controller-friendly gaming experience.

[![CI](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml/badge.svg)](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml)
[![Launcher license: MIT](https://img.shields.io/badge/launcher-MIT-9bf00b?labelColor=202426)](LICENSE)
[![Linux x86_64](https://img.shields.io/badge/Linux-x86__64-63b3ed?labelColor=202426)](#install)

**English · [Ελληνικά](README.el.md)**

[Get started](#install) · [Features](#features) · [Screenshots](docs/screenshots/README.md) · [Build](#development) · [Roadmap](#roadmap)

</div>

XBOKS is an independent Linux gaming client for Xbox and Microsoft Store PC games. It combines a library, Store, installation queue, game pages, and an optional desktop Game Bar. **XBOKS Engine** manages supported game packages and the Wine/Proton runtime used to launch them.

The project is in active development and currently provides source; public binary releases have not been published. Available actions depend on your account, license, game package, runtime, and desktop. XBOKS is not affiliated with or supported by Microsoft or Xbox.

![XBOKS Home](docs/screenshots/xboks-home.png)

*Our application, with sample data. The [screenshot gallery](docs/screenshots/README.md) identifies the capture environment and simulated service data. Images do not establish game compatibility.*

<a id="features"></a>
## Features

| Your games | What XBOKS provides |
| --- | --- |
| **Library and Game Pass** | Installed games, imported game folders, account library and available Game Pass entries; search, filters, Play later, and account-scoped recent play. |
| **Store** | Public PC, Top paid, and Add-ons collections, search, pagination, and product-specific details. Prices and subscription labels come from returned catalog data. |
| **Game pages** | Descriptions, screenshots, publisher/categories, available achievements and activity, installation state, and Xbox's Windows handheld classification when supplied. |
| **Installation queue** | Package confirmation, installation location, progress, supported pause/resume, cancellation choices, and local diagnostics. |
| **Launch tools** | Per-game arguments and locale; optional GameMode, MangoHud and Gamescope wrappers; controller compatibility options; desktop and Steam shortcuts. Optional tools are installed separately. |
| **Accounts and social** | Microsoft sign-in, provider-reported profile/membership, friends, presence, player search, and one-to-one text conversations through a compatible social provider. |
| **Cloud Gaming** | In-app Discover, recent games, popular, EA Play and **Stream your own game** collections; search across the cloud catalog, exact game details, controller navigation, filters and paging. Uses the current XBOKS account for cloud authentication and an experimental direct WebRTC player. |
| **Console Remote Play** | Native account-bound console discovery and selection, an explicit Connect action, provisioning and an experimental in-app WebRTC player. Reuses the signed-in XBOKS account. |
| **Settings and Engine** | English/Greek interface, library-provider pages, downloads/storage settings, runtime selection, update checks, and local diagnostic logs. |

The default game folder is **`~/Games/Xboks`**; custom locations are preserved. Account tokens use the system keyring. Wallet creation/unlocking is explicit and handled by your wallet provider. Diagnostic logs remain local unless you choose to share them.

### Game Bar and fullscreen

Open Game Bar with **Ctrl+G**, `xboks --game-bar`, or the controller Guide button when your desktop exposes it. D-pad/left stick moves focus, **A** selects, **B** goes back, and **LB/RB** switches the active page or tab. Mouse and keyboard remain available.

- **Widgets:** Home, friends/chat, audio, Spotify, performance, captures, and settings; choose favorites and keep panels open while Game Bar is visible.
- **Audio:** PipeWire device/application volume and mute, default input/output selection, and a local microphone test with a level meter, optional monitoring, push to talk, and supported noise suppression. Capture starts only when requested.
- **Spotify:** Control the installed desktop player through MPRIS—play/pause, previous/next, and supported seeking—without a Spotify password or Web API token.
- **Performance:** Real CPU/RAM samples and available GPU/VRAM counters. Per-game GameMode defaults off and requests installed `gamemoderun` only for the game; it does not establish an FPS improvement.
- **Desktop controls:** Available Wi-Fi, paired Bluetooth devices, and confirmed session/power actions through Linux services.
- **Captures:** Create and manage screenshots of the XBOKS window. External-game and video capture are not implemented.

**Xbox mode** offers **Restart**, **Start now (no performance changes)**, and **Remain on desktop**. Clock and available battery/power status appear when fullscreen is observed. Opening the dialog does not reboot or change startup settings.

The optional **GNOME Shell 51** extension adds Xbox/Desktop transitions and a native task switcher with actual windows, icons, previews, and the desktop's light/dark preference. **Alt+Tab**, **Alt+Shift+Tab**, and **Super** work within the active mode; **Ctrl+Super+Escape** restores the desktop. This experimental integration keeps the existing desktop session and background applications running. A separate minimal gaming session remains planned.

### Around the app

| Library | Store |
| --- | --- |
| ![XBOKS library](docs/screenshots/xboks-library.png) | ![XBOKS Store](docs/screenshots/xboks-store.png) |
| Game details | Settings |
| ![XBOKS game details](docs/screenshots/xboks-game-details.png) | ![XBOKS settings](docs/screenshots/xboks-settings.png) |
| Game Bar | Fullscreen interface |
| ![XBOKS Game Bar](docs/screenshots/xboks-game-bar.png) | ![XBOKS fullscreen interface](docs/screenshots/xboks-fullscreen-experience.png) |

*The fullscreen image above uses a synthetic integration bridge. The task switcher below is the actual GNOME Shell 51 implementation, captured with real sample windows in a private headless session; it does not establish acceptance in the user's desktop.*

![XBOKS native Fullscreen Experience task switcher](docs/screenshots/xboks-task-switcher.png)

[Light desktop theme](docs/screenshots/xboks-task-switcher-light.png) · [Capture provenance](docs/screenshots/native-switcher-provenance.json)

### Cloud Gaming inside XBOKS

Cloud navigation now stays in the application. Public catalog data provides artwork and descriptions; the authenticated cloud service provides available titles and recent play. A catalog entry alone never establishes ownership. The global search box stays cloud-only on this page and searches the full cloud catalog, rather than only the first loaded cards. Typing is debounced, metadata reads are bounded, and filters apply before pagination. Selecting a card opens its exact game details; only **Play with Cloud** requests a streaming session. The launcher performs same-account cloud sign-in privately, without another browser login or passing credentials to the renderer.

| Discover | Stream your own game |
| --- | --- |
| ![XBOKS Cloud Gaming](docs/screenshots/xboks-cloud-gaming.png) | ![XBOKS Stream your own game](docs/screenshots/xboks-cloud-own-games.png) |

*Actual XBOKS components; account, access and session states in these screenshots are labeled samples. They do not show a live game stream.*

**Play with Cloud** also appears beside installation or local play when the current cloud account explicitly confirms entitlement. Public Store metadata can link an edition to its base game. XBOKS uses that verified link and the current entitlement to select the correct cloud Product ID; names and subscription badges never grant access. Account changes invalidate previous checks and pending responses cannot restore an old account's action.

| Full App: cloud search | Expanded sidebar and game details |
| --- | --- |
| ![Cloud-only search across the full XBOKS catalog](docs/screenshots/xboks-cloud-search-expanded.png) | ![XBOKS expanded sidebar and Cloud game details](docs/screenshots/xboks-cloud-detail-expanded.png) |

[Compact sidebar](docs/screenshots/xboks-cloud-detail-compact.png) · [Fullscreen Experience](docs/screenshots/xboks-cloud-detail-fullscreen.png) · [Full-App capture provenance](docs/screenshots/cloud-layout-provenance.json)

*These captures of the 0.3.25 candidate load the actual full application with cached public Forza artwork. Account rights, catalog membership and fullscreen/battery state are explicitly sampled. Sidebar and detail boundaries are checked in expanded, compact and narrow layouts; the images do not establish pixel parity or live streaming.*

**Cloud settings → Country for cloud sign-in** offers Automatic, Poland, United States, Brazil, Japan and South Korea. Automatic sends no override. The optional compatibility choice follows the login-only technique documented by Better xCloud; it does not create a VPN, route traffic through another country or provide a subscription. Existing-account catalog/MRU reads and the limited live media check below have passed; sustained gameplay remains unverified. End an active cloud session before changing the preference. The same setting is available under **Settings → Application**.

The **0.3.26 full-App check** opened **Forza Horizon 5** through the actual Cloud Library and stream screen, using real signaling and media with the existing account. Decoded video advanced from **17 to 469 frames at 1920×1080 over 15.426 seconds**; the Preparing overlay disappeared, and End session completed its owned server deletion (HTTP 200). Other application sections used sample snapshots. The check used the bundled production **XBOKS Engine 0.3.1** ([build recipe](assets/backend-source.lock.json), [scope and evidence](docs/analysis/cloud-player-interop.md#bounded-live-full-application-acceptance)). The earlier isolated player probe missed the screen polling race corrected in this version. Only neutral input was sent; audible audio, physical-controller input, long sessions, reconnection and other games remain unverified.

### Console Remote Play inside XBOKS

The sidebar's **Remote Play** button opens a native console picker. It reads consoles for the current XBOKS account and keeps provider identifiers and credentials in the main process. **Connect** requests the selected console's home-streaming session; the video player, controller input, fullscreen controls and session menu stay inside the app. No second website login is initiated.

A read-only same-account check successfully authenticated the home-streaming service and found a console in standby. This check did not wake it or create a streaming session.

![XBOKS native console picker](docs/screenshots/xboks-console-remote-play.png)

*Sample console states in the actual XBOKS renderer. End-to-end acceptance with an Xbox One X remains pending. [Protocol and original-package analysis](docs/analysis/native-console-streaming.md).*

The system tray remains available while XBOKS runs, with **Open XBOKS**, **Open Game Bar** and **Quit XBOKS**. Closing to the tray remains a separate preference.

[Full gallery: social, Spotify, audio, and mode entry →](docs/screenshots/README.md)

<a id="install"></a>
## Install

Use a **Linux x86_64** desktop with working graphics drivers and an Electron-compatible environment. Games also require the configured Engine/runtime and their own dependencies.

1. [Build from source](#development). `npm run dist:deb` creates a local DEB; `npm run dist` creates an AppImage. Public downloads will appear on the [releases page](https://github.com/slaveitgr/xboks/releases) when published.
2. On Debian/Ubuntu, install the **DEB** with your package manager; for example, `sudo apt install ./release/FILE.deb`, replacing `FILE.deb` with the generated filename.
3. Alternatively, make the generated **AppImage** executable and run it on a system with a working Chromium sandbox.
4. Open Settings, configure/install the available **XBOKS Engine** and shared runtime, then sign in through Account. Choose a compatible game and confirm its installation location.

The DEB is preferred on Ubuntu systems whose AppArmor policy prevents AppImage startup. Keep Electron sandboxing enabled; see the [Linux installation guide](docs/linux-sandbox-installation.md) for upgrades and old-launcher migration.

Updates use this project's release channel. A compatible asset must be published before it can be downloaded; an unpublished update does not mean the installed Engine is broken. Upgrade DEB installations through their package and AppImages through the supported update flow. See [downloads and provenance](docs/engine-downloads.md).

### Optional desktop integration

Game Bar uses existing device permissions. Its background helper listens to gamepad devices, pauses on lock/suspend, and does not change udev permissions or capture keyboard/mouse input.

For resident Game Bar at future graphical logins, from a source checkout with the native DEB installed:

```sh
python3 scripts/desktop/install-gamebar-service.py \
  --launcher /opt/xboks/xboks --enable
```

Enabling login startup does not start the app immediately. See [resident Game Bar setup](docs/analysis/gamebar-service.md) for startup/removal and portable installs, and the [shortcut helper](scripts/desktop/install-gnome-gamebar.py) for an optional Win+G binding.

The [GNOME extension guide](desktop/gnome/xboks-experience@slaveitgr.github.io/README.md) covers staging, explicit installation, enablement, and removal. Only Shell 51 is targeted. A new or updated extension needs a fresh GNOME login to load its code; installation does not log you out automatically.

Optional integrations use existing services: PipeWire/WirePlumber for audio, MPRIS for Spotify, NetworkManager for Wi-Fi, BlueZ for Bluetooth, and logind for session/power actions. Missing services or permissions leave those controls unavailable.

## Current limits

- **Game support is individual.** A catalog listing, license, successful download, or Windows handheld rating does not establish Linux compatibility. Package format, DRM, anti-cheat, runtime support, and the game can still prevent play.
- **Xbox party voice is not connected.** The microphone tools are local tests. A party roster or working microphone does not establish an Xbox voice session.
- **Social coverage is partial.** Friends/inbox reads have been exercised; live delivery of outgoing text messages still needs acceptance. Group/system conversations and unsupported provider actions remain unavailable.
- **Cloud wishlist is unavailable.** Store promotions do not imply ownership, a personal discount, or wishlist access. Redemption continues only after an explicit choice to open Microsoft's page.
- **Cloud streaming is experimental.** Same-account authentication, catalog/MRU reads and a bounded full-App Forza Horizon 5 check with production XBOKS Engine 0.3.1 have passed. The check verified advancing 1080p video for 15 seconds, removal of the Preparing screen, received audio RTP data and completed session cleanup. It used neutral input only; audible audio, physical-controller input, long sessions, reconnection and other games remain unverified. Unsupported provider stages stop cleanly. Account, region, subscription and game licensing remain provider decisions.
- **Console Remote Play is experimental.** The console picker and direct player replace the default website flow, using a separate home-streaming offering for the existing account. Live Xbox One X video/audio/input acceptance is pending. A separate Wake button is unavailable until an appropriate remote-management adapter exists; Connect is a streaming attempt and can wake a configured console through provisioning. Unsupported transfer-ticket stages stop explicitly.
- **Desktop integration is experimental.** External-game overlay placement/input on Wayland, window restoration across desktop variations, lock/resume, and the real reboot/login path need further live testing. Other GNOME major versions are unsupported.
- **Capture and pinning are limited.** No external-game/video or retrospective capture; kept-open widgets close with Game Bar rather than remaining as independent desktop overlays.

<a id="roadmap"></a>
## Roadmap

- Broader game-by-game install-to-launch validation and clearer compatibility reports.
- Sustained cloud and Xbox One X video/audio/controller acceptance, broader transfer-handshake validation, and verified console remote-management controls.
- Xbox party signaling and voice transport, followed by cross-device testing.
- Additional service-backed Store, social, and account capabilities, including wishlist support.
- Reliable external-game capture and desktop widget pinning.
- More compositor/controller acceptance, multi-monitor recovery, and supported desktop adapters.
- A supervised minimal gaming session, with measured startup, memory, power, and frametime results before performance claims.

These are planned areas, not working-feature promises or release dates.

<a id="development"></a>
## Build and contribute

The launcher uses Electron, React, and TypeScript. CI uses **Node.js 22** and npm.

```sh
git clone https://github.com/slaveitgr/xboks.git
cd xboks
npm ci
npm run dev
```

For a sample-data preview without sign-in or real game operations:

```sh
XBOKS_DEMO=1 npm run dev
```

Demo mode may still read public Store metadata and artwork.

```sh
npm run build               # Type checks, launcher tests, renderer and main build
npm run test:runtime-tools  # Runtime/build helper checks
npm run test:ci-tools       # Release and distribution policy checks
npm run dist:deb            # Build a DEB under release/
npm run dist                # Build an AppImage under release/
```

Packaging builds again and does not publish. Building the launcher does not build or validate every native Engine/runtime component. See the [Engine build guide](scripts/BACKEND.md), [shared runtime guide](scripts/SHARED_RUNTIME.md), and [contribution guide](CONTRIBUTING.md) for additional toolchains and validation.

Use the [issue tracker](https://github.com/slaveitgr/xboks/issues) for reproducible problems and feature requests. Include application/Engine/runtime versions, distribution/desktop, affected game, and redacted diagnostics. Never post account tokens or private wallet data.

## License and notices

The launcher source is [MIT licensed](LICENSE). Included components retain their own licenses and source requirements. See [Third-party notices](THIRD_PARTY_NOTICES.md) for attribution, component licenses, and corresponding-source information.
