# XBOKS 0.3.28 redesign implementation

This checkpoint implements the first desktop/console-shell migration from
XBOKS `a6e0a4e`. It combines the [official PC visual reference](xbox-pc-redesign-2026-11-05.md),
the user's dashboard design references and the [supplied 2612 package
inspection](xbox-package-2612.md). It is a development candidate, not a claim of
complete original-app analysis or 100% UI parity.

## Implemented behavior

- A full-width desktop header with working search, profile, notifications,
  sidebar collapse and Xbox-mode entry; no desktop clock/battery polling.
- Separate Home/Library/Game Pass/Store navigation, a persistent real-data Friends
  panel and Queue. More retains Cloud Gaming, Remote Play and Settings.
- A desktop Home with a wide installed-game banner, recent games, promotional
  tiles and landscape public-catalog cards.
- A distinct controller Home in Xbox mode: selected-game artwork, horizontal
  tiles, account/membership, working navigation shortcuts, appearance settings
  and desktop return.
- Focus changes the console selection and background; A opens existing game
  details. Back restores the same tile and scroll position. Shoulder navigation
  follows the primary-page order.
- Native entry remains pending until its request settles. An early fullscreen
  event does not discard the blocking dialog or lose a later error/retry.
- Settings retains input isolation across external desktop/mode changes. Closing
  restores each background surface's original inert state. Account transitions
  hide old console profile information.
- Friends search/selection opens the correct account-bound conversation. Reads
  are coalesced and visible-only; account/search cancellation discards stale data.
- Message drafts survive ambiguous receipts. Matching account, peer, self-sender
  and message IDs in history are required to clear submitted text. Automatic
  polling cannot unlock an unknown submission; explicit successful refresh
  permits review/retry with unconfirmed text retained.

The mode selector observes native fullscreen and acknowledged gaming-session
state. A controller interface in a window-only fallback is not evidence of an
integrated GNOME session or improved performance.

## Executed verification

`npm run build` includes renderer/main type checks, the complete Vitest suite,
Vite output and Electron compilation: **2,336 tests across 181 files passed**.
Candidate logs and packaging hashes stay
with the private publication proof. This UI/social change introduces no new
native runtime patch or Engine binary.

The actual React App passed **34 isolated browser checks**, with zero browser
errors, unexpected fixture calls or forbidden mutations. The runner is
`scripts/ui/experience-redesign-smoke.mjs`. Coverage includes desktop routing,
collapse, Friends/people search, exact peer selection, sign-out cleanup,
Settings isolation across both external mode changes, and stale profile hiding
while an account transition runs.

Console layouts were checked at 1280 × 720, 1920 × 1080 and 2560 × 1440, with
desktop dock bounds at 1280/1920. Controller checks cover movement, horizontal
reveal, A/B selection return, shoulder pages, Search and appearance routes
without game execution. Deferred native entry success/failure, blocking dialog
lifetime, retry, desktop return and external session snapshots were also tested.

The browser uses generated artwork and synthetic, service-shaped account data.
It cannot access the user's backend, wallet, devices or remote Xbox services.
[Public captures and hashes](../screenshots/redesign-provenance.json) identify
this scope; the detailed report stays in ignored local research storage.

## Remaining differences

The supplied package has a new web payload alongside the old Hermes app, with
feature/host-dependent routes. Its native CE loader path and active Windows
configuration are not yet observed. Settings V2 grouping and all platform-specific
controls have not been migrated; existing XBOKS settings remain functional.
Complete new Library/search behavior, product video hover previews and all
compact-layout variants also remain to be matched.

The console Home is independently implemented from the supplied dashboard
references. Those images do not establish that this exact layout is selected
by every Windows 2612 installation. Original Windows interaction and pixel
parity remain unverified.

The [upstream social audit](nexus-social-2026-11-06.md) identifies additional
authenticated signing, relationship/profile, desktop-chat and party work.
The current backend was retained. This candidate does not enable party voice,
friend relationship mutations, pop-out chat or prove live message delivery.
Physical-controller gameplay and long real-account sessions were not performed
by the isolated browser checks.
