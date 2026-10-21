<div align="center">

![xboks — The familiar gaming experience. On Linux.](docs/branding/xboks-banner.svg)

**A Linux gaming client built toward the familiar Windows Xbox experience.**

[![CI](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml/badge.svg)](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml)
[![Launcher license: MIT](https://img.shields.io/badge/launcher-MIT-9bf00b?labelColor=202426)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux-63b3ed?labelColor=202426)](#get-started)
[![Stage: development](https://img.shields.io/badge/stage-development-e6b450?labelColor=202426)](#what-works-today)

**English · [Ελληνικά](README.el.md)**

[Features](#what-works-today) · [Get started](#get-started) · [Fullscreen Experience](#fullscreen-experience--game-bar) · [Roadmap](#roadmap) · [Credits](#built-on-xodus-and-xodus-nexus)

</div>

xboks brings a reference-driven Xbox-style interface to Linux: Home, Game Pass browsing, a combined library, Store, game pages, installation queue, settings and a desktop guide. It builds on **[Xodus](https://github.com/xodus-gaming/xodus)** and **[Xodus Nexus](https://github.com/domsvoboda/xodus-nexus)**, with Proton/runtime integration for supported games.

> **Independent development project.** The target is faithful visual and interaction parity with the Windows Xbox client. That work is ongoing. xboks is unofficial, and neither complete Windows feature parity nor universal game compatibility is claimed.

## What works today

| Area | Implemented | Current boundary |
| --- | --- | --- |
| Home, Library, Game Pass and Store | Compact navigation, catalog browsing, filters, product-specific game pages, menus and installation queue | Exact visual parity and complete service coverage remain in progress |
| Settings | Nine reference categories, provider pages, Greek/English controls and integrated Nexus/Proton settings | Windows-specific services follow actual Linux capabilities |
| Accounts and games | Microsoft/Nexus account integration, entitlement-aware access, installation and runtime tooling | Download-to-launch acceptance remains game-specific; owning a license is required |
| Friends and presence | Shared app/guide service, player search and presence reported by Xbox | Authenticated friends and inbox reads have been exercised; unavailable presence stays unknown |
| Text conversations | One-to-one inbox/history, explicit Send, account/participant validation and no automatic resend | Sending is fixture-tested; live delivery remains to be verified. Group/system threads are omitted |
| Desktop guide | Separate top-level Game Bar-style window, scoped menus/Back, system audio and xboks-window screenshots | Wayland/global shortcuts, external-game stacking and video capture have separate limits |
| Linux controls | NetworkManager Wi-Fi, BlueZ paired-device controls and capability-gated session/power actions | New pairing/network setup uses desktop settings; disruptive actions require confirmation |
| Audio tools | Explicit local microphone test, device selection, level meter, optional monitoring, mute, push to talk and supported noise suppression | These tools test audio on this PC; **Xbox party voice is not connected** |
| Console Remote Play | Dedicated window for Microsoft's official console web client | Discovery, sign-in and streaming are owned by that site; the native Windows flow and Xbox One X acceptance remain open |

The default game installation directory is **`~/Games/Xboks`**. The old default `~/Games/Xodus Nexus` is migrated in settings; custom locations are preserved and existing game files are not moved automatically.

![xboks Home — development preview with sample library data](docs/screenshots/xboks-home.png)

*Captured development preview with sample library data and public catalog artwork. It illustrates the interface, not game compatibility or completed feature parity.*

### Voice: current work and next step

The local microphone test is available in Sound settings and the guide's Audio panel. Capture starts only after **Start test**. Monitoring starts off; closing or hiding the test releases the microphone. Device/output selection and noise suppression depend on what the desktop and Chromium expose. Test audio is neither recorded nor sent to Xbox, and the test's push-to-talk control is local to its window.

Independent Xbox party voice still needs the consumer-party signaling/authentication adapter, a Linux media worker and cross-device acceptance. The original package's `xCommsUwp` → `PartyWin` dependency and PlayFab identity/network fields are documented in the [party voice analysis](docs/analysis/reference/party-voice.md). Microphone access, a party roster or a successful library build alone is not evidence of working Xbox voice.

## Get started

Use **Node 22**, npm and a Linux desktop that can run Electron. The current backend build targets Linux x86_64.

```sh
git clone https://github.com/slaveitgr/xboks.git
cd xboks
npm ci
npm run dev
```

For a UI preview with sample account/library data:

```sh
XODUS_DEMO=1 npm run dev
```

Demo mode does not sign in, install or launch real games. It can fetch public Store catalog data and artwork.

For real use, configure the Nexus backend and shared runtime in Settings, then sign in through the Account flow. Supported games use the configured Proton/runtime; account privileges, licenses, runtime compatibility and the game itself determine availability. The upstream Nexus installer installs Nexus; xboks is built from this repository.

### Check and package

```sh
npm run typecheck
npm test
npm run build
npm run dist
```

`npm run build` includes type checking and the full launcher test suite. `npm run dist` repeats the build and creates an AppImage under `release/`; it does not publish a GitHub release. Packaging on one host does not establish compatibility with every Linux distribution.

### Optional social companion — backend 0.3.0

Friends/chat use the selected backend when it advertises social support. A packaged build can instead include the **0.3.0 social companion**, without replacing the selected game backend. It reads existing Nexus credentials through a read-only path; expired credentials need the normal Account refresh/sign-in flow.

To build the companion from the pinned source recipe, use the Rust toolchain in [`assets/backend-source.lock.json`](assets/backend-source.lock.json) and the native prerequisites in [`scripts/BACKEND.md`](scripts/BACKEND.md), including `protoc`:

```sh
mkdir -p work outputs
node scripts/build-backend.mjs --work work/social-build --output outputs/social-backend
node scripts/bundle-social-backend.mjs \
  --binary work/social-build/target/release/xodus-cli \
  --license work/social-build/source/LICENSE \
  --source-archive outputs/social-backend/xodus-nexus-backend-0.3.0-linux-x86_64-source.tar.xz
npm run dist
```

Work/output directories must be new; the bundler also refuses to overwrite `assets/social-backend/`. Generated binaries and their corresponding-source archive stay out of Git. The companion is checked by hash and a bounded help probe, never used for login or game execution, and does not enable party voice. The local companion's OpenSSL 4/glibc dependencies and verification scope are recorded in the [social/system integration report](docs/analysis/social-system-integration.md).

## Fullscreen Experience & Game Bar

The **Fullscreen Experience** button enters app fullscreen with controller-focused navigation. D-pad/left stick moves focus, A selects, B goes back and LB/RB switches the active page, tab or guide section. Mouse and keyboard remain available. A distribution gaming session is a separate integration: `XBOKS_FULLSCREEN_EXPERIENCE=1` describes an existing OS session; it does not create or replace the desktop shell.

Open the guide through its app control, **Ctrl+G** in the app, the controller Guide button when exposed by the OS, or the launch argument **`--game-bar`**. For a GNOME **Win+G** binding to an existing AppImage:

```sh
python3 scripts/desktop/install-gnome-gamebar.py \
  --command '/absolute/path/to/xboks.AppImage --game-bar'
```

The helper preserves other bindings and refuses an existing Win+G conflict. The guide runs in its own desktop window; compositor policy, especially on Wayland, determines global-shortcut delivery and placement above other applications/games. Those physical desktop paths still need acceptance testing. System volume uses PipeWire/WirePlumber (`wpctl`); screenshots capture the xboks window, not arbitrary games or the whole desktop.

## Reconstruction and verification

The visual reference is **Windows Xbox app 2610.1001.20.0 in Xbox mode** and the supplied screenshots. The [reference library](docs/analysis/reference/README.md) connects screenshot observations, decoded resources, control/navigation contracts, native metadata and implementation instructions. The [verification matrix](docs/analysis/reference/verification-matrix.json) keeps static evidence, Windows observations and tested Linux behavior distinct.

Start with:

- [Implementation guide](docs/analysis/reference/implementation-guide.md) — components, data contracts and acceptance gates.
- [Application implementation report](docs/analysis/reference/app-implementation-2026-10-21.md) — UI/navigation checks and remaining gaps.
- [Social/system integration](docs/analysis/social-system-integration.md) — real adapters, authenticated read checks, packaging and limits.
- [Xbox party voice](docs/analysis/reference/party-voice.md) — recovered native/signaling evidence and the Linux voice plan.

Synthetic tests, authenticated service checks, physical-controller checks and audible cross-device voice acceptance establish different things. Reverse-engineering counts are not a completion percentage.

## Roadmap

- [x] Establish the Xodus Nexus foundation and preserve upstream attribution.
- [x] Build the original-package/screenshot reference library.
- [x] Implement reference-driven browsing, product pages, menus, queue and nine Settings categories.
- [x] Add scoped controller navigation and the separate desktop guide.
- [x] Integrate Xbox friends/text-chat adapters and Linux system controls.
- [x] Add explicit local audio/device testing with cleanup and local push to talk.
- [ ] Complete screenshot-by-screenshot visual and interaction parity.
- [ ] Verify live text-message delivery and broader account/service cases.
- [ ] Complete independent Xbox party signaling and native Linux voice, including two-way audible acceptance.
- [ ] Validate more games through installation, update, launch and recovery.
- [ ] Validate physical controllers, Wayland/global overlay behavior and clean-machine packages.
- [ ] Integrate distribution-level gaming sessions and publish reproducibly tested releases.

## Built on Xodus and Xodus Nexus

| Project | Foundation |
| --- | --- |
| [Xodus](https://github.com/xodus-gaming/xodus) | Xbox PC account, licensing, package and Linux compatibility infrastructure |
| [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus) | The Electron/React launcher xboks is derived from, backend integration, library, queue and runtime tooling |
| [Xodus Proton](https://github.com/xodus-gaming/Proton) · [Xodus XGameRuntime](https://github.com/xodus-gaming/xgameruntime) | Parts of the configured game compatibility/runtime foundation |
| [OpenXbox](https://github.com/OpenXbox/xbox-webapi-python) | Primary open-source references for the implemented social service contracts |

The original **Xodus Nexus contributors** copyright notice and MIT launcher license remain in [LICENSE](LICENSE). Backend/runtime components retain their own licenses; corresponding source accompanies the optional social companion. Microsoft package binaries and private extracted reference datasets are not committed to this repository.

Contributions are welcome: reproducible UI comparisons, accessibility/controller fixes, Linux integration and game compatibility reports. Include the revision, distribution, backend/runtime versions and reproduction steps. Remove credentials and personal data from shared logs/screenshots. Report xboks issues [here](https://github.com/slaveitgr/xboks/issues).

---

**Unofficial and independently maintained.** xboks is not affiliated with or endorsed by Microsoft, Xbox, Xodus or Xodus Nexus. Xbox and related names belong to their respective owners.
