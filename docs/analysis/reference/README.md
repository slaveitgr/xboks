# Xbox reference library for xboks

This is the canonical engineering reference for reconstructing **Xbox app 2610.1001.20.0 x64** and the supplied **Game Bar 7.326.10141.0** experience in xboks. It supersedes guesses made during the first UI implementation. It contains reproducible tools, source locators, screenshot contracts, a feature verification matrix and Linux implementation instructions.

**Status:** broad static decoding and targeted behavioral reconstruction, not completed 100% reverse engineering. Function/instruction indexing, semantic understanding, Windows runtime observation, Linux implementation and visual matching are separate checks. No combined percentage is assigned. PRI resource candidates and the supplied native XBF node streams are now decoded; native method implementations, effective binding/theme values, server content and unobserved runtime states remain separate gaps. The user currently has no Windows PC available, so original-client dynamic observation remains unavailable rather than silently treated as passed.

For the user: Η βιβλιοθήκη είναι η βάση εργασίας για το xboks. Κάθε οθόνη και ενέργεια πρέπει να συνδέεται με συγκεκριμένο screenshot ή εύρημα του package. Ό,τι δεν έχει επιβεβαιωθεί παραμένει σημειωμένο ως κενό — δεν μετατρέπεται σε υποτιθέμενη λειτουργία του original.

## Start here

| Reference | Use |
|---|---|
| [UI contracts](ui-contracts.md) | Observed screens, original menus/settings, actions and exact evidence locators |
| [Machine-readable UI actions](ui-actions.json) | Track control → action → destination independently of the current React implementation |
| [Menu behavior traces](menu-behavior-traces.md) / [55 machine-readable rules](menu-behavior-contracts.json) | Primary click vs context menu, source/state-dependent actions, dismissal, profile routes and input ownership |
| [Settings behavior traces](settings-behavior-traces.md) | Compact/battery relationship, identity gates, FSE startup rules and provider-setting success/error behavior |
| [Product navigation trace](product-navigation-trace.md) | Concrete Product ID → route payload → detail-query reconstruction for the reported card/menu problem |
| [Bytecode analysis](bytecode-analysis.md) | Function/offset evidence, literal buffers, closure/call distinction and module dependency patterns |
| [Control-flow audit](control-flow.md) | Switch tables and exception-handler ranges/targets, with separate semantic limits |
| [Native contracts](native-contracts.md) | Controller focus, console streaming, accounts and process boundaries from WinMD |
| [Typed WinMD signatures](winmd-signatures.md) | Method/field types, parameters, async return contracts and enum constants, preserving originating files |
| [PRI resources and Greek labels](pri-resources.md) | Named resource → qualifier set → candidate value, with exact schema binding for the Greek pack |
| [Native XBF resources](xbf-resources.md) | Persisted native tray controls, styles, templates, glyph/font pairs and visual-state operations |
| [Game Bar widgets, settings and Spotify](gamebar-widgets.md) | Dedicated x64/Greek library: 74 embedded XBFs, exact native controls/typed contracts, widget ownership and Linux feature boundaries |
| [Implementation guide](implementation-guide.md) | Build/run xboks and implement the reference through existing Nexus/Linux adapters |
| [Application implementation — 2026-10-21](app-implementation-2026-10-21.md) | Dated menu/Back/product/queue/Settings changes, scoped test runs and sample Chromium verification; original runtime/service gates remain separate |
| [Social and system integration — 2026-10-21](../social-system-integration.md) | Shared Friends/chat, authenticated read-only results, Linux system controls, packaging and explicit party voice/acceptance limits |
| [Party voice architecture and implementation plan](party-voice.md) | Native PlayFab Party imports, typed audio/auth interfaces, exact signaling/IPC locators and separate Linux media/acceptance requirements |
| [Verification matrix](verification-matrix.json) | Independent evidence/implementation/acceptance gaps by feature |
| [Analysis status](analysis-status.json) | Machine-readable aggregate counts and the remaining analysis boundaries |
| [Windows observation procedure](windows-observation.md) | Capture missing interaction states on the original client without changing the app |

Earlier files in `docs/analysis/` are dated investigation records. Their implementation status can be stale; use the source audit and matrix here for current decisions. Never promote an old statement that a feature was planned into evidence that it now works.

The [dated application implementation report](app-implementation-2026-10-21.md) records source changes and executed fixture tests separately from the earlier static documentation audit. Its 20/20 Chromium checks use the actual React app with sample APIs/artwork; they do not verify original Windows runtime, real Xbox services, an operating-system overlay or pixel parity.

## What the local library contains

The generated database is `work/reference/library/reference.sqlite3`, with a public-safe aggregate `summary.json` beside it. It indexes:

- Every member/hash of the supplied Xbox x64, Greek resource and Game Bar x64 application archives; manifests and declared capabilities.
- All **103,136 Hermes strings**, **68,878 function headers**, and the **2,541,891 decoded instructions** through the version-pinned bytecode tools.
- Exact string sites, including serialized object keys/values and array literals, with function-relative and file offsets; typed function references and conservative module registration/dependency patterns when the detailed evidence pass is present.
- **5 PRI files / 74 sections**, **12,811 mapped resource entries** and **52,336 candidate values**, including **5,219 Greek string candidates** explicitly qualified `EL-GR`. Namespace, schema identity, declared encoding and qualifiers are retained; this does not choose Windows' effective runtime candidate.
- All **11 Xbox native XBF files**, with **2,602 persisted operations across 46 substreams**, including typed constants, style setters, resource dictionaries and visual states. These identify native `XboxPcTrayUI` surfaces; their dimensions must not be assigned to the main React Native shell without host evidence.
- All **49 WinMD files** in the two main packages, including **43,571 decoded method/field member signatures**, parameter metadata and constants, plus separately versioned supporting-package indexes. Duplicate projections/framework types are retained with their source identity. Typed declarations do not recover native implementations or a portable WinRT ABI.

Raw proprietary strings, disassembly, assets and private screenshots stay in ignored `work/reference/` or the local private asset kit. The repository publishes tools and factual contracts. **A compiled xboks build can currently include `public/original-xbox`; inspect the build inputs before sharing it.** The detailed analysis JSONL is reference material, not code to paste into the app.

## Rebuild the local indexes

Run from the repository root. Inputs must be the same local packages used by this investigation. Nothing below installs or executes Microsoft packages. The local Microsoft inputs and opcode header are not shipped in this repository.

For a fresh analysis workstation, install the optional readers into ignored local storage:

```sh
python3 -m pip install --target work/reference/metadata-tools -r scripts/analysis/requirements.txt
mkdir -p work/reference/hermes-format
curl -fsSLo work/reference/hermes-format/BytecodeList.def \
  https://raw.githubusercontent.com/facebook/hermes/v0.13.0/include/hermes/BCGen/HBC/BytecodeList.def
```

Before the XBF step, retrieve the two hash-pinned Microsoft stable-type/property CSV tables using [the XBF chapter's exact source-download commands](xbf-resources.md#reproduce-and-inspect). Its parser verifies those hashes; a newer arbitrary table is not an equivalent input. The PRI reader needs no external runtime/table dependency; its pinned MRT format sources and supported variants are documented in [the PRI chapter](pri-resources.md#format-source).

Place the original child archives at the filenames shown below, and extract only the exact `Bundle/index.bundle` member from the Xbox x64 MSIX into `work/reference/index.bundle`. The original bundle identity/checksum is recorded in [the inventory](../xbox-package-inventory.json). The database builder rechecks that this bytecode is identical to the archive member; it also freshly decodes the metadata/instruction index before import. Reuse `PYTHONPATH=work/reference/metadata-tools` for the optional Pillow comparator if Pillow is not installed in the active interpreter.

```sh
# Structural Hermes tables; rejects incompatible version/length/checksum.
python3 scripts/analysis/inspect-hermes96.py work/reference/index.bundle \
  --private-output work/reference/hermes96-decoded.json

# Pinned opcode source from facebook/hermes v0.13.0, already under local hermes-format/.
python3 scripts/analysis/index-hermes96-code.py work/reference/index.bundle \
  --metadata work/reference/hermes96-decoded.json \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --private-output work/reference/hermes96-code-index.json

# Exact sites, literals, function and module relationships.
python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --metadata work/reference/hermes96-decoded.json \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --private-output work/reference/library

# Separate switch/exception-table audit.
python3 scripts/analysis/audit-hermes96-control-flow.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --private-output work/reference/library/control-flow.json

# Native declarations. dnfile/dncil are local inspection dependencies, not app dependencies.
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-xbox-components.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --output work/reference/xbox-components.json
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-xbox-components.py \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --output work/reference/gamebar-components.json

# Typed native method/field signatures, parameter metadata and constants.
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-winmd-signatures.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --private-output work/reference/library/native-signatures-xbox.json
PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-winmd-signatures.py \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --private-output work/reference/library/native-signatures-gamebar.json

# Named PRI candidates; supply the main schema with the Greek resource pack.
python3 scripts/analysis/inspect-pri-resources.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  work/reference/XboxAppPackage_2610.1001.20.0_language-el.msix \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --private-output work/reference/library/pri

# Native XBF nodes, after downloading the pinned stable CSV tables above.
python3 scripts/analysis/inspect-xbf-resources.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --format-source work/reference/library/xbf/source \
  --output work/reference/library/xbf

# Assemble a searchable database with provenance and integrity checks.
python3 scripts/analysis/xbox-reference-library.py build
```

The pinned `BytecodeList.def` SHA-256 is `62bfc95c5ab7d96bc58c31f1a9faa8772afb9500d5f87e541c8a3623645f1a85`. The pinned `BytecodeFileFormat.h` hash is `51a5ae736f3197b388ece56b1948d76ed7222756f09d499b34b33cd2689eae67`. Format readers target Hermes v96, not whichever version is newest. [Upstream opcode definition](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeList.def) and [file format](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeFileFormat.h) identify the exact source revision.

The supporting package indexes are produced with `inspect-xbox-components.py` too; exact versions and earlier inspection commands are in [the supporting package report](../xbox-supporting-packages.md). Building without those optional indexes reports only the evidence actually present. The database is replaced only after successful import; staged publication preserves the previous database on failure. The authoritative summary is inside SQLite (`status`); the JSON summary is a mirror and its directory entry is updated separately.

The builder imports the generated PRI, XBF, typed-signature and control-flow reports when present and validates their provenance bindings. It does not silently create missing detailed passes. Compare `status` with the coverage above after rebuilding; each chapter records its own supported grammar and limits. These commands build reference artifacts, not a new xboks application release.

## Search an implementation question

```sh
python3 scripts/analysis/xbox-reference-library.py status
python3 scripts/analysis/xbox-reference-library.py search StoreGameDetailsRoute
python3 scripts/analysis/xbox-reference-library.py search XboxSettings
python3 scripts/analysis/xbox-reference-library.py search IConsoleManager
python3 scripts/analysis/xbox-reference-library.py function 53005
python3 scripts/analysis/xbox-reference-library.py function 64026
python3 scripts/analysis/xbox-reference-library.py function 48358
python3 scripts/analysis/xbox-reference-library.py module 0
python3 scripts/analysis/xbox-reference-library.py files GamepadNavigation

# Exact-key lead for the Greek View game details label and declared qualifiers:
python3 scripts/analysis/xbox-reference-library.py resource \
  Resources/MyGameListItem_ContextMenu_ViewGameDetails --language EL-GR

# Named native title-bar control; retain the native host/member identity:
python3 scripts/analysis/xbox-reference-library.py xbf MinimizeButton --member TitleBar.xbf

# Actual decoded native signature and parameter metadata:
python3 scripts/analysis/xbox-reference-library.py member EnumerateConsolesAsync
python3 scripts/analysis/xbox-reference-library.py member SetPlatformStoreAccountAsync

# Full annotated bytecode for one exact function, including literal references:
python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def --function 53005
```

Search is read-only and treats the query as literal text. Function IDs and offsets are build-specific. A string occurrence is a lead; inspect the instruction and its role before claiming a control uses it. A closure reference is not an executed call. Module dependencies are declarations/patterns, not a complete runtime graph.

`resource --language` filters declared candidates; it does not implement Windows qualifier ranking or prove the key is visible on a particular screen. `xbf` returns persisted operations, not an instantiated render tree or main-shell geometry. `member` returns metadata contracts, not executed native methods. Use the [menu](menu-behavior-traces.md) and [settings](settings-behavior-traces.md) traces to connect selected original controls to bounded guards, actions and destinations before changing the app.

## Verification before an xboks change is accepted

1. Locate the original control/state in screenshots, a targeted function trace or a native declaration. Record the evidence level separately.
2. Map it to the correct product/account/install identity and renderer → preload → main → provider contract. Do not use title searches where an exact product ID exists.
3. Implement capability checks and real state changes through the existing backend/platform adapter. Preserve launch/entitlement guards.
4. Test interaction ownership: opening action, menu close, Escape/B, focus restoration, Back destination, scroll preservation and cancellation/error states.
5. Capture the same 1920×1080 state and compare geometry, fonts, assets, icons and selected/focus states. Dynamic artwork/account differences need explicit, justified masks.
6. Keep Windows behavior observation and Linux end-to-end success distinct. Unsupported Reviews, subscriptions or streaming cannot pass because a placeholder was rendered.

```sh
python3 scripts/ui/compare-reference.py path/to/original.png path/to/xboks.png \
  --output work/reference/comparisons/game-details
```

The comparator rejects different capture sizes and never resizes silently. It emits exact differing-pixel counts, RGB error and a diff image; it deliberately does not label an app "100% identical". Its result verifies pixels only, not functionality.

Contract locator validation freshly decodes the 73 cited menu functions and checks 548 instruction references against the pinned bundle/opcodes, alongside the UI registry. This verifies locators, not semantic conclusions. Optionally add `--screenshots /path/to/local/screenshots` to verify all image hashes/dimensions:

```sh
python3 scripts/analysis/validate-reference-contracts.py
```

The current analysis/comparison suites contain **111 passing synthetic tests**: 8 base-inspection, 12 library, 16 function-evidence, 12 control-flow, 12 PRI, 20 XBF, 14 WinMD-signature, 13 contract-validator and 4 image-comparison tests. They validate readers, provenance, bounds and comparison behavior; they are not 111 verified Xbox features or an application end-to-end run.

```sh
python3 scripts/analysis/test-inspection.py
python3 scripts/analysis/test-reference-library.py
python3 scripts/analysis/test-reference-contracts.py
python3 scripts/analysis/test-xbox-function-evidence.py
python3 scripts/analysis/test-hermes96-control-flow.py
python3 scripts/analysis/test-pri-resources.py
python3 scripts/analysis/test-xbf-resources.py
python3 scripts/analysis/test-winmd-signatures.py
python3 scripts/ui/test-compare-reference.py
```
