<div align="center">

![xboks — The familiar gaming experience. On Linux.](docs/branding/xboks-banner.svg)

**An independent Linux gaming client pursuing a faithful recreation of the Windows Xbox app.**

[![CI](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml/badge.svg)](https://github.com/slaveitgr/xboks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/launcher-MIT-9bf00b?labelColor=202426)](LICENSE)
[![Stage](https://img.shields.io/badge/stage-early_development-e6b450?labelColor=202426)](#project-status)
[![Platform](https://img.shields.io/badge/platform-Linux-63b3ed?labelColor=202426)](#getting-started)

[The vision](#the-vision) · [Preview](#preview) · [Get started](#getting-started) · [Roadmap](#roadmap) · [Credits](#built-on-open-source)

</div>

> **Development preview.** xboks is not yet a complete recreation of the Windows client. The interface is being rebuilt while the existing Nexus backend integration remains in place. Real account sign-in, installation and game launch have not yet been validated end to end in xboks.

## The vision

Bring the familiar Windows Xbox experience to Linux: the compact navigation rail, artwork-led Home, library filters, game pages, installation queue and settings — with controller, keyboard and mouse navigation.

Our visual reference is **Xbox app 2610.1001.20.0 in Xbox mode**, using screenshots of the running Windows client. The goal is 1:1 visual and interaction fidelity. This is a development target, not a claim that the current build has reached parity.

**xboks owns the interface. Xodus and Xodus Nexus provide the foundation.** Backend health and runtime diagnostics belong in Settings, rather than the main top bar.

## Preview

![xboks Home — current development build with sample library data](docs/screenshots/xboks-home.png)

*Actual xboks development build. The library shown uses upstream sample data; Store highlights are fetched from the live catalog. This preview demonstrates the interface, not successful account authentication or game compatibility.*

The current Home has a compact left rail, centered search, a clock, recent game tiles, large feature cards and a Store discovery section. Recent game cards open the selected library game. Backend and runtime controls are contained in Settings. Remaining Nexus page layouts will be replaced as the reference-driven redesign progresses.

## Project status

| Area | Current state |
| --- | --- |
| Home and navigation | First reference-driven redesign implemented; further visual matching remains |
| Library, Store, queue and game details | Existing Nexus functionality retained; Windows-style redesign pending |
| Microsoft sign-in and entitlement checks | Nexus integration retained; xboks account validation pending |
| Installation and game launch | Existing Nexus backend/runtime paths retained; game-by-game verification required |
| Controller navigation | Existing experimental navigation retained; full-screen focus testing continues |
| Settings | Xbox-style modal with categories; Nexus backend/runtime, storage, download controls and diagnostics integrated; remaining Windows features pending |
| Friends, chat and party | Not implemented in xboks |
| Game Bar-style guide | First in-app overlay implemented: tabs, navigation, PipeWire volume/mute and xboks window screenshots; external-game overlay and video capture pending |
| Cloud gaming and console Remote Play | Not implemented in xboks |

The last local UI validation passed TypeScript, renderer/Electron compilation and **163 renderer/runtime tests**. This is not a passing claim for the full backend suite or CI; the badge above shows the current GitHub workflow result.

## Getting started

Run from source while the first xboks distribution is being prepared. Use the Node/npm toolchain declared in [CI](.github/workflows/ci.yml) (Node 22) and a Linux desktop capable of running Electron.

```sh
git clone https://github.com/slaveitgr/xboks.git
cd xboks
npm ci
npm run dev
```

For a visual preview with the inherited sample account/library:

```sh
XODUS_DEMO=1 npm run dev
```

Demo mode does not sign in to a real account or install/launch real games. It may contact the public Store to fetch catalog data and artwork.

For real use, configure the Nexus backend and shared runtime in Settings, then sign in with your Microsoft account. Owned titles and subscription titles require the appropriate license. Available features and compatibility depend on the backend, runtime, account and game.

### Build and check

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` runs the full test suite before compiling the app. Failures in that suite must be resolved before treating a package as release-ready.

To build a local AppImage after validation:

```sh
npm run dist
```

The packaging configuration writes output to `release/`. Upstream Nexus downloads and installation scripts install **Nexus**, not xboks.

### Fullscreen Experience

The **Fullscreen Experience** button enters fullscreen and activates controller-focused navigation. D-pad/left stick moves focus, A selects, B goes back and LB/RB changes pages or sections in the active Guide/Settings dialog. Mouse and keyboard remain available. A future Linux-distribution adapter can connect this app feature to a gaming session; no system-wide shell replacement is claimed.

### Game Bar-style overlay

Open the guide with **Ctrl+G**, the top-bar guide button, or the controller Guide button when the operating system exposes it. LB/RB switch sections and B/Escape closes the panel. System volume/mute requires PipeWire/WirePlumber (`wpctl`). Captures save the xboks window as PNG in `Pictures/xboks`. This first version does not overlay external games, record video or provide Xbox party/chat.

See the [Game Bar package analysis](docs/analysis/gamebar-7.326.md).

## Roadmap

- [x] Establish the Linux client from the Nexus codebase and preserve its attribution.
- [x] Inspect the original Xbox package and establish a screenshot reference baseline.
- [x] Implement the first Home layout and compact navigation rail.
- [x] Keep backend status out of the main top bar.
- [ ] Match Home spacing, feature cards and navigation against the 1920×1080 references.
- [ ] Rebuild Library, Game Pass browsing, Store, queue and product details.
- [x] Recreate the settings modal and integrate backend/Proton controls.
- [ ] Recreate the profile menu and notification panel.
- [ ] Validate controller focus, back behavior and handheld layouts.
- [ ] Investigate supported Xbox social interfaces and Linux system overlays.
- [ ] Validate authentication, downloads and supported game launch with real accounts.
- [ ] Publish a tested xboks Linux package.

See the [reverse-engineering dossier](docs/analysis/xbox-reverse-engineering.md), [package analysis](docs/analysis/xbox-2610-initial.md) and [UI reconstruction specification](docs/analysis/windows-ui-spec.md) for evidence, measurements and implementation gaps.

## Built on open source

xboks would not exist without the work of these projects and their contributors:

| Project | Contribution |
| --- | --- |
| [Xodus](https://github.com/xodus-gaming/xodus) | The underlying effort to bring Xbox PC game support to Linux, including account, licensing and game-package infrastructure |
| [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus) | The launcher codebase xboks is derived from, its Electron/React foundation, backend integration, library, installation queue and runtime tooling |
| [Xodus Proton](https://github.com/xodus-gaming/Proton) | Part of the compatibility foundation used by the Nexus runtime |
| [Xodus XGameRuntime](https://github.com/xodus-gaming/xgameruntime) | Part of the game runtime foundation used by Nexus |

The original **Xodus Nexus contributors** copyright notice and MIT license are preserved in [LICENSE](LICENSE). Separate backend and runtime components retain their own licenses; the launcher license does not replace them.

xboks is independently maintained. Please report xboks problems in [this repository](https://github.com/slaveitgr/xboks/issues), rather than assuming they are bugs in Xodus or Xodus Nexus.

## Contributing

Useful contributions include screenshot-based UI comparisons, controller navigation fixes, Linux integration and reproducible compatibility reports. Include the xboks revision, Linux distribution, backend/runtime versions and steps to reproduce. Remove credentials and personal identifiers from logs and images before sharing them.

Microsoft package files, extracted proprietary fonts/assets and private reference screenshots are kept outside tracked product files. The UI is implemented independently; the original Windows application is not bundled with xboks.

---

**Independent and unofficial.** xboks is not affiliated with or endorsed by Microsoft, Xbox, Xodus or Xodus Nexus. Xbox and related names belong to their respective owners. A familiar interface does not imply feature parity or universal game compatibility.
