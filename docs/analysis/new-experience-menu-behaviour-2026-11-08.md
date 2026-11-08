# New App Experience menu and account-state corrections

Checkpoint: 2026-11-08, XBOKS 0.3.31 development source. These changes correct
functional defects in XBOKS's existing menu and account-library integration.
They do not claim complete original Xbox UI or service parity. Original 2612
account-menu/Profile visibility is recorded separately in the
[parity ledger](xbox2612-new-ui-parity-ledger-2026-11-08.md); no new original-client
execution, account write or service acceptance was performed for this pass.

## Defects and resulting behavior

- Game Pass previously fetched only when the signed-in boolean changed. Two
  signed-in accounts, a market change or an in-progress account transition could
  therefore retain the previous account's products. Each new reader now belongs
  to a returned username/gamertag, market and backend identity. The render guard
  hides an old scope before effects run; disposed readers discard late results.
  A missing account identity does not start a private read or adopt local data.
- Game Pass previously stopped after the first account-library page and had no
  retry. Its loader now serializes requests, follows actual returned cursors,
  rejects repeated/cyclic cursors, merges exact product identities, and applies
  the current full license map. A continuation failure retains accepted products
  and retries that cursor explicitly. Refresh starts a new first-page license
  read. Unknown/owned-only access does not become Game Pass access. Partial
  license validation is reported rather than presented as a complete catalog.
- Genre selection belongs to the same account scope. Product selection still
  opens the exact product details; it never installs or launches a game.
- Game Pass now remains mounted while it is a navigation-history return point.
  Its wrapper is hidden behind other pages, and covering it with details,
  Settings or a flyout pauses its reader and removes its genre popup. Accepted
  pages and genre survive Details → Back, including continuation-page cards.
  Only settled data and consumed cursors can seed a resumed reader; hidden late
  completions are discarded and an abandoned initial load restarts on resume.
  Hidden handlers cannot navigate or fetch. Account, market, backend or provider
  changes discard the cache even while the page is hidden; returning to an older
  account identity requires fresh reads instead of reusing its previous epoch.
- Returning from account Help/Feedback previously focused the first account
  action. Back now restores the specific Help/Feedback action that opened the
  nested surface. Switching flyout types creates a fresh inner surface, so
  another panel cannot inherit an open auxiliary view.
- Sign-out now has an immediate request guard, not only a button's next-render
  disabled state. It prevents duplicate submissions and navigation during the
  pending operation. Late completions cannot close a replacement account's
  surface or update an unmounted menu. Failure displays a fixed localized
  message and permits an explicit retry, without copying arbitrary provider
  error content into the menu.
- Profile history/achievement ownership now also supports a returned gamertag
  when the username is absent. Unknown identities show no private recent-play
  history. Recent games are unique positive recorded play events, never install
  order, zero timestamps or arbitrary negative values.

## Verification

The first affected check passed **62 tests across seven files**: the new
`gamepass-library.test.ts` and `new-experience-menu-behaviour.test.tsx`, plus
existing Profile, Account profile, Account library, desktop chrome and Settings
V2 tests. Both TypeScript projects typecheck and scoped whitespace checks pass.
The new hook tests execute the actual component effects/handlers against
deferred synthetic responses; they cover immediate owner invalidation, retry,
continuation, exact detail selection, Back focus, duplicate sign-out, pending
navigation and stale/unmounted completion. No account, game, microphone, wallet
or real desktop application was used.

The follow-up pause/resume checks passed **22 tests across the two new files**,
with both TypeScript projects passing again. They force hidden initial and
continuation completions, same-account genre/page retention, an account
A → B → A transition, and a repeated cursor after seeded resumption. The App
integration fixture separately checks that Details → Back restores the exact
continuation-page card and does not trigger a duplicate account-library read.

The existing Game Pass visual layout and benefits-provider limitation remain.
These fixes do not supply the original personalized feed, offline licensing,
party signaling or inline Microsoft account/commerce dialogs. The parent
checkpoint records final integrated browser and whole-suite results separately.
