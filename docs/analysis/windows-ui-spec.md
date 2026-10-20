# Windows Xbox UI reconstruction specification

Reference: Xbox app **2610.1001.20.0**, Xbox mode, user-supplied **1920×1080** screenshots. Measurements below are in screenshot pixels, not verified Windows device-independent units. Dynamic content, loading states, pointer hover and controller focus must be distinguished.

## Evidence and package architecture

The reproducible [inventory](xbox-package-inventory.json) comes from:

```sh
python3 scripts/analysis/inspect-xbox-package.py \
  work/reference/Microsoft.GamingApp.msixbundle \
  --output docs/analysis/xbox-package-inventory.json
```

`Bundle/index.bundle` starts with little-endian magic `0x1f1903c103bc1fc6` followed by bytecode version **96**. The magic and prefix layout match the [Hermes bytecode format definition](https://github.com/facebook/hermes/blob/main/include/hermes/BCGen/HBC/BytecodeFileFormat.h). This establishes Hermes bytecode, rather than readable JS. React Native identifiers are also present, which supports a React Native UI inference; it does not establish every native component's implementation.

There are 518 PNG, 278 SVG, 48 DLL, 39 WinMD, 17 TTF, 15 JPG, 12 MP3, 11 XBF, 7 EXE, 6 WAV and 3 PRI entries. No `.map` entries were found. File names and counts are inventory evidence, not evidence that a feature is available in Linux.

The XBF files include title bar, menu, icon, image and recap views. The manifest declares separate launcher, tray, full-trust, party and widget processes. Consequently, the screenshots cover both application UI and adjacent Windows/Game Bar surfaces. A single MSIX UI bundle should not be assumed to implement every overlay or the Windows task switcher.

The initial raw printable-string scan produced concatenated fragments from a packed string store. Those fragments are not reliable module names or complete source strings. A future disassembly step must use an explicitly version-96-compatible reader, verify section bounds and avoid executing the bytecode. No source recovery is claimed here.

## Shared shell

| Element | Screenshot observation | xboks action |
| --- | --- | --- |
| Navigation rail | x=0–67, full height; sampled solid fill `#25282c` | Fixed 68 px desktop rail; responsive adjustments only for smaller screens |
| Active item | Approximately 51×48 px, x=8; neutral gray rounded rectangle | Neutral selection, with a separate white controller focus outline |
| Main canvas | Solid library region sampled as `#1a1b1e` | Use as the base color; artwork blur belongs to appropriate pages |
| Search | Approximately x=744, y=32, w=500, h=32 | Center relative to content area; pill border; no backend labels |
| Main content | First content x≈188; 120 px after rail | At reference width use 120 px content inset |
| Clock | Upper right, baseline around y=54 | Localized time; system indicators require real platform data |
| Back | Small rounded button near x=85, y=33 on secondary pages | Add real back history rather than always returning Home |
| Navigation sequence | Avatar, Home, Game Pass, Library, Store, divider, social; notifications/queue lower down | Current rail lacks dedicated Game Pass/social/notification routes |

## Home — 36010

- Heading around (188, 120), square recent tile approximately 184×184 at (188, 163).
- A neighboring 184 px group contains a 2×2 mosaic of four recent items. This is a compact history grouping, not six equal full-size cards.
- Featured heading around y=404; main tiles begin y=446. First two tiles are approximately 629×354 and right-hand cards approximately 314×167, with 20 px gaps.
- Recently added section begins around x=156, y=848, with a rounded black container and a centered heading.
- Existing xboks deviations: six equal recent tiles; utility cards instead of editorial cards; Store discovery instead of a verified Game Pass collection; too-small recent tiles at some widths; missing lower navigation routes.
- Next implementation: recent primary + mosaic group, reference proportions, reusable editorial cards supplied by a real collection provider. Do not hard-code the account's subscription or the screenshot's product availability.

## Library — 35991

- Horizontal tabs: My games, Play later, Play history, Install queue; active tab uses a white underline.
- Filter row uses compact rounded pills for platform, access, play state and sorting. Applied filters appear as removable chips on a separate row.
- Result count and add action align right. Square artwork cards have a solid metadata footer.
- Next implementation: shared library tabs, existing owned/Game Pass/installed filters mapped to those controls, real local history and saved list storage where supported.

## Install queue — 35994 / 35995

- Same library tab strip; installation settings and update-check status below.
- Collapsible active section; resume-all/pause-all at the right.
- Active row: roughly 102 px high, square cover, title/state, long thin progress bar, percent, error icon and overflow menu.
- Secondary section lists detected local content. Discovery should be backed by actual manifest scanning, not screenshot data.
- Overflow menu shows game details, resume installation and cancel. Existing file-preservation confirmation semantics must survive the redesign.
- Error state uses an amber progress segment. A download tooltip at the bottom rail repeats current title, transferred bytes and percentage.

## Store — 35992 / 35993

- Loading reference has three wide feature skeletons. Loaded reference shows a centered Minecraft feature; these are different states, not necessarily fixed three-card content.
- Quick links: all PC games, top paid, add-ons, redeem and wishlist. Product rows use square covers and metadata footers.
- Next implementation: a shared collection/hero component with real loading, unavailable and loaded states; direct product navigation from Home.

## Game Pass — 35990

- Discovery banner, horizontally clipped editorial carousel with pagination and pause, shortcut row and recently added products.
- Snapshot count and product selection are dynamic. The reference's count is not a value to ship in xboks.
- Blocked functionality: no verified xboks Home/Game Pass editorial provider yet. Owned-library Game Pass entitlement data is distinct from editorial collections.

## Game details — 35996

- Title/description/actions occupy the left; a wide screenshot/hero area sits right.
- Install/download state is part of the primary action; wishlist and overflow actions follow.
- Age/content strip spans the page below the hero. Details/reviews/more tabs follow.
- Existing supported install/launch actions stay real. Ratings, friend counts, Play Anywhere and purchase/renewal status require data; absence must not become an invented badge.

## Settings — 36020 to 36013, 35987 to 35989

- Modal bounds approximately (560, 65) to (1360, 1015): **800×950 px** at the desktop reference size.
- Left section approximately 230 px wide; content starts x≈806, leaving 16 px padding beyond the section split.
- Side sections: Account, Application, Subscriptions, Notifications, Install options, Library/extensions, Audio, Accessibility, About.
- Selected row gray; controller focus is an outer white rounded outline, independently visible from selection.
- Checkbox/toggle rows, thin section rules, restrained rounded controls, green external links. Content scrolls inside the modal.
- Implement a dialog with focus containment, Escape/B close, focus restoration, readable handheld sizing and existing functional Nexus setup under an advanced area.
- Accessibility controls can genuinely change motion/background behavior locally. Audio/device controls need Linux services. Payment, subscriptions and permissions must not be represented by copied sample account state.

## Panels and overlays

| Surface | Reference | Scope |
| --- | --- | --- |
| Notification drawer | 36011/36012 | App-level drawer ≈396 px wide at x=64, y=60; unread filter and overflow |
| Social drawer | 35993 | App-level search, friends/chats tabs, online/offline groups; service support unverified |
| Profile menu | 35997 | Small anchored menu, settings/support/account actions |
| Guide Home | 35998 | Guide tabs above a ≈464 px panel; recent apps and launcher shortcuts |
| Guide settings/audio/capture | 36005–36002, 35999 | OS/Game Bar-style overlay; requires Linux integration beyond application navigation |
| Browser widget | 36000 | Separate embedded browsing surface; not a normal Store webview |
| Task switcher | 36006/36007 | Windows shell surface; out of the first client UI milestone |

## Order of implementation

1. Finish the shared shell and Home proportions; remove the runtime promotional tile and visible development-only controls from reference-facing surfaces.
2. Build a reusable modal/drawer/focus foundation and migrate functional settings into the reference layout.
3. Rework Library and queue together, retaining real actions and cancellation safety.
4. Rework product details and Store, including direct selection from Home.
5. Add verified Game Pass collections; investigate social APIs and Linux guide services separately.

## Acceptance checks

- Capture the same viewport, page and input state; compare layout separately from dynamic catalog artwork.
- Test loading, empty, offline, signed-out, download error and ready states without inventing account data.
- Verify controller navigation, back/close order, scroll containment and focus restoration.
- Do not describe visual completeness as backend/game compatibility.
- Keep personal screenshots and original Microsoft binaries/fonts/assets in ignored reference storage. Only aggregate measurements, independently written code and xboks sample previews belong in the repository.
