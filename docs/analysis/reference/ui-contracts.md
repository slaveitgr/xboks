# Windows Xbox UI reference contracts

Pinned reference: **Microsoft.GamingApp 2610.1001.20.0 x64**, Greek Xbox-mode screenshots at **1920 × 1080**; **Microsoft.XboxGamingOverlay 7.326.10141.0** for the guide. This is a reconstruction library of visible states, controls and explicit static references. It is not recovered original source, a complete dynamic call graph or a claim of 100% behavior recovery.

The accompanying [ui-actions.json](ui-actions.json) contains **233 control/action records** and **34 screenshot fingerprints**. All nine Settings category content panes have a screenshot reference, including the recovered `36020` and `36019` files. **Zero original Windows actions have been runtime-verified.** A screenshot proves that a control/state is visible, not what happened after activating it. The machine-readable registry separates control evidence from transition evidence for that reason.

## Evidence conventions

| ID | Meaning | What it can establish |
| --- | --- | --- |
| `S36019` | User-supplied screenshot, identified by original numeric name and SHA-256 in JSON | Visible position, icon, label, disabled/selected/focus/loading state at one moment |
| `F62778` | Function ID in `work/reference/hermes96-code-index.json` for the pinned package | A bounded function's name and explicit indexed string/function operands |
| `K38802` | String ID in `work/reference/hermes96-decoded.json` | Exact short symbol/key in this build; not a proof of visibility or reachability |
| `GB-manifest` | `work/reference/gamebar-AppxManifest.xml` | Separate Game Bar entry point/overlay-hosting declaration |

`observed` means pixels; `static` means package evidence; `inferred` means an interpretation requiring runtime confirmation; `unverified` means insufficient evidence. Numeric IDs are build-specific. The local indexes are reproducible analysis artifacts, not a public original-code dump. Screenshot filenames/checksums can be shared without reproducing profile photos, contact lists or device identifiers. Keep original images, Microsoft binaries, fonts and raw indexes in ignored reference storage.

Older reports contain historical implementation descriptions and may say the guide is only in-app or that original Install/Library Settings screenshots are unavailable. These contracts describe the original references and explicitly supersede those screenshot-coverage statements; they do not audit the latest xboks runtime.

## Surface and ownership inventory

| Surface | References | Visible structure/state | Unobserved behavior |
| --- | --- | --- | --- |
| Shared application shell | S36010, S35990–S35996 | 68 px rail; centered search; clock/system region; back on secondary screens | Search result states, navigation stack policy, expanded/noncompact layout |
| Home | S36010 | Recent primary tile plus 2×2 mosaic; editorial feature grid; lower recent additions | Activation policy of every recent/editorial card, carousel timing, offline states |
| Game Pass | S35990 | Discovery banner, clipped carousel, pagination/pause, shortcut row, products | Personalized/market/entitlement variants |
| Store | S35992, S35993 | Three feature skeletons while loading; a loaded central feature behind social drawer; galleries/shortcuts | Complete unobscured loaded Store and all shortcut destinations |
| Library | S35991 | Four tabs, filter/sort pills, installed chip, count/add control, installed card | Open filters, full menu variants, empty/signed-out/error content |
| Install queue | S35994, S35995 | Failed active download, progress, section collapse, discovered content, tooltip and overflow | Pause/resume results, cancellation confirmation, all item-type states |
| Product details | S35996 | Game hero/actions, installation error, metadata strip, lower tabs and skeletons | Full lower content, Reviews/More bodies, expanded product overflow |
| Profile menu | S35997 | Nine anchored entries | Results of profile/support/feedback/offline/sign-out activation |
| Notifications | S36011, S36012, S36013 | App drawer, unread toggle, type-specific rows, two-item overflow, Settings pane | Notification navigation/read persistence and service delivery |
| App social drawer | S35993 | Search/actions, tabs, party action, requests, grouped friends | Player cards, chats, party lifecycle, account errors |
| Settings dialog | S36015, S36017, S36016, S36013, S36019, S36020, S35987, S35988, S36014 | All nine category panes | Expanded pickers, confirmation dialogs, all feature-flight variants |
| Console instruction dialog | S36009 | Centered account avatar and instruction to turn on console/sign in; Close | Console picker, wake/pair/connect, streaming and error sequence |
| Guide/Game Bar | S35998–S36005, S36000, S35999 | Separate tab strip and left panels: Home, Settings, Edge, social, audio, capture | Desktop stacking/focus, physical Win+G delivery, full capture/social/system behavior |
| Windows shell | S36006–S36008 | Xbox-mode task switcher and desktop-switch warning | Full Windows shell implementation; distinct from Xbox app routing |

## Geometry, assets and state matching

Measurements are screenshot pixels, not confirmed Windows device-independent units. At the reference viewport the Settings dialog is approximately **x560, y65, w800, h950**, split at x790 into a **230 px** category rail and content. Content begins x806 with right edge near x1344. Selected category gray fill and white controller-focus outline are independent: S35989 shows focus on Accessibility while About remains selected; S36018 similarly shows Application focus with Notifications content. Do not derive selected pane from hover/focus alone.

Shell anchors: rail x0–67, primary content x188, search approximately x744/y32/w500/h32. Home recent tile x188/y163/w184/h184; featured region starts x188/y446 with approximately 629×354, 629×354 and two stacked 314×167 tiles, 20 px gaps. The bottom black collection container starts about x156/y848. Library/queue reuse one tab strip. Queue active row is about 102 px high, beginning y305 in S35994.

Exact fonts, glyphs, line height, stroke weight, hover/pressed/focus states and image aspect ratios require independent checks against the selected screenshot. An approximate Lucide icon, a text initial for a provider logo, the wrong Edge brand mark or a changed row order is a visual mismatch even if the destination works. Theme assets already extracted locally may help comparison; their availability on a developer machine is not proof that a fresh distribution contains them.

For deterministic visual fixtures, preserve product/account roles and layout while replacing private user content with synthetic fixtures. Never report a screenshot-level metric over a page containing different live editorial art as a whole-screen parity score. Compare stable geometry and matching UI states separately from dynamic artwork/data. A fixture is explicitly a fixture, not a claim about the user's entitlement or friends.

## Product selection, details and menu contracts

This is the highest-priority behavior gap reported by the user. Product selection must preserve the selected item, load its actual information and expose actions appropriate to its state. It must not resolve every item into the same generic launch dialog.

### Direct package evidence

| Evidence | Direct indexed references | Supported conclusion |
| --- | --- | --- |
| F10548 | `NavigationRoute`, `/library`, `/gamepass`, `/store`, `/store/gamedetails`, `/store/gamedetails/postinstall`, `/store/subscriptiondetails` | Distinct route vocabulary exists; it is not one generic page |
| F21824 `gameDetails` | `NavigationRoute`, `StoreGameDetailsRoute`, `push`, `pathname`, `search`, attribution | A shared game-details navigation action exists; complete argument/state semantics require data-flow verification |
| F53004 → F53005 `useNavigateToGameDetailsCallback` | `navigationActions`, `gameDetails`, `StoreGameDetailsRoute`, `ViewGameDetails` | Explicit catalog-to-details callback family |
| F64024 → F64025 `useViewGameDetailsItem` | K38802 `MyGameListItem_ContextMenu_ViewGameDetails`, then `navigationActions.gameDetails` | Library/context-menu details action is distinct from primary activation |
| F64100 → F64101 `useViewGameOperationDetails` | Same details label/action, install queue parent/action names | Operation-row View details targets product detail; it is not equivalent to resume/cancel |
| F57124 `useProductActionCategory` | Game, subscription, DLC, bundle, third-party, MRU, cloud, offline, loading; item ID/category, catalog selectors and feature gates | Product actions are state/type dependent; copying one universal menu is incorrect |
| F62778 `StoreGameDetailsScreenBody` | `productId`, overview data, Details/Reviews/More, extension check, friends who play | Product detail body has richer data/sections than install/launch metadata |
| F62779 `StoreGameDetailsScreenContent` | CurrentProductProvider, loading announcement, sticky header, persisted scroll, outage and installed selectors | Scroll/header/loading/platform state is part of the screen contract |
| F62791 `StoreGameDetailsScreenBodyError` | Invalid ID, wrong-turn/permission/generic errors | Loading failure must retain a meaningful error surface; no silent fallback to unrelated product |
| F64107 `useInstallOperationDetails` | Installing, Downloading, Paused, Queued, Error; view error/details, resume, pause, prioritize | Operation controls are conditional, not fixed menu text |

These are explicit operand references, not proof of all branches or callback reachability. `/store/gamedetails` is verified route vocabulary. The later [product navigation trace](product-navigation-trace.md) recovers the payload object and caller/module relationships; the imported query-string serializer and runtime dispatch are still unverified.

### Required xboks data boundaries

These are implementation requirements derived from the evidence and user request, not copied original type definitions:

1. **Catalog identity**: stable selected `productId`, market/language, route source and selected tab. Fetch catalog title, description, art/media, age/content information, offers/requirements and supported sections by this identity.
2. **Local installation identity**: game/install ID, catalog mapping where available, verified readiness, active operation and actual launch capability. A local shortcut may have no catalog product.
3. **Account/entitlement state**: gaming identity, separate Store purchasing identity, ownership/subscription and access. Metadata discovery is not proof of ownership.
4. **Editorial target**: product, collection, external action or promotional target. Artwork/title are insufficient to infer where a feature tile navigates.
5. **Platform capability**: native/Proton game launch, desktop overlay, capture, audio and session operations. A visible Windows control does not supply the Linux implementation.

| Entry point | Details contract | Primary activation caveat |
| --- | --- | --- |
| Store/Game Pass catalog product | Resolve selected catalog identity and open shared product details | Editorial/subscription/DLC cards can have different target classes |
| Home catalog recommendation | Same product identity/details flow | Recent-play tiles are a separate action family; their click-to-launch policy remains unverified |
| Library View game details | Use the installed item's catalog mapping and shared details flow | Installed card primary action may launch, show local detail or differ by source; no runtime trace proves one universal policy |
| Queue View game details | Use the operation's product mapping, retain active/error state | Resume/cancel affects that operation; it must not replace View details |
| Third-party/manual local app | Preserve local identity; expose only metadata/actions that can be resolved | Do not force an unknown catalog ID or present fabricated Xbox metadata |

S35996 is a **partially loaded error-state detail page**, not a complete loaded detail reference. It shows a left game title/description, friend/Play Anywhere annotations, operation progress button, subscription action, disabled availability button, wishlist, saved-list and overflow icons; right hero and six thumbnail placeholders; full-width age/content strip; Details/Reviews/More tabs; lower content skeletons. Exact metadata fields are product-dependent. No friend count, badge, plan or offer should be copied from this account's screenshot into live UI.

### Action acceptance requirements

Every record in `ui-actions.json` is an audit item, not a passing test. For product routing, test at least: catalog card → matching title/detail; a second product while first request is pending; loading → loaded; failed fetch → retry; library View details; queue View details without mutation; installed/uninstalled/subscription/DLC/third-party categories; Back restoring originating page, selection and scroll; keyboard/controller focus distinct from activation. The app must never launch on focus alone or reuse another product's asynchronous response.

For each context menu, capture opening origin, visible/disabled actions, activation destination/effect, Escape/B dismissal, focus return and outside click. S35995 only establishes the **failed queue** menu containing View details, Resume installation and Cancel installation. It does not establish the installed game, catalog, DLC, third-party or product-details overflow menus.

## All nine Settings panes

The following tables describe the original **captured state**, not a combined list of everything present in package strings. Extra Linux/Nexus/Proton settings are intentional product additions and must be tracked separately from original-reference controls.

### Account — S36015; F47111

Observed order: account/profile heading and Edit action; avatar/profile and gamertag change link; order history, refund, Microsoft Store account change and help links; code redemption section/button; linked/social accounts section in **loading** state; privacy heading/Manage; explanatory activity-visibility text and a dropdown; lower content continues beyond the viewport. Only the visible portion is established.

K41813 and K47048 distinguish gaming and Store account roles; F47111 references separate `renderGamingProfileBlock` and `renderStoreProfileBlock`; K15939 names the mismatch condition. That corroborates separate roles, not permission to duplicate one verified Xbox identity into a fabricated Store account. The screenshot's linked-account spinner is not evidence of a connected provider list. Exact linked-account error/disconnect flows and purchase-sign-in UI need additional observations.

### Application — S36017; F48194, F48201–F48207

Observed groups: General (Compact mode, Show battery percentage); Startup (blue information banner, Open Windows Settings link, disabled launch-at-startup and minimize-to-tray rows in Xbox mode); Offline permissions (toggle, device-limit explanatory text and remaining changes); Developer (Show developer options at viewport bottom).

Compact mode is on; battery percentage off in this specific screenshot. These are reference fixture states, not global defaults. Controller focus and selected category must remain independent. Windows system Xbox-mode startup policy is a platform condition; it must not be silently conflated with an ordinary app fullscreen switch.

### Subscriptions — S36016

Observed: heading, failed-renewal warning with payment-update action, Xbox Game Pass card, plan/status/expiry columns, renewal action, divider, payment heading and price/next/last-payment columns with unavailable values/history link, management button. K47273/K12587 support warning keys; K19101/K24536/K38617/K39229/K47260/K47263 support column roles. Empty/error/expired/active states also exist in package vocabulary but are not all screenshot-observed.

The user's request to also display connected accounts here is an additional xboks requirement. This screenshot does **not** establish a connected-account block in the original Subscriptions pane. Distinguish that requested addition from original parity and bind each displayed account to verified role-specific data.

### Notifications — S36013/S36018; F48595

Observed order: Game Pass catalog-change checkbox; Store sale checkbox; wishlist-on-Game-Pass checkbox; wishlist-preorder-purchasable checkbox; More notification settings heading; Game Bar link and social-notification explanation. All four boxes are checked in this captured state. Package keys also name friends-online/message/add-friend families, but this pane's shown social preferences are delegated to Game Bar; do not append every discovered key automatically.

### Install options — S36019; F48373

Observed exact sequence: Game installation options heading/rule; default-location description and **closed empty dropdown** at approximately x806/y232/w538/h32; desktop-shortcut checkbox (unchecked); rule; automatic-updates checkbox (checked) and subordinate pre-download note; downloads/updates-during-gameplay checkbox (checked, wrapping label); rule; download-speed unit label and closed dropdown showing bits per second at y514.

Package-only additional candidates include ask-every-install (K47342), throttle/max-bandwidth (K13330/K12837), remote install (K36212), policy-enforced variants and formattable-drive metadata. Their visibility, ordering and conditional state are **not established by S36019**. In particular, adding bandwidth, parallel-download, backend/runtime and diagnostics blocks to this reference viewport is a deliberate Linux extension, not a screenshot match.

### Library and extensions — S36020

Observed heading: **Aggregated library**, introductory paragraph and Learn more. Five bordered provider cards at approximately **x811/w528/h80**, beginning y263 and then 90 px apart:

| Order | Provider | Captured substatus |
| --- | --- | --- |
| 1 | EA App | Installed-game display enabled; extension disconnected |
| 2 | Epic Games Store | Installed-game display enabled |
| 3 | GOG GALAXY | Installed-game display enabled |
| 4 | Steam | Installed-game display enabled |
| 5 | Ubisoft Connect PC | Installed-game display enabled; extension disconnected |

Each card has a brand asset near x828, text near x903 and right chevron. Below: My apps and games heading/rule at about y761/794; Show My apps in library toggle row at y812/h38 (off); Digital license history link and explanatory text. A fixed six-provider list with separate generic extension rows does not match this captured pane. Battle.net and Riot are present elsewhere in package vocabulary; that does not put them into this particular visible five-card list.

Provider chevrons imply configuration navigation, but expanded subpanes are unobserved. Visibility of installed games, launcher detection, account linkage, extension connection and extension lifecycle are separate states. The original screenshot itself shows **visibility enabled while an extension is disconnected**; a single `connected` boolean cannot model it faithfully.

### Audio — S35987; F47982

Observed order: input-device heading/rule and default-device dropdown; output-device equivalent; voice volume heading/rule and slider; push-to-talk heading/rule and enable checkbox (off); noise-suppression heading/rule and checkbox (on); navigation sounds heading/rule, controller-sounds checkbox (on), keyboard-sounds checkbox (off), navigation-volume slider. F47982 references input/output selection, volume, recording a push-to-talk shortcut, suppression and controller/keyboard sound handlers. Screenshot exposes only non-editing shortcut state.

Party/voice device routing is not the same as global Linux output volume. A functional system-volume slider cannot by itself satisfy the original voice/navigation controls.

### Accessibility — S35988; F47071

Observed first group Audio and visuals: Show profile themes (on), hover video previews (on), Disable background images (off), Disable animations (off), accessibility features on game-card hover (off). Second group: Game Bar, Windows, Xbox Accessories links with descriptions, and accessible-gaming Learn more link. F47071 supplies separate toggle/action identifiers. Preserve the inverted meanings of the Disable controls; do not reverse stored preferences when reusing positive internal names.

### About — S36014/S35989

Observed order: three version rows (app, Gaming Services, Game Bar); device section with serial/device-network identifiers; PC Insider section/status and manage ring button; links for Help, Store sales terms, Privacy, Services agreement, Terms of use, third-party notices, web third-party notices, ranking disclosure, accessible games, app updates. Do not copy device identifiers or Insider enrollment into xboks. Actual xboks/backend/runtime versions and Linux device data are adapter output; Microsoft-specific fields should have an explicit capability policy rather than fabricated values.

## App panels and desktop guide are separate systems

The app notification/social drawers start near x64/y60/w396; they dim the app and retain their own scroll/input region. The profile menu is smaller and anchored to the avatar. Neither is interchangeable with a full desktop Game Bar host.

The Game Bar manifest declares a separate Microsoft.XboxGamingOverlay package and GameBar executable/overlay entry. Xbox app package widget/tray/full-trust components further show hosting boundaries. This supports a **separate overlay surface/process contract**; it does not prove a one-to-one process assignment for every screenshot tab or that the original app alone implements Win+G.

Guide references show approximately x44/y104/w464 content panels, upper icon tabs and dimmed app background. S36003 shifts the strip to expose a performance icon. A static six-tab strip without horizontal navigation loses that state. The selected tabs use filled guide glyphs distinct from the app's outline rail icons.

| Guide panel | Visible controls | Linux adapter boundary |
| --- | --- | --- |
| Home, S35998 | Home/Library buttons, recent applications, launcher shortcuts | Activate app/game and report real running/recent state |
| Settings, S35999/S36004/S36005 | Microphone, volume, keyboard, exit Xbox mode, compact mode, more settings, network, Bluetooth, airplane mode, controller cursor, power submenu | Desktop/session/audio/network services; power is a system action |
| Audio, S36002 | Output/mic toggles and sliders, default-device pickers, manage devices, per-app mixer and stars | PipeWire/device enumeration/microphone/per-app routing, not launcher-only volume |
| Capture, S36003 | Screenshot, disabled replay, record, recording mic, captures gallery | Compositor/portal/game capture, recording lifecycle and actual capture location |
| Social, S36001 | Current identity, bell, search/add/party/overflow, friends/chats, requests and grouped friends | Xbox social and party service, separate from launcher detection |
| Edge, S36000 | Embedded address/back/tab/overflow controls and shortcuts | Isolated embedded browser; launching an external browser is a functional fallback, not visual/behavior parity |

The user explicitly requires system-wide **Win+G**, overlay above other applications/games, controller navigation and dismissal back to the active game. Those are acceptance requirements; screenshots and manifests do not verify the current Linux implementation. Test the actual hotkey, focus/grab/release, multi-monitor target, X11/Wayland stacking and a real game. Windows task switcher references S36006/S36007 are OS-shell surfaces and should not be confused with Guide Home.

## Completion ledger and implementation order

A feature is complete only when **evidence → independently written contract → adapter/data support → rendered states → interaction test → screenshot comparison** are all linked. Do not promote `static` or `inferred` to `observed` because a test passed against our own implementation. Original-runtime observations need their own build, input, state and result evidence.

1. Correct selected-product routing and state-bound menus first. Each catalog card and View details action must open the selected game's information, with loading/error/retry and source-aware Back.
2. Reproduce all nine captured Settings content panes at the pinned viewport, including actual Install and aggregated-library reference ordering. Track additional Nexus/Proton controls in a separate extension ledger.
3. Reproduce each anchored menu/drawer's opening origin, dimensions, selected/focus/disabled states and destinations. Acquire expanded picker/menu references before declaring their internals exact.
4. Match Home/Library/Store/Game Pass/detail geometry and assets using fixed-data fixtures plus live-data checks. Record visual residuals rather than declaring 100% from a build or typecheck.
5. Validate the desktop guide as a separate system integration, with real Win+G/game/controller tests. App-level modal screenshots cannot establish this.

Remaining original-evidence gaps: all recorded Windows click/key transitions; open Library filters; expanded product overflow; provider configuration; install-location and speed-unit options; complete loaded detail/review/more bodies; signed-out/offline and service failures; console connection/stream; feature flights; alternative DPI/handheld/noncompact states; physical controller mappings and OS hotkey ownership. These gaps are explicit work items, not permission to invent behavior.
