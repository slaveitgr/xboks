# Nexus 0.3.9 integration into xboks

Source: the user-supplied `/home/example/Downloads/xodus-nexus-0.3.9.zip` (6,591,010 bytes, SHA-256 `e493718f11944e31bd27113bc989e5087ed317d3647ba3eba1aa25cb6bf277df`). The archive declares launcher version 0.3.9 and uses the same React/Electron dependencies already installed in the project.

The upstream archive was unpacked into ignored `work/upstream/nexus-0.3.9`, compared with tag v0.3.8, and merged by file against the existing xboks checkout. Many 0.3.9 download/authentication fixes were already present. Before the merge, tracked changes and untracked source were backed up in ignored `work/backups/before-nexus-0.3.9/`. Local Windows reference packages and UI assets were not replaced or published.

## Imported changes

- Launcher/package metadata is 0.3.9; the backend source lock requires 0.2.9.
- Read-only system-keyring checks and explicit start-service actions, integrated into account Settings and first-run setup. Disabled wallet security settings are not silently changed.
- Show the launcher before optional account checks. Remove the obsolete shared-session graphical-environment/keyring preparation module.
- Full diagnostic-log copy and file reveal, with the upstream path/regular-file guards.
- Shared game management actions for library menus and game details, including updates, content, VC++, settings and shortcuts.
- Updated Proton/runtime inspection and installation logic, loader-warning handling and update notices.
- Runtime source recipes, DXVK constant-comparison fixes, game-relaunch patch and their build/probe scripts. This imports source/build support; it does not compile or install a new Proton runtime.

Preserved xboks branding, `~/Games/Xboks`, original icon/font integration, all nine Settings categories, Game Pass page, Play later/history, desktop Game Bar and Win+G handoff, Remote Play, desktop preferences, and the new launch/readiness UI.

## Changes informed by Windows component analysis

Xbox profile/credential availability and Microsoft Store identity now have separate UI roles. A Store identity is displayed only from an explicitly sourced, account-bound, fresh backend record. Current Nexus does not report that record, so the Store card remains unavailable rather than duplicating the Xbox account. Different sign-in names are not treated as conclusive proof of different Microsoft accounts.

Download completion no longer implies launch readiness in the queue presentation: only a matching, inspected ready installation gets Ready to play. This does not enable incomplete-game launching.

A preparation/error dialog follows actual launch operation state. It hides after the process starts, supports keeping browsing and retains diagnostic access after a preparation error. A simulated renderer test verified preparation → running → failure → dismissal and background focus/inert restoration. No cloud-sync percentage or service success is invented.

## Validation

- Renderer and Electron TypeScript checks passed; Vite production build passed.
- Full Vitest run: **828 passed, 2 failed** out of 830. Both failures concern executing the synthetic oddly named AppImage in `game-shortcuts.test.ts`; the same two failures reproduce when running the untouched 0.3.9 archive's test/source in this environment. They report an execution-layer utility-name security mismatch. The tests were not weakened or bypassed.
- CI/tool policy tests: **45 passed**.
- Runtime tool unit tests excluding the cross-compiler staging suite: **27 passed**, including new DXVK/assembly tests.
- The complete runtime-tool command additionally has seven staging failures because `x86_64-w64-mingw32-gcc` is unavailable. A runtime binary build and Windows C probes are not verified here.
- Backend and runtime locked patch hashes match their source files.
- Electron visual checks passed for all nine Settings sections, Play later/history, queue menus and focus restoration. The modal remained 800×950 at (560,65) on a 1920×1080 viewport, with no horizontal overflow.

The existing installed backend/runtime and real game/console behavior are separate from this source integration. Neither a new backend nor a new runtime was installed automatically.
