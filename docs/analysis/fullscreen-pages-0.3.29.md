# Xbox mode destinations in XBOKS 0.3.29

Recorded 2026-11-07. This fixes the incomplete 0.3.28 shell migration: only Home
used the new controller layout, while every other console destination explicitly
mounted the retained desktop Sidebar and topbar.

## Implementation

One shared XboxModeNavigation now remains mounted across Home, Library, Store,
Game Pass, Cloud, profile and the installation queue. More exposes Cloud, Remote
Play, friends/chat, notifications and queue actions. The old rail and topbar are
not mounted in console mode. Desktop navigation remains separate.

The header measures its actual height, so fixed Cloud details and page content
use the current header geometry rather than the old 68/260-pixel rail and
88-pixel topbar assumptions. Search has its own console surface above the
catalog. Cloud-scoped search stays within Cloud. Back closes the search surface
before a page-level query handler; a nested Cloud product dialog keeps priority.

The console canvas, filters, cards, details actions, popups and console chooser
use controller-scale spacing. Header-to-content navigation remembers the last
valid page control, and shoulder navigation follows the visible console order.
Editable controls and modal input scopes retain priority over navigation.

Settings V2 uses the categories declared by the supplied 2612 package: Account,
Devices & connections, System, Play & social, Apps and Accessibility. Existing
functional controls are organized into nested pages; unsupported service
operations remain unavailable. Outgoing Cloud/Remote routes use the same
unsaved-change confirmation as closing Settings. Background input ownership
includes the shared header, including nodes replaced by mode transitions.

The profile destination and shared account header hide previous identity and
membership while an account transition is pending.

## Evidence boundary

The new category contract is static package evidence in
[xbox-package-2612.md](xbox-package-2612.md). The controller presentation also
uses the user's dashboard references. This is an independent Linux adaptation,
not proof that every Windows 2612 installation selects these exact layouts.

Browser verification uses the actual XBOKS React components with labeled sample
artwork, synthetic account/catalog responses and virtual gamepad input. It does
not sign in, send messages, connect to a console, launch games or operate host
audio. Original Windows interaction, physical-controller acceptance and pixel
parity remain unverified. Final browser counts, source hashes and selected
captures are recorded separately with the screenshot provenance.

The original Windows client was separately tested through the existing managed
Proton launcher. See [the bounded compatibility report](xbox-proton-feasibility-2026-11-06.md);
this UI change does not resolve its Windows App SDK and WinRT activation gaps.
