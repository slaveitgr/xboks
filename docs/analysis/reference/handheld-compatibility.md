# Handheld compatibility: original package contract

This targeted static analysis, dated 2026-10-21, identifies the handheld information sheet shown in the supplied reference photo. It covers the pinned Xbox Windows package, not an executed Windows session. Its rating describes Microsoft's Windows handheld assessment; it does not certify Linux, Proton, a particular GPU, or a working game installation.

The original Hermes bundle has SHA-256 `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. Function offsets below are relative instruction offsets within the indicated function. The ignored evidence directory is `work/reference/library/handheld/`; it contains bounded decoded instructions, the four original illustrations for local inspection, and 78 named English/Greek PRI candidates. Original images and resource dumps are not part of this chapter.

## Data and enum mapping

The consumer data path is **PCGAFD**, distinct from DisplayCatalog v7:

| Evidence | Proven contract |
| --- | --- |
| F10524, file offset 10598178, +3458/+3462 | Production base URL is `https://beige.xboxservices.com`, assigned to `basePcgaProdUrl`. |
| F11982 `productDetailsFDUrlBuilder`, file offset 10740904, +119/+124/+128 | Joins `pcgafd/productdetailspage` and the product ID. |
| F11982 +153–223; F11960 `pcgaRequiredParams` | Query includes market, language, appVersion, productKind, deviceFamily and architecture `x64`; catalogId is optional. |
| F20922 `storeProductDetailsRouteFactory`, file offset 11652348, +26/+30/+53 | Uses version `2.0`, operation `gameDetails-call`, and `productDetailsFDDataMapper`. |
| F20945 `defaultFDRequestFactory`, file offset 11653779, +165–188; F20921 +1318 | Sets `X-MS-API-Version` and uses the original `FDAuthenticator` client. This analysis did not reproduce its authentication or call this endpoint. |
| F21035 `productDetailsFDDataMapper`, file offset 11664121, +1549/+1577 | Reads raw response **`hhVerified`**, then invokes `mapHandHeldVerified`; +1987 writes `productHandHeldVerified`. |
| F52673 `useProductHandHeldVerified`, file offset 16345874, +57/+112 | Normally uses the FD selector. The catalog developer environment instead reads `handHeldVerified` from `useProductDetails`. These spellings belong to different layers. |

The enum declarations in F21089, file offset 11674142, and explicit validation branches in F21084/F21085 establish these values:

| Raw result | Original enum | Meaning for the UI |
| --- | --- | --- |
| 0 | `Unknown` | No positive or negative compatibility claim. |
| 1 | `Verified` | Handheld optimized in the Windows assessment. |
| 2 | `Unsupported` | Unsupported in that assessment. |
| 3 | `Playable` | Mostly compatible, with usability qualifications. |

F21084 `mapTestResult` starts at file offset 11673228. Its branches at +23, +30, +37 and +44 recognize only those numeric values. Other values and nonnumeric inputs return undefined; they must not silently become Verified.

| Raw device test | Original enum | Criterion, summarized |
| --- | --- | --- |
| 0 | `DefaultsWork` | Default controller configuration works. |
| 1 | `Iconography` | Appropriate Xbox/handheld controller prompts. |
| 2 | `TextInput` | Controller-friendly text entry / on-screen keyboard. |
| 3 | `UILegibility` | Readable text and interface at handheld size. |
| 4 | `SupportedDisplay` | Compatible display resolutions. |
| 10 | `Unknown` | No recognized criterion to claim. |

These five areas also match Microsoft's published [Handheld Compatibility guidelines and test cases](https://learn.microsoft.com/en-us/gaming/gdk/docs/gdk-dev/pc-dev/handheld/handheld-guidelines-and-testcases?view=gdk-2604). That documentation describes controller defaults, appropriate prompts, text entry, readable interfaces and supported display modes; it does not constitute a Linux/Proton test result.

F21085 `mapDeviceTest` starts at file offset 11673363. F21086 `mapDeviceResultsArray`, file offset 11673560, reads each row's `deviceTest`, `testResult` and optional `testTimestamp` (+109/+118/+124), validates the two enums, and builds the mapped array (+263/+271/+279). F21087 `mapHandHeldVerified`, file offset 11673878, returns the original UI object only when evaluation is recognized and the mapped results array is nonempty (+90–115). This strict original client rule does not prove that every other Microsoft public surface returns the full criteria array.

Preserve the distinction between absent metadata, an explicit Unknown result, a recognized rating without criterion rows, and complete criterion evidence. A published rating alone is insufficient evidence for five green checks. Existing app `installability` describes its package/install route and cannot substitute for this metadata.

## Named English and Greek resources

The resource bindings are decoded PRI candidates, not arbitrary printable-string matches. The English PRI hash is `78a42a66075967e67322f2abfdf1770193c1c78c73054969b79177c77bc356a4`; Greek is `0fcec9a0e8eeda790c3f8e248a911408ce50dc54415138c6c062d880b4793444`. Language qualifiers are `EN-US` and `EL-GR`.

The title is `Resources/HHVModuleTitle`. Verified/Playable/Unsupported/Unknown subtitles use `HHVModuleSubtitleCompatible`, `HHVModuleSubtitleMostlyCompatible`, `HHVModuleSubtitleNotCompatible` and `HHVModuleSubtitleCompatibilityUnknown`. Summary paragraphs have the corresponding `HHVModuleSummaryText*` keys. The headline family is `HHVSummary*`; it has separate usability, performance, unknown and works-well states.

The five criterion label families are:

- `HHVModalCompatibilityListDefaultsWork{Compatible,MostlyCompatible,NotCompatible}Label`
- `HHVModalCompatibilityListIconography{Compatible,MostlyCompatible,NotCompatible}Label`
- `HHVModalCompatibilityListTextInput{Compatible,MostlyCompatible,NotCompatible}Label`
- `HHVModalCompatibilityListUILegibility{Compatible,MostlyCompatible,NotCompatible}Label`
- `HHVModalCompatibilityListSupportedDisplay{Compatible,MostlyCompatible,NotCompatible}Label`

F55794 dispatches by device test; F55795–F55799 choose each result-specific label. In each of those latter functions, +172 accesses the Compatible key, +106 the MostlyCompatible key and +139 the NotCompatible key. F57206/F57207 render provided `deviceResults` in their array order and suppress rows whose result is Unknown. The photo's five positive rows are therefore data-driven, not an unconditional explanation list.

The action keys are `HHVModuleMoreDetails`, `HHVModalCloseButtonLabel`, `HHVModalGotItButtonLabel` and `HHVModalContinueAnywayButtonLabel`. F57202 accepts `ctaButtons`; it does not establish that every entry point should run the same install action. F57201 dismisses `hhvModalId`, and F57203 opens that modal with productId and caller-supplied CTAs. Keep an informational opening separate from an install warning/continue flow.

## Visuals and layout

All four large illustrations are under `Bundle/assets/src/windows/app/assets/` in the original x64 package:

| Asset | Native size | SHA-256 |
| --- | --- | --- |
| `hhvCompatible.png` | 376 × 395 | `a7bc10023b516d9459a82d442e21d6cf35273f6b1d9e0d6f62f5d61dce4e6572` |
| `hhvMostlyCompatible.png` | 1362 × 1363 | `da7d8d741b94959b459c9cceff1141d57cfd0f07bb78953fec96cf5df40c8ce8` |
| `hhvNotCompatible.png` | 341 × 337 | `24eb6007785117af3948dffce18b89c4b6264292ab70cf738a8a6639c86e471c` |
| `hhvCompatibilityUnknown.png` | 341 × 337 | `2c739d556e5a5004458f2fedba491b3bfeef558a9240ea3a3bb1453bdf7c1ce3` |

The compatible illustration visually matches the photo's green handheld with a circular check. F55806–F55809 register the images. The smaller status glyphs are `HandheldVerifiedPlayable.svg`, `HandheldVerifiedLimited.svg`, `HandheldVerifiedNotRecommended.svg`, and `HandheldVerifiedUnknown.svg` under `Bundle/assets/node_modules/%40gaming/xds-foundation/svg/`. F55791 maps **Verified to the glyph named Playable**, and Playable to the glyph named Limited; asset names alone are not result semantics.

F57200 `useStyles`, file offset 17096085, has a full-size wrapper (+210) and a two-column flex row (+244), with horizontal padding 48, vertical padding 90 and gap 48. The left column is centered (+344); the right column has flex 1. CTA layout is a row with gap 8 and top margin 42 (+493). The close control is positioned at the top right with a theme focus margin. F57202 renders a `GamepadScrollView` on the right and `HHVSummary` with details enabled. These constants describe this pinned package, not a guarantee for every window size or future build.

F55788 `getImageByDeviceEvaluationAndPerfFitTier`, file offset 16857619, selects Compatible for Verified except when performance fit is Poor; that exception selects MostlyCompatible. Playable uses MostlyCompatible, Unsupported uses NotCompatible, and Unknown uses CompatibilityUnknown. F57200 renders the positive illustration at 375 × 394, the mostly-compatible cases at 400 × 400, and the remaining cases at 405 × 400.

## Performance is a separate input

F21088 maps `minimumHardwareTier30Fps` and `minimumHardwareTier60Fps`. F57202 +133–160 combines those game tiers with the original Windows GPU hardware tier through `getPerfFitTierByGPUAndGameTiers`. F55803–F55805 combine compatibility and performance into the headline. F57208 renders compatibility while F57209 renders a distinct performance section.

The Windows GPU-tier model is not a Linux benchmark. Without a validated cross-platform performance source, the app should retain a separate unknown performance state and omit predicted framerates. Likewise, Microsoft handheld metadata should retain its source attribution and must not become a green Linux/Proton verification badge.

## Implementation boundary and verification

`CatalogService.gameDetails` now performs optional public Xbox web metadata enrichment from `https://emerald.xboxservices.com/xboxcomfd/products/{id}?locale=en-US` (the locale follows the requested market). It sends `X-MS-API-Version: 1.0` and a fresh anonymous `MS-CV` correlation vector, with credentials omitted and redirects rejected. This is a different public route from the original authenticated beige PCGAFD client above. Requests have an eight-second timeout and a two-MiB body limit; enrichment failure preserves the existing game details.

The parser accepts only one matching product ID with `productKind: Game` and a recognized numeric `hhVerified.deviceEvaluation`. It retains `source: microsoft-catalog`, `platform: windows-pc` and the raw rating. Optional `deviceResults` rows require known criterion/result enums; ambiguous duplicate criteria become Unknown. It never borrows a bundle child's result or invents criterion success from the overall rating.

The live read-only probe on 2026-10-21 returned HTTP 200 from both DisplayCatalog and public Emerald for Clair Obscur: Expedition 33, product `9PPT8K6GQHRZ`. The integrated result contained raw rating 1 (optimized) and ten screenshots. The public response supplied no individual criterion results. The sanitized local record is `work/handheld-compatibility/catalog-live-probe.json`. This proves that bounded public metadata retrieval worked for that product at that time; it is not proof of complete catalog coverage or game compatibility on Linux.

The implemented information sheet keeps the overall badge and illustration separate from its five criterion rows. Individual results appear only when explicitly supplied; missing and Unknown results use neutral presentation. No performance-fit or FPS prediction is derived. The local reference-kit extractor can optionally place the four original handheld PNGs in ignored assets for a local build; the renderer provides a source SVG fallback when they are absent.

This investigation used the existing bounded Hermes decoder, literal-buffer reader, package inventory hashes and named PRI candidate index. It did not execute Windows binaries, authenticate to PCGAFD, test a physical handheld, or measure gameplay. The catalog implementation's separate public probe used no account authentication. The original authenticated route remains static evidence, not a promise of authenticated service access.

For a local reproduction, rebuild the existing [reference library](README.md), then inspect function IDs 21084–21089, 55788–55809 and 57200–57210 with `python3 scripts/analysis/xbox-reference-library.py function FUNCTION_ID`. The SQLite `resource_candidates` table binds the `Resources/HHV%` keys to their `EN-US`/`EL-GR` candidates; `files` binds illustration paths to package hashes. Inspect the ignored detailed reports only in the analysis workspace.
