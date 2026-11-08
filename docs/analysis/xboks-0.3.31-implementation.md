# XBOKS 0.3.31 New App Experience candidate

This development candidate reconstructs selected 2612.1001.23.0 New App
Experience surfaces and their real navigation/data mechanisms. It does not
claim complete Windows pixel parity, complete service parity or stable release
readiness. The [parity ledger](xbox2612-new-ui-parity-ledger-2026-11-08.md)
distinguishes original static evidence, observed original-client behavior under
Wine, independent Linux implementation and remaining unknowns.

## Resulting behavior

- Responsive desktop dock and Featured Home follow the pinned new shell
  geometry. Recorded account history supplies recent games; installation order
  does not manufacture play history.
- Library Installed, Apps, Recently played and My games have separate data
  sources. Apps reads visible Linux desktop entries through GJS and launches
  the selected exact ID only from the trusted focused launcher.
- Account/Profile and six Settings categories retain real account ownership,
  pending/error states and nested Back/focus. Engine/Proton controls remain
  reachable through Install & storage; launcher updates and keyring setup
  remain reachable through About.
- Store Browse/Deals, Categories and Wishlist are actual destinations. Deals
  and all 18 categories read original-service channel membership and page by
  consumed source IDs. Product details and Back preserve loaded pages, route,
  scroll and focused control. Cancelled initial reads restart; failed
  continuations retain accepted cards and retry the same cursor.
- Game Pass follows real account-library cursors, refreshes licenses explicitly,
  retains accepted pages/genre when returning from details and pauses hidden
  reads. Account, market or backend changes immediately invalidate old data.
- Help/Feedback returns to the invoking account-menu action. Sign-out rejects
  duplicate submissions and cannot close another account's replacement menu.
- Spotify discovery/property reads are serialized and signal bursts coalesced,
  preventing an overlapping refresh from returning previous player state.

The source also includes the previously prepared Linux Gaming Mode/native
original-client integration and its source/diagnostic documentation. Publishing
the Wine patch sources does not replace the installed Wine runtime or ship
Microsoft packages. Wine patch licensing is scoped separately in
[the patch notices](patches/README.md).

## Validation

- Both TypeScript projects typecheck.
- Complete final unit suite: **2,515 tests across 195 files passed**, one worker,
  77.15 seconds; all 461 pinned source/test inputs unchanged during the run.
- Catalog/channel subset: 113 passed, including 38 original-channel adapter
  cases. These are included in the whole unit suite, not additional totals.
- Desktop integration fixtures: 93 Node and 18 Python checks passed.
- Runtime tools: 34 passed using the existing local MinGW toolchain; no new
  compatibility runtime was built or installed.
- CI tooling: 60 passed with bounded process concurrency. Offline MSIX checks:
  14 Node and 36 Python passed. Resident Guide installer/controller checks:
  26 and 39 Python tests passed.
- Compiled production Store adapter, anonymous market GR read: 24 Deals cards,
  an advancing continuation page of 24 cards and 24 Cozy-category cards returned. No
  account, license, installation, purchase or game operation occurred.
- Full renderer integration: **177 checks passed, 0 failed**, 59 screenshots,
  no browser exceptions, external network requests, forbidden actions,
  unexpected APIs or source drift. The accepted run includes Store Deals Retry,
  exact mood/category membership, retained Game Pass page-two/filter/focus,
  Refresh after pagination, Remote Play navigation without auto-connection,
  Settings, controller sliders and account invalidation/sign-out guards.

Accepted renderer report: SHA256
`c565b6daf207aa9e93bacda2fcdf4e55f4027ef1fa650eb2c84adf2a9a0c1ae6`;
source-fingerprint record SHA256
`1c4cd22977ab8124ab31bd6ad10e86e52e725326e6f05c10bbabbdaf2b74263b`.
Both remain under the ignored
`work/redesign-2026-11/new-experience-functional-final-0.3.31-v2/` directory.
Selected unmodified fixture screenshots and relative source fingerprints are
published in [the gallery](../screenshots/README.md).

The earlier interrupted and resource-limited runs are not final acceptance.
The former Spotify failure was reproduced deterministically and corrected;
process-resource failures passed unchanged assertions/deadlines under bounded
concurrency. Renderer integration evidence and exact package identity accompany
the final candidate checkpoint.

The final private acceptance record has SHA256
`34a4b6a574ed01b4ce442c973a05a60bc1f92194c2ec70f290594b75087cc343`;
the final unit log SHA256 is
`28863552b9ef6f927a5f44d58eb2e2feb5e701f94036a17595deb14507ab5cc4`.
Neither raw fixture logs nor account diagnostics are included in Git.

### GJS compatibility correction

The first GitHub CI run exposed a genuine Apps-provider defect on Ubuntu 24.04
(GJS 1.80.2 / GLib 2.80). Gio and GioUnix expose different JavaScript
constructors for the same native GDesktopAppInfo type there. An `instanceof`
check accepted current GJS 1.90 but filtered every entry on the older version.
The provider now checks a native GObject instance and its exact GType, retaining
all ID, visibility, launch and icon restrictions. The unchanged launch fixture
failed before this fix and passed on both toolchains after it. A separate Gio
preflight validates the fixture metadata independently of the consumer.

The corrected helper passed the current-GJS desktop suite (93 tests), main Apps
checks (16 tests), and the real Ubuntu 24.04/GJS 1.80 fixture. The private paired
compatibility proof has SHA256
`308f44aa25fcf232844f0b301d5af6c3af2e3ecd692face739776eba238d00a2`.

This correction changes the one-shot desktop helper only; the accepted renderer
and compiled main/preload code are unchanged. The remote CI result and final
local package checksum identify the corrected candidate separately from the
first local package. Reference UI resources extracted from the user's original
package remain optional local build inputs; those resources are not in Git or
published as a binary release.

## Remaining boundaries

Public Featured products are not the original personalized campaign feed.
Wishlist, personal Picks for you, inline Microsoft commerce, party voice and
all original service/account settings are not established by these changes.
Unconnected actions retain explicit unavailable states. Prices, ownership,
subscriptions and installability are separate facts, never inferred from a
Deals/category label or a sign-in boolean.

Original Xbox-mode coverage remains bounded: existing original-client mode
entry and selected desktop route observations do not establish every fullscreen
screen or controller transition. Physical-controller acceptance, live social/
party and One X streaming require their own real-device checks. Passing fixture
tests does not establish those results.
