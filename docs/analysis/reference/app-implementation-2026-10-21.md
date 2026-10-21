# xboks implementation verification — 2026-10-21

This dated application change follows the [menu traces](menu-behavior-traces.md), [Settings traces](settings-behavior-traces.md) and [product navigation trace](product-navigation-trace.md). It changes xboks source; the earlier static-analysis/documentation audit remains a separate record. **The original Windows client was not executed, and this is not a 100% parity or real-service acceptance result.**

## Implemented scope

| Surface | Current implementation | Acceptance still open |
|---|---|---|
| Menus and Back | Shared `ReferenceMenu` uses stable action IDs, hidden/disabled/loading states, viewport-bounded anchors, focus without hover activation, dismissal before actions, and Escape/B focus restoration. Window-local, DOM-scoped Back ownership gives the nearest menu/dialog/provider subpage priority. Context-menu input and visible detail-tab LB/RB are routed separately from the main app rail. | All original source/feature-flag states, physical controller behavior and pixel comparisons. |
| Product and queue navigation | Clicks/fetches retain exact Product IDs. Installed products select the matching library game. Return points retain page/query/game/product/view, scroll and originating control. Queue navigation uses Product ID while pause/retry/cancel use operation ID; unsupported prioritization remains disabled. Loading/retry/gallery states are implemented; missing Reviews service data is stated explicitly. | Live catalog/account/market variants, original Reviews/More contracts, real transfer/error/cleanup acceptance. |
| Settings frame and providers | Nine original categories, separate tab focus/selection and nested busy-aware Back. Provider cards follow EA App, Epic Games Store, GOG GALAXY, Steam, Ubisoft Connect PC order. Detection, provider subpages and unavailable license/extension functions stay distinct. Nexus-specific controls are collapsed extension content. | Provider authentication/import, portable Windows extensions, complete Greek visual matching. |
| Application/account settings | Compact mode follows close-social → announce → mode ordering; battery preference is retained while device/compact guards control availability. Separate Xbox/Store account surfaces do not invent a linked Store identity, billing or renewal fields. Autostart/background/tray have separate settings, capability/FSE guards and rollback. OS FSE is only the explicit `XBOKS_FULLSCREEN_EXPERIENCE=1` session signal, distinct from window fullscreen. | Real Store identity/subscriptions/social mutations; physical battery, login/tray/compositor behavior and a distribution FSE adapter. A successfully constructed tray does not establish shell visibility. |
| Installation settings | Original location/shortcut/update/gameplay/unit groups use exact preference patches, normalized saved results and rollback that preserves newer snapshots. The desktop shortcut preference applies only to new ready installs; shortcut failure preserves completed installation. Display units do not change bandwidth limits. Only the exact former default `~/Games/Xodus Nexus` becomes `~/Games/Xboks` for future installs; existing game/download paths and custom roots do not move. | Automatic provider-update and gameplay-download policies remain unavailable/disabled. Real clean-machine installs, shortcut launch and full original geometry acceptance. |
| Desktop guide and packaging | Native Escape reaches renderer-owned scoped Back; Ctrl+G still hides immediately. Guide distinguishes app settings/window fullscreen from OS FSE, guards missing adapters and describes PNG capture as xboks-window capture. D-pad left/right edits discrete sliders while up/down leaves them; async language results and history restoration are bounded to their active route. Linux afterPack uses the actual packager executable name; the wrapper invokes its matching sibling `.bin`, preserving both `xboks` and legacy `xodus-nexus` names. | Physical Win+G above another app/game, fullscreen stacking, complete mixer/microphone/social/browser/video/system services and clean-machine package launch. |

Implementation sources include [ReferenceMenu](../../../src/renderer/ReferenceMenu.tsx), [navigation identity](../../../src/renderer/catalog-navigation.ts), [queue actions](../../../src/renderer/queue-menu.tsx), [OriginalSettings](../../../src/renderer/OriginalSettings.tsx), [InstallSettings](../../../src/renderer/InstallSettings.tsx), [desktop settings](../../../src/main/desktop-settings.ts), [native guide](../../../src/main/desktop-guide.ts) and the [Linux packaging hook](../../../scripts/launcher-fonts-after-pack.cjs).

## Executed verification

- **80 focused main-process tests passed** across desktop guide/settings, state storage, install integration, shortcuts and startup. Electron, provider and child-process boundaries are synthetic; file mutations use disposable profiles/directories. The integration assertions retain simultaneous play/download, cancellation, cleanup and display-blocker checks.
- **49 packaging/bootstrap/font tests passed.** Temporary afterPack outputs execute harmless helper fixtures under both executable names, verify arguments/PID/exit status/modes/bootstrap resources, and retain preload-filtering, IME and font behavior coverage.
- **25/25 actual-App renderer fixture checks passed**, with zero browser errors, blocked requests, forbidden mutations or unstubbed APIs. The run finished `2026-10-21T06:50:50.054Z`; its report is `outputs/reference-ui-2026-10-21/renderer-smoke-report.json`. Twelve 1920×1080 PNGs include nine English states and three Greek Settings states.
- **972/972 application tests passed**, along with renderer/main TypeScript validation and the production Vite/Electron build. The AppImage was built locally and booted successfully in isolated demo profiles both through its default entry and extract-and-run mode; this does not certify a clean-machine install or real services.
- **11 synthetic Electron/React slider checks** verify that D-pad changes commit the new controlled value once, respect native limits and protect modal scopes. **Six loading/error Back assertions** verify Escape closes the guide once even before its overlay is ready. These use fake input/services, not physical hardware.

The Chromium run mounts the actual xboks React app with **explicit sample launcher APIs and generated artwork**. It verifies interaction wiring and sampled layout, including exact-ID fetches, return focus, nested Settings Back, provider order and queue detail navigation. It does not execute Electron/native desktop services, the original Windows app, a real account/wallet, game installation/launch, Xbox One X streaming or an OS overlay. There was no original-versus-xboks pixel acceptance run.

Reproduce the fixture run with `node scripts/ui/reference-app-smoke.mjs outputs/reference-ui-2026-10-21`. Reproduce the focused tests with:

```sh
npx vitest run src/main/desktop-guide.test.ts src/main/desktop-settings.test.ts \
  src/main/store.test.ts src/main/install-integration.test.ts \
  src/main/game-shortcuts.test.ts src/main/launcher-startup.test.ts
npx vitest run src/main/launcher-packaging.test.ts \
  src/main/launcher-bootstrap.test.ts src/main/launcher-fonts.test.ts
npx tsc -p tsconfig.electron.json --noEmit
```

The [verification matrix](verification-matrix.json) and [analysis status](analysis-status.json) retain original runtime and service gaps. The 111 analysis/comparison reader tests documented in the library README concern static readers/provenance; they are separate from these application tests.
