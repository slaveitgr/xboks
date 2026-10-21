# xboks implementation guide from the Windows reference

Baseline: Microsoft.GamingApp **2610.1001.20.0 x64**, Game Bar **7.326.10141.0 x64**, user-supplied screenshots at **1920 × 1080**, and the current xboks source tree on 2026-10-20. The implementation is based on Xodus Nexus 0.3.9. This guide describes what to build and how to demonstrate it; it does not certify complete reverse engineering, pixel parity, or Windows service compatibility.

## 1. Evidence is a prerequisite for implementation

Use the accompanying [verification matrix](verification-matrix.json) as separate evidence columns, rather than a completion percentage. A decoded instruction, a screenshot, a Linux unit test, and a successful Windows interaction establish different things.

| Evidence class | What it establishes | What it does not establish |
|---|---|---|
| Package indexed | File/header/string/instruction location in a named build | Meaning of every branch or runtime behavior |
| Static evidence | A bounded decoded operand, declaration, import, resource, or method body | A complete call graph, live service schema, or observed UI transition |
| Screenshot observed | Visible geometry, labels, icons, selection, hover, loading, or error state | The result of clicking a control |
| Windows dynamically verified | Recorded action and result in the original build, with prerequisites | Identical behavior in Linux |
| Linux implementation tested | Named test/run against xboks with its environment and scope | Matching Windows pixels or successful real account/game/console use |

No Windows dynamic session is recorded in the current library. Never promote a resource name to a verified navigation flow. The existing static readers index the Hermes bundle; they do not recover all original source semantics.

For each change, record `feature → original evidence → xboks entry point → data source → observed result → open gap`. Preserve version identity when adding evidence. Gaming Services 38.118.9001.0, supplied separately, is **not** the 39.118.16001.0 build shown in the reference About screenshot.

Useful existing reports:

- [Recovered Product ID and game-details navigation payload](product-navigation-trace.md)
- [Menu action guards, destinations and Back handling](menu-behavior-traces.md)
- [Settings state, capability and error behavior](settings-behavior-traces.md)
- [Named PRI resources, qualifiers and Greek labels](pri-resources.md)
- [Native tray XBF controls, styles and visual states](xbf-resources.md)
- [Typed WinMD method/field signatures and enum constants](winmd-signatures.md)
- [Package/bytecode/native dossier](../xbox-reverse-engineering.md)
- [Measured Windows UI specification](../windows-ui-spec.md)
- [Supporting Windows component boundaries](../xbox-supporting-packages.md)
- [GamingApp and Game Bar native contracts](native-contracts.md)
- [Current Settings implementation audit](../settings-parity.md)
- [Remote Play integration boundary](../remote-play.md)
- [Nexus 0.3.9 source integration and validation limits](../nexus-0.3.9-integration.md)

Some older reports describe earlier implementations. For example, the initial Game Bar report describes an in-app guide; current `DesktopGuide` creates a separate desktop window. Check source and dated verification before using a report as current product status.

Use the local searchable library to locate evidence before implementing a guessed control or transition:

```sh
python3 scripts/analysis/xbox-reference-library.py search FocusGroup --limit 5
python3 scripts/analysis/xbox-reference-library.py search IConsoleManager --limit 5
python3 scripts/analysis/xbox-reference-library.py search IUser_PlatformStore --limit 5
```

Preserve each result's source component and identifier. The main package's 39 WinMD files and Game Bar's 10 WinMD files now have decoded method/field signatures, parameter metadata and enum constants as well as type/member indexes. These WinMD declarations contain no managed IL bodies; their native implementations, marshalling and successful runtime calls are not recovered by decoding their metadata.

## 2. Keep three contracts separate

1. **Reference presentation contract:** independently implemented Xbox layout, icon assignment, typography, control states, overlays, navigation, and accessibility. Service absence does not justify moving controls or replacing the original layout with custom cards.
2. **Product data/action contract:** typed catalog, identity, entitlement, install, launch, social, and streaming results. Display only information supported by the relevant source. Do not derive ownership from public catalog text or a Store identity from an Xbox identity.
3. **Linux adapter contract:** Xodus backend, Proton runtime, Secret Service, PipeWire, desktop shortcut/autostart/tray, compositor overlay, and future gaming-session integration. Keep platform implementation details in appropriate Settings/diagnostic surfaces.

Visual cloning must not bypass existing license, package-selection, installation-readiness, deletion, launch, or credential checks. Additional Nexus controls belong inside Settings; they do not need to displace the original reference groups.

## 3. Source/component map

Paths are relative to the repository root.

| Reference surface | Current implementation | Data/action boundary | Required correction or acceptance focus |
|---|---|---|---|
| Shared shell / rail / search / clock | `src/renderer/App.tsx` (`Sidebar`, `GlobalSearch`), `XboxShell.tsx`; `xbox-mode.css`, `xbox-shell.css` | `AppSnapshot`, local route and input state | Exact icon selection, rail/header geometry; search result and back identity |
| Home | `App.tsx` (`HomePage`) | Installed `Game[]`, public `getFeaturedCatalog()` | Reference recent tile plus mosaic; editorial content is not the owned library or an arbitrary public catalog list |
| Game Pass | `XboxShell.tsx` (`GamePassPage`) | Authenticated `getAccountLibrary('gamepass')` | Entitlement list currently differs from reference editorial carousel/collections |
| Store | `App.tsx` (`StorePage`, `StoreProductCard`) | `searchCatalog`, `getFeaturedCatalog`, `getCatalogDetails` | Original loading/loaded/error states, quick links, rows, stable Product ID navigation |
| Product details | `CatalogDetails.tsx`; installed-game `GameDetails.tsx`; respective CSS | Public `GameStoreDetails`; installed `Game`; separate activity/achievements | One consistent reference presentation model; current separate layouts are not a parity proof |
| Library / Play later / history | `App.tsx` (`LibraryPage`, `AccountGames`), `LibraryChrome.tsx`, collection/preferences helpers | `Game[]`, `AccountLibraryPage`, local collections | Card click opens matching detail; filters/scroll and focus return to origin |
| Install queue | `App.tsx` (`DownloadsPage`), `xbox-library.css`, `src/shared/installation-state.ts` | `DownloadTask[]`, install plan and queue IPC | Exact row/menu state; transfer completion distinct from ready installation |
| Profile / notifications / friends flyouts | `XboxShell.tsx` (`ShellFlyout`) | `AuthStatus`, actual download notices; no friends service yet | Anchored opening/closing and selected/focus states; source-backed destinations |
| Nine Settings sections | `SettingsFrame.tsx`, `OriginalSettings.tsx`, `AudioSettings.tsx`, `App.tsx` (`SettingsPage`) | `Settings`, appearance, identity/provider/audio adapters | Original group order and row geometry; Nexus controls below/in an expandable area |
| Icons / fonts | `XboxIcons.tsx`, `xbox-icons.css`, `scripts/ui/extract-original-xbox-ui.py` | Private local reference kit and explicit fallback | No silent generic-icon substitution in visual acceptance captures |
| Fullscreen Experience | `App.tsx` (`XboxFullButton`), `GamepadNavigation.tsx`, `gamepad-navigation.ts` | DOM fullscreen, focus/input lifecycle | Exact **Fullscreen Experience** label; controller behavior tested separately from OS gaming session |
| Desktop Game Bar | `src/main/desktop-guide.ts`, `DesktopGuideApp.tsx`, `GuideOverlay.tsx`, preload desktop-guide bridge | Separate top-level Electron window; snapshot and allowed Linux actions | Win+G across other apps, fullscreen games, displays and compositor; current widget features remain partial |
| Remote Play | `XboxShell.tsx`, `src/main/remote-play.ts` | Isolated official Xbox web client | Original connection/console UI remains incomplete; test with the user's Xbox One X |
| Install / run / credentials | `src/main/index.ts`, backend/runtime/auth/installation modules, `src/shared/types.ts` | Locked Xodus/Nexus backend and runtime recipes | Preserve capability checks and source verification; do not replace with reference-looking fake results |

`src/preload/index.cts` and `LauncherApi` in `src/shared/types.ts` are the renderer boundary. Add a typed capability/result and main-process implementation before exposing a new privileged action; do not put raw process execution or native-service calls into view components.

## 4. Navigation and menu contract

The current `Page` union is `home | gamepass | store | library | downloads | settings`. Product selection, library tabs, dialogs and flyouts are additional state. A page-only history stack loses product identity, source scroll and focus. Refactor toward a typed destination carrying those values, while keeping existing API behavior. The following is a proposed internal model, not a recovered Windows interface:

```ts
type Destination =
  | { kind: 'home' | 'gamepass' | 'store' }
  | { kind: 'catalog-product'; productId: string; market: string }
  | { kind: 'installed-game'; gameId: string }
  | { kind: 'library'; tab: 'games' | 'later' | 'history' | 'queue' }
  | { kind: 'settings'; section: SettingsSection };

type ReturnPoint = {
  destination: Destination;
  scrollTop: number;
  focusKey?: string;
};
```

Every card and menu action needs a stable target. Titles are presentation and must not be the navigation key. Keep display Product ID, selected install Product ID, content ID and installed game ID distinct; bundles may map to another installable product.

| Trigger | Required destination/action | Close/back result |
|---|---|---|
| Home / Game Pass / Store product card, pointer click or controller A | Details for **that Product ID**; begin metadata request | Back restores source route, filter, scroll and card focus |
| Installed library card | Details for **that game ID**, enriched by Store ID when available | Back restores library tab/filter/position |
| Card receives keyboard/controller focus | Focus highlight only | No navigation or metadata page replacement |
| Game overflow | Menu anchored to trigger, clamped within viewport, exact original supported actions | Escape/B closes just the menu; restores trigger focus |
| Queue → View game details | Matching installed-game detail or exact catalog Product ID | Back restores queue row/scroll |
| Queue → Resume | Actual queue resume; supported only for resumable state | Reflect acknowledged state; no invented running progress |
| Queue → Cancel | Existing keep/delete choice and file protection rules | Return to queue; do not delete on menu open |
| Notification overflow → Settings | Notifications Settings section | Closing restores notification/source context |
| Profile → subscriptions | Subscriptions Settings section | Close restores calling view |
| Game Bar → Home/Library/game | Main window shows requested destination; overlay hides | Do not navigate the overlay document to launcher content |
| Escape/B with stacked surfaces | Gallery/confirmation, then menu/dialog/drawer, then page history | One layer per action; no background action triggered |

Concrete gaps found in the present source audit:

- `HomePage` public-product/editorial clicks still call `go('store')` without preserving the selected product.
- `CatalogDetails.openInstalled` currently goes to Library without selecting the matching installed game.
- The queue's non-installed details fallback searches the task title; it should route using `task.productId`.
- Store and installed-game details currently have different view implementations and incomplete sections. A successful metadata fetch alone does not reproduce the reference layout or all original tabs/actions.
- Several profile/friends/guide entries remain unavailable or have broader Settings destinations. Record each exact action before calling the menu complete.

Treat these as an implementation checklist tied to source, not as confirmed original Windows click recordings. Confirm any unknown original action through bounded static tracing and, when available, a Windows interaction trace.

## 5. Data and state contracts

### Public catalog

Existing contract: `CatalogProduct`, `GameStoreDetails`, `CatalogSearchResult` in `src/shared/types.ts`; implementation: `CatalogService` in `src/main/catalog.ts`.

- Public descriptive data: title, publisher, description, artwork, screenshots, categories, release date and offer display fields.
- `getCatalogDetails(productId)` supports a non-installed product; `getGameDetails(gameId)` enriches a known installation by its Store ID.
- Market is part of identity and caching. Locale affects text layout and must be controlled in visual fixtures.
- Supported PC package format is a technical catalog result; it is not ownership or proof the game runs in Proton.
- A public `includedWith` label is merchandising. Authenticated Game Pass access is separate.
- Current fields do not provide full reviews, parental/content descriptors, real friends-playing counts, all accessibility metadata, or video previews. Extend the data contract from verified sources before rendering those values.

Detail state must explicitly handle `loading → loaded`, `loading → empty/unavailable`, and `loading → error → retry`. Product A's response must never overwrite product B after navigation. Artwork failure must retain the reference-shaped slot. Show available metadata independently of install/launch readiness.

### Authenticated data

Existing contract: `AuthStatus`, `GamePassSubscription`, `AccountLibraryPage`, `GameActivity`, `GameAchievements`.

- Stored credentials, a loaded Xbox profile, a verified entitlement and an authenticated session are different states.
- Store account identity must come from a fresh, account-bound backend result accepted by `readStoreIdentity`; current Nexus does not emit that result. Do not duplicate the Xbox account as a connected Store account.
- Subscription product identifiers can support a plan label. They do not prove renewal date, price, payment failure or current billing status.
- Local Play later/history are device-local xboks collections, not a claim of Xbox cloud synchronization.
- Friends, chat, parties, linked third-party accounts and wishlist notifications need their own authenticated providers. Installed-launcher detection does not authenticate a provider.

Use capability-aware results with source/freshness and retry state. Keep unknown distinct from signed out, not entitled, unsupported and transport failure. Changes of account, market, backend or product must invalidate the relevant view state.

### Download, readiness and launch

Existing contract: `InstallPlan`, `DownloadTask`, `Game.installState`, `GameOperation`, plus `installationReadiness`.

1. Resolve the correct PC package and content relationship.
2. Obtain normal account/package authorization through the backend.
3. Report actual transport state/bytes; progress may be indeterminate.
4. Require the backend completion record and successful exit for transport completion.
5. Inspect the matching installation before showing Ready to play. Content completion does not prove the base game ready.
6. Run actual prerequisite/service/runtime preparation. Keep phase and error evidence.
7. A spawned game process is not proof of a rendered playable window or completed cloud-save synchronization.

The current `LaunchExperience` dialog follows actual preparation/error states but is a custom design. Its presence is not visual fidelity to the Windows launch prompt. Future save sync requires real backend events; never animate invented upload/download percentages.

## 6. Original Settings and Nexus placement

Keep these nine reference categories and their measured frame: Account, Application, Subscriptions, Notifications, Install options, Library and extensions, Audio, Accessibility, About. At the reference viewport the modal is **800 × 950**, left/top **560/65**, navigation column **230**. These are screenshot pixels, not a universal Windows DIP specification.

| Category | Original-facing presentation | Linux/Nexus extension placement |
|---|---|---|
| Account | Profile, account links, redeem, linked accounts, privacy, purchase sign-in | Actual sign-in/out/refresh and keyring remediation in account/session area, preserving reference groups |
| Application | Compact mode, battery, startup/tray, offline permissions, developer controls | Linux autostart/tray implementation behind matching controls; future session override contract |
| Subscriptions | Plan/status/billing plus separately sourced connected accounts requested for xboks | Capability-aware identities; no copied failure banner or sample expiration date |
| Notifications | Game Pass/Store checkboxes and Game Bar link | Download notifications in a clearly additional group, below reference content |
| Install options | Location dropdown, desktop-shortcut preference, automatic updates, downloads during gameplay, transfer-speed units | Backend manager, managed Proton, bandwidth/storage and expandable Advanced / Diagnostics |
| Library and extensions | Five observed provider cards in reference order, My apps toggle and digital-license-history link | Native/Flatpak/Wine launcher detection and manual import as Linux adapters; no fake linked status |
| Audio | Devices, voice volume, push-to-talk, suppression, navigation sounds | PipeWire/system controls where applicable; actual party/audio capability separately tracked |
| Accessibility | Reference audio/visual checks and platform links | Persisted motion/background preferences; Linux accessibility destination when implemented |
| About | Versions, device/Insider/link groups | Actual xboks/backend/runtime versions, update/source notices; no fabricated Windows device identity |

Do not append repeated explanatory paragraphs to every unsupported row: this changes the screen's density and geometry. Preserve the row and appropriate disabled state, with concise contextual help outside the reference layout where possible. Disabled appearance must remain truthful; visual reference fixtures may simulate states, while production cannot pretend services are connected.

The complete supplied Install/Library screenshots establish further concrete corrections:

- **36019 — Install options:** default location is a closed dropdown at `(806,232)`, `538 × 32`; the captured value is empty, not evidence that every installation should show an empty path. A desktop-shortcut checkbox is unchecked, automatic updates and downloads/updates during gameplay are checked, and the transfer-speed unit selector shows bits per second. The screenshot does not show the current custom bandwidth/parallel/runtime panels in this original-facing area. Preserve the actual saved Linux location when implementing the dropdown; defaults remain `~/Games/Xboks`.
- **36020 — Library and extensions:** Aggregated library heading, explanatory text and Learn more precede **EA App → Epic Games Store → GOG GALAXY → Steam → Ubisoft Connect PC**. Five provider cards are approximately `528 × 80`, start at `(811,263)` and repeat every 90 pixels; logos are approximately 60 pixels with a right chevron. Installed-game visibility is enabled on all cards; EA and Ubisoft additionally show a disconnected extension. My apps and games begins near y=761, followed by an off Show My apps in library toggle and digital-license-history link/explanation.
- A fixed six-provider list plus a separate universal four-extension list is **not** established by these screenshots. Other names in package resources may be conditional; investigate their conditions rather than adding them to the captured state. The provider chevrons establish navigation affordances, but their subpages and exact click results are not captured.

The original screenshot language is Greek. English-only captures cannot validate text wrapping, width, truncation or exact labels. Record localized labels with their resource/screenshot evidence and provide a Greek visual fixture before signing off these pages.

## 7. Windows boundaries and Linux adapters

| Windows component/declaration | Current Linux path | Work still requiring its own proof |
|---|---|---|
| Xbox Identity Provider / Windows account broker / TCUI | Xodus/Nexus authentication and isolated Electron auth host; system Secret Service | Independent Store identity, privilege-specific UI, exact cancel/error paths |
| Gaming Services package install/license/launch APIs | Locked backend, package plan, queue, manifest inspection, Wine/Xodus Proton | Per-game launches, partial-install semantics, real cloud-save lifecycle |
| GamingServices, GamingServicesNet, gameflt/xvdd | Linux backend/runtime integration | Windows services/drivers are not Linux adapters; copied binaries do not implement this boundary |
| Store account/purchase/URI services | Public catalog and external Microsoft purchase/manage links | Actual billing and purchase callbacks; exact identity-role support |
| Game Bar overlay/app-capture declarations | Parentless `DesktopGuide` window and Linux shortcut/audio/capture adapters | Compositor-wide placement/input, real game/video capture, widgets and social |
| Windows gaming shell / Fullscreen Experience | App fullscreen plus controller navigation | Distribution session entry/exit, focus, global controls and app switching |
| Native Xbox Remote Play | Separate official browser streaming window | Console discovery/wake/stream/input test with a real console; no native-protocol equivalence claimed |

`DesktopGuide` currently uses a transparent, frameless, always-on-top BrowserWindow on the display near the pointer. It has no launcher parent. This establishes the intended desktop surface, not success over every compositor or exclusive fullscreen game. The GNOME Win+G helper binds `--game-bar`; a physical cross-app shortcut test is still required. Ctrl+G in the launcher and a simulated Guide button do not verify Win+G.

The original native metadata supports explicit focus containers/groups, last-focused restoration, press events and regional scroll policy. Use an active-container stack in xboks rather than treating the selected card as controller focus. It also exposes a Remote Play session vocabulary: user login, console enumeration, request states NotStarted/Queued/Launching/Ready/Cancelled/Failed, connected-session lifecycle, reconnect/quality/controller events and a rendering bridge. These are useful adapter states; the metadata does not recover the transport/authentication implementation. Do not reuse a generic spinner as proof those stages actually occurred.

Current guide capture saves the **launcher window**; the audio adapter handles default output volume/mute. Game-window/video capture, microphone/device selection, per-app mixing, network, Bluetooth, power actions, embedded browser and Xbox party/social are not complete.

Use the exact button label **Fullscreen Experience**. App fullscreen/controller mode and a distribution gaming session are separate capabilities. A future session adapter should acknowledge entry/exit and failures, restore the previous desktop session, and define whether desktop startup options are overridden. Do not equate a DOM fullscreen promise with OS session activation.

## 8. Set up the current application

### Source and isolated preview

Use the repository's Node 22 CI baseline and a Linux desktop capable of running Electron. From the repository root:

```sh
npm ci
npm run typecheck
npm test
XODUS_DEMO=1 npm run dev
```

Demo mode uses synthetic account/library fixtures and does not authenticate, install or launch real games. Public Store/artwork requests may still occur. Use a separate profile for automated visual runs; do not overwrite the user's real account state or install paths.

To use original local icon/font references for a private visual comparison, supply the already acquired exact x64 MSIX:

```sh
python3 scripts/ui/extract-original-xbox-ui.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix
```

The output is ignored `public/original-xbox/`. It is a local reference kit, not a redistribution policy or a complete UI implementation. Keep the original packages, extracted assets and private screenshots out of tracked/public artifacts. Builds copy public assets; inspect packaging before sharing a build containing this private kit. A fresh clone without it uses fallbacks, so its icon/font rendering differs and must not receive a visual parity sign-off.

### Real backend, runtime and install location

1. Start without `XODUS_DEMO`. In **Settings → Install options**, check/install the backend matching `assets/backend-source.lock.json`; do not assume the source-version bump updated the installed backend.
2. Check/install the compatible managed Nexus Proton runtime. The manager validates and activates a versioned runtime; Proton is not automatically bundled inside the launcher installer.
3. Set the game installation root to **`~/Games/Xboks`** and save. This is the source default. An existing profile's explicit saved path can override the default; do not move existing games or rewrite their paths silently.
4. In **Settings → Account**, inspect keyring availability, then use the actual Microsoft sign-in flow. Never reset the user's keyring or read credentials merely to produce a visual fixture.
5. Confirm library/entitlement results for that account. Test one licensed supported PC package; record exact game, backend/runtime versions and install/launch outcome.

The launcher state lives under Electron `userData` (`launcher-state.json`; normally `~/.config/xboks/`). The runtime's current default storage remains `~/.local/share/xodus-nexus/runtimes`; it is **not** the game installation root. Keep this distinction when adjusting branding or migration.

For GNOME, the existing helper can register Win+G once the correct installed launcher command is known:

```sh
python3 scripts/desktop/install-gnome-gamebar.py \
  --command '/absolute/path/to/xboks --game-bar'
```

The command must exist and launch this xboks build. The helper preserves other bindings and refuses an existing conflicting Super+G binding. This is GNOME-specific; Wayland/X11 stacking and other desktops need explicit adapters and verification.

### Build and package

```sh
npm run build
npm run dist
```

`build` includes the full test suite. A partial successful `vite build` is not a passing release gate. The last documented 0.3.9 integration run had two AppImage shortcut execution failures also reproduced in pristine upstream, and runtime staging lacked a MinGW cross compiler; see the integration report. Re-run and report current failures rather than hiding them. `dist` writes an AppImage under `release/`; source launchers and development desktop entries are not an installed release.

## 9. Delivery stages and acceptance gates

### Stage A — freeze and index the reference

Record package identity, architecture, hashes, screenshot IDs, locale, viewport and original assets used. Build a surface/action inventory with explicit unknowns. For every decoded relation, retain function/offset/resource provenance privately and publish aggregate descriptions. Gate: reproducible readers and bounded indexes pass; no source-recovery or semantic-completeness claim from counts.

### Stage B — close menu/navigation gaps first

Introduce stable product/game destinations, route return points, and one menu/dialog closing order. Enumerate all visible triggers and supported/unsupported states. Fix the three concrete identity-routing gaps above. Gate: each card and menu action opens the corresponding item, metadata is requested for that ID, stale responses are ignored, Back restores source context, and focus alone never navigates.

### Stage C — reproduce one surface at a time

Use Greek, identical 1920×1080 content viewport, known device scale and a deterministic fixture state. Start with shell and menus, then Home, Library/queue, product detail/Store/Game Pass, Settings, and Guide. Validate normal, selected, hovered, controller-focused, open-menu, loading, empty, signed-out, offline and error states separately. Do not use a loaded reference to sign off a skeleton or an English layout to sign off Greek wrapping.

Gate per surface:

- All reference-visible controls accounted for, with matching shape, location, icon/glyph, font/weight, border/radius and spacing.
- Geometry measured against anchors; private image overlay/difference reviewed, with dynamic artwork/content masks documented.
- Any remaining mismatch has a named reason and a tracked acceptance failure. No broad “looks close” acceptance.
- Equivalent pointer, keyboard and controller path; focus ring separate from selection; modal scroll containment and restoration.
- Additional Nexus controls do not alter the original viewport until the extension area is opened.

### Stage D — wire verified service capabilities

Use typed adapters and account-bound state. Implement public metadata first, then authenticated library/entitlements and supported profile/activity. Treat Store identity/billing/social/cloud sync/Remote Play as separate work items. Gate: each displayed production value/action has a real source; offline and expired/partial results do not become fake success. Record service-dependent gaps as open rather than filling them with sample data.

### Stage E — desktop/game acceptance

Test physical Win+G while the launcher is unfocused, over another app, over a Wine game, in fullscreen, and on each supported compositor/display arrangement. Verify overlay dismissal and return of input to the previous app. Test physical controller D-pad/stick/A/B/LB/RB and available Guide input. For Remote Play, use the Xbox One X with remote features enabled and record account/console discovery, wake, audio/video/input, disconnect and reconnect. Gate: real observations, not window construction tests or website load alone.

### Stage F — distributable release

Run complete required checks, package the actual artifact, verify included assets/licenses, install on a separate Linux profile/machine, and test startup/update/rollback plus one supported install/launch path. Publish exact limitations and evidence. A correct UI, a working backend, and a verified release are three separate gates; none should be inferred from another.

## 10. Completion rule

This library is useful only if it makes missing work visible. Call a bounded surface/action verified when its evidence and acceptance gates are complete. Do not call the whole original app “100% reversed” while computed runtime behavior, service responses, native implementations, platform integration, or unobserved UI states remain unknown. Maintain the unknowns and the build-specific evidence until they are resolved.
