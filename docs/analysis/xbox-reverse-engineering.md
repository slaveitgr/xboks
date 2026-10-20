# Xbox app reverse-engineering dossier

Reference builds: **Microsoft.GamingApp 2610.1001.20.0 x64** and **Microsoft.XboxGamingOverlay 7.326.10141.0 x64**. This dossier covers static package, binary and bytecode inspection, screenshot analysis and an implementation mapping for xboks. It is not a claim to have recovered the original source code or reproduced every server-dependent behavior.

## 1. What was actually inspected

| Layer | Completed inspection | What it establishes |
| --- | --- | --- |
| MSIX/APPX bundles | Manifests, identities, architecture packages, file inventories, ZIP CRC | Which exact application and packaged components are present |
| Xbox Hermes bundle | All string-table entries, function headers, instruction boundaries and explicit string/function references | Recoverable names, section structure and bounded instruction indexing |
| Native images | PE headers, file-backed sections and ordinary import DLL tables for all 94 Xbox and 19 Game Bar PE files | Native dependency surface and managed-header presence |
| Visual references | Supplied 1920×1080 screenshots, shell/modal/card/panel geometry | The visible layout and observed selected/hover/loading/error states |
| xboks comparison | Current source, demo captures and existing input/runtime implementation | Concrete implementation gaps, independent of the original app's internals |

No downloaded Windows executable or bytecode was executed. No live Microsoft/Xbox service was probed using extracted strings. Package-internal code, strings, fonts and personal screenshots remain under ignored local reference storage. This report publishes measurements, short identifiers and aggregate observations, not a redistribution of the original app.

The screenshot inventory contains **34 supplied 1920×1080 references**. No contact names, profile photos or device identifiers from them are published.

Machine-readable aggregate results: [xbox-deep-summary.json](xbox-deep-summary.json). Original package identities/checksums: [Xbox inventory](xbox-package-inventory.json) and [Game Bar report](gamebar-7.326.md).

## 2. Hermes v96: verified decoding rather than a raw strings scan

The UI bundle is **19,267,652 bytes**. It uses the execution-form Hermes magic and bytecode version 96. The pinned **Hermes v0.13.0** format also declares version 96. The readers use its actual layout, not the current runtime's potentially changed bytecode definition:

- [BytecodeVersion.h](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeVersion.h)
- [BytecodeFileFormat.h](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeFileFormat.h)
- [BytecodeDataProvider.cpp](https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeDataProvider.cpp)
- [BytecodeList.def](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeList.def)

Results:

| Check | Result |
| --- | --- |
| Header length vs actual bytes | Match |
| Footer SHA-1 over preceding bytes | Match; this is file integrity, not a Microsoft signature check |
| Strings decoded with bounded storage references | **103,136**, including **11,047 UTF-16** strings |
| Function headers / name and bytecode bounds | **68,878** checked |
| Defined v96 opcodes | **206** |
| Instructions indexed across every function body | **2,541,891** |
| Instruction boundary / explicit string and function reference errors | **0** |
| Source maps in the x64 package | None found |

The new readers supersede the earlier raw printable-byte scan, whose results could concatenate unrelated packed strings. Explicit function references are references such as closure/function operands; they are **not a complete dynamic call graph**. Instruction indexing is not semantic decompilation: register data flow, asynchronous calls, native return values, computed styles and server responses still need additional analysis.

## 3. Fullscreen Experience is distinct from window fullscreen

The bundle has separate named functions for:

| Evidence | Function ID in this build | Interpretation |
| --- | --- | --- |
| `enterFullScreenAsync` | 12768 | Window fullscreen bridge wrapper; only five indexed instructions |
| `exitFullScreenAsync` | 12769 | Window fullscreen exit wrapper |
| `getInFullScreenAsync` | 12784 | Reads window fullscreen state |
| `getIsInFullScreenExperienceMode` | 22808 | Separate application/shell experience state selector |
| `getIsGarrisonSetAsFullScreenExperienceHome` | 22809 | Separate system-home integration state selector |
| `getIsFullScreenSupportedOnThisDevice` | 22810 | Separate capability selector |

The corresponding strings also include a Windows Settings deep link, `ms-settings:gaming-fullscreen`, and shell state/action identifiers. This corroborates the user's observation that Windows exposes system-level activation separately from ordinary window fullscreen. It does **not** show that invoking one of these strings is enough to configure a Linux gaming session.

### xboks behavior decided for this feature

**Fullscreen Experience remains a visible xboks feature.** Entering it requests fullscreen and explicitly activates the controller-focused input mode, resetting held input before activation and placing focus on an existing control. Pointer and keyboard remain usable. Leaving fullscreen clears the experience marker. The feature uses the same reference-facing shell; it does not create an unrelated second launcher.

A future distribution adapter can connect the experience to a dedicated gaming session, compositor and system-wide guide service. That adapter is a separate implementation layer, not a reason to remove the feature from xboks.

## 4. Controller input and focus model

Exact decoded function references give stronger evidence than screenshot appearance alone:

- Function 22196, `initGamepadNavigation`, indexes 129 instructions. It references polling mode management, focus-driven input defaults, scroll alignment/offsets, adaptive indicators, long-press delay and snap thresholds.
- Function 22435, `registerNativeGamepadButtonListener`, references an event emitter, a gamepad-button event and listener registration.
- Function 22343, `loadGamepadMappings`, includes platform-specific behavior. It should not be treated as a universal button map copied directly to Linux.
- Function 28112, `getIsGamepadConnected`, reads controller connection state separately from UI mode.

These observations support a model with **input mode + focus ownership + scrolling policy + native controller events**. They do not reveal tested physical-device mappings, default numeric thresholds, OS-reserved Guide behavior or every long-press interaction.

### Implementation consequences

1. FSE activation explicitly enters the existing gamepad focus engine, not just the Fullscreen API.
2. A/B/X and shoulder inputs remain neutral-armed and edge-triggered; held A must never launch something when the mode opens.
3. The visible modal owns input. Guide/Settings shoulder buttons switch its sections; they must not navigate the page behind it.
4. Back closes the deepest menu/dialog before returning to another page. Focus returns to its originating control.
5. Scroll follows focus visibility; right stick scrolls within the owning region. Physical controller, Steam Input and Wayland/X11 validation are still required.

## 5. Routes, collections and Home data

The decoded strings contain route-like entries for Home, library, Game Pass, Store, game details, install queue and social pages. Route strings establish application vocabulary; they do not guarantee that every route is reachable for every account or flight.

The bundle also contains collection/gallery builders and a collection service, as well as SIGL/SFDS-related identifiers. There are **157 function-name matches** in the collection taxonomy used by the local index. This is evidence that Home/Game Pass are data-driven collection surfaces, not static hard-coded card layouts. Taxonomy matches are heuristic and include shared/library code.

For xboks, collection data must be separate from:

- Local installations and recent play history.
- Account entitlement/owned-library data.
- Editorial/promotional collections.
- Product detail data and installable package metadata.

The current Home's general Store data does not establish a genuine Game Pass editorial feed. Replacing it with screenshot product names or fixed subscription counts would produce visual demo data, not the original behavior. The next data-layer work is a verified collection provider and direct product navigation from cards.

## 6. Settings and capability gates

Decoded settings names include account, general/application, audio, accessibility, notifications, install options and about, plus development, experimental, mobile and cloud-related entries. The screenshots establish the user-visible categories for this build. Extra strings/functions may belong to feature flights or shared code and must not automatically become visible tabs in xboks.

The general-settings function references compact-mode and battery display settings; screenshots show disabled startup controls while Xbox mode is active. Thus controls have state/capability conditions, not just fixed button shapes.

xboks currently integrates account actions and the functional Nexus backend/Proton/storage/download controls into the reference-sized modal. Accessible selection/focus, unsaved-form confirmation and nested modal ownership remain part of the behavior contract. Unavailable notifications, subscription billing details and third-party integrations are explicit gaps, not silently simulated.

## 7. Native application boundary

All **94 PE files** in the Xbox x64 application were parsed for headers, ordinary import descriptors and section bounds with **zero parse errors**. All **7 executable images** lack a CLR header. That indicates native executable hosts; it does not exclude embedded managed components elsewhere.

The package separates launcher, tray, full-trust/admin, party-chat and Game Bar widget hosts. The ordinary import surface includes Win32/COM/WinRT/runtime dependencies. Import metadata alone cannot reconstruct all dynamically loaded libraries, COM activation, delay-loaded APIs or native-service protocols.

**Linux mapping:** retain the existing backend and managed game runtime for game/account/package operations, implement the UI independently, and expose a narrow Linux platform bridge for session, audio, capture and guide operations. Do not treat a Windows PE host as a drop-in Linux service.

## 8. Xbox Game Bar boundary

All **19 Game Bar PE files** were inspected with **zero parse errors**. The package declares overlay hosting, capture/background recording, audio/media and full-trust capabilities. Those are Windows integration contracts, not portable implementations. The Xbox app's separate widget host also explains why one package cannot be assumed to contain the whole observed guide experience.

The first xboks guide is an in-app modal. PipeWire volume/mute and xboks-window PNG capture are implemented. External-game overlay, video recording, microphone/app routing and Xbox party/social services are not yet implemented. The planned distribution can provide those through a separate guide/platform service while the xboks UI uses the same interface.

## 9. Visual reconstruction contract

The detailed geometry and screen inventory remain in [windows-ui-spec.md](windows-ui-spec.md). Important rules derived from the supplied references:

- 68 px icon rail, neutral selected state and separate white controller focus.
- Centered pill search, clock/system region and real back behavior.
- Home: a main recent tile plus compact mosaic, a 2:2:1 editorial area and collection rows.
- Library/queue: shared tab strip, pill filters, selected filter chips and state-specific actions.
- Product detail: left actions/text, right wide media, age/content strip and lower tabs.
- Settings: 800×950 reference modal with a 230 px category rail, independent selection/focus and internal scrolling.
- Guide: upper icon tabs, left content panel, dimmed app and scoped input.

Current screenshots of xboks show structural progress, not 100% fidelity. Remaining deviations include Home history grouping, exact typography/assets, editorial data, Library/Store/detail layouts, social/notification panels and several settings categories. Proprietary Microsoft fonts and artwork are not copied into the distribution to conceal those gaps.

## 10. What “complete analysis” can and cannot mean here

Completed: the provided package inventories/manifests; every Hermes string and function header; every instruction boundary in the available JS bytecode; ordinary PE imports/header metadata for every packaged PE; the supplied screen/state inventory; and a code/data/native/UI mapping for xboks.

Not completed: semantic recovery of all 68,878 functions, native machine-code decompilation, a verified dynamic call graph, runtime observation of the original app on Windows, authenticated service behavior, undisclosed feature flags, all physical controller behavior or proof of feature/game compatibility. Those require additional targeted work. Neither a screenshot clone nor a static disassembly is a substitute for that validation.

## 11. Reproduce the analysis locally

The original Microsoft files and bulk decoded strings/code references are not committed. Obtain the same reference package locally, then run:

```sh
python3 scripts/analysis/inspect-xbox-package.py \
  work/reference/Microsoft.GamingApp.msixbundle \
  --output work/reference/package-inventory.json

python3 scripts/analysis/inspect-hermes96.py \
  work/reference/index.bundle \
  --private-output work/reference/hermes96-decoded.json

# BytecodeList.def must be from facebook/hermes tag v0.13.0 (v96).
python3 scripts/analysis/index-hermes96-code.py \
  work/reference/index.bundle \
  --metadata work/reference/hermes96-decoded.json \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --private-output work/reference/hermes96-code-index.json

python3 scripts/analysis/inspect-pe-metadata.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --output work/reference/xbox-pe-metadata.json

python3 scripts/analysis/test-inspection.py
```

The readers fail on incompatible bytecode versions, checksum/length mismatches and invalid bounds. Eight synthetic tests cover decoding, version/corruption/bounds rejection, jump opcode expansion, truncated instructions and non-PE rejection. These validate the readers' limited contracts, not complete equivalence with Microsoft's implementation.

## 12. Validation of the xboks FSE change

- TypeScript and renderer/Electron compilation pass.
- 150 renderer tests and 8 synthetic static-reader tests pass.
- An Electron demo smoke run with a synthetic standard controller verifies: fullscreen entry, explicit controller-focus activation, neutral-armed input, RB switching Guide sections, RB switching Settings sections, B closing each modal, and clearing experience state on exit.
- The smoke run does not verify a physical controller, compositor-reserved Guide keys, external-game overlays or a real game. Those remain separate acceptance checks.
