# Native XBF resources: decoded controls, styles and state transitions

Input: the eleven `.xbf` members in **Microsoft.GamingApp 2610.1001.20.0 x64**. This pass decodes their persisted metadata and object-writer operations; it does not execute Microsoft code, instantiate XAML, render a window, evaluate bindings, or recover native event-handler implementations.

The result is more than a string inventory: **2,602 operations across 46 substreams**, with typed property/constants, named controls, deferred template references, style setters, theme dictionaries and visual-state data. All eleven files use **XBF 2.1**. Every node stream was consumed without an unsupported opcode or truncation. This bounded stream result is not complete semantic recovery or a full UI equivalence claim.

## Format and provenance

The independent Python reader follows Microsoft's public WinUI source pinned to commit **`a5d85af03fa5c3597856fc5d17efb167d68a076b`**, using these primary references:

- [Native metadata layout and XBF versions](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/core/inc/XamlBinaryMetadata.h)
- [Native object-writer opcode values](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/core/inc/ObjectWriterNodeType.h)
- [Native object-writer stream reader](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/core/Parser/xamlbinaryformatsubreader2.cpp)
- [Microsoft's standalone metadata reader](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/XBF/XbfMetadata.cs)
- [Microsoft's node operands](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/XBF/XbfNode.cs), [constant/reference encoding](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/Reader/XbfReader.Utilities.cs)
- [Style setters](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/XBF/StyleCustomRuntimeData.cs), [dictionary key/token maps](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/XBF/ResourceDictionaryCustomRuntimeData.cs), [visual-state blocks](https://github.com/microsoft/microsoft-ui-xaml/blob/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XbfParser/WidgetSpinner/XBF/VisualStateGroupCollectionCustomRuntimeData.cs)

The reader verifies the magic, supported version, exact file/section lengths, metadata table offsets, UTF-16 lengths/terminators, vector limits, table references and substream bounds. It preserves file and substream offsets for each operation. Unknown nodes stop that substream with an explicit error; the reader never scans onward and labels arbitrary bytes as recovered controls. Serialized resource-key tokens are checked against decoded node boundaries in their referenced substreams.

The 64-byte compiler hash field is retained **uninterpreted**, not asserted to be a verified digest/signature. Archive-member SHA-256 and package SHA-256 identify the actual input bytes. Stable type/property names are resolved through hash-pinned Microsoft CSV tables. These tables describe a newer public WinUI source revision, not the exact packaged Windows runtime; raw trusted IDs remain in every result. Some historic IDs are marked `Deleted` in the newer table, so those labels must not be mistaken for a disabled/deleted control in the inspected older app.

Each resource entry in `summary.json` also includes `report_sha256`, binding the exact UTF-8 bytes of its decoded JSON report. Importers must verify this hash before accepting nodes; checking only the copied raw XBF hash would miss a changed or stale decoded value. These hashes provide integrity/provenance checks, not an independent proof of the parser's semantics or a Microsoft signature.

## Critical surface distinction

The decoded peer checks and custom type namespaces identify **`XboxPcTrayUI`** components: `MenuControl`, `TitleBar`, `RecapView`, `SessionRecapView`, `SessionReviewView`, `GameEventsView`, and related controls. This establishes native tray/recap UI in the package. It does **not** establish that the main React Native Home, 68-pixel navigation rail, Settings modal, or Game Bar uses these same dimensions or templates.

For example, the native menu's 200 × 25 button style is real, but applying it to the main Xbox-mode rail solely because its name contains Menu would be an incorrect reconstruction. Match the component and its hosting surface before using a recovered value.

## Decoded resource coverage

| Member | Bytes | Substreams | Decoded operations |
|---|---:|---:|---:|
| AchievementsRecapView.xbf | 3,349 | 1 | 235 |
| CapturesRecapView.xbf | 867 | 1 | 15 |
| GameEventsView.xbf | 2,256 | 1 | 154 |
| ImageBox.xbf | 864 | 1 | 20 |
| MenuControl.xbf | 4,003 | 7 | 373 |
| RecapView.xbf | 2,332 | 1 | 200 |
| Resources.xbf | 10,104 | 30 | 1,058 |
| SessionRecapView.xbf | 1,930 | 1 | 112 |
| SessionReviewView.xbf | 3,951 | 1 | 315 |
| SvgIcon.xbf | 1,038 | 1 | 17 |
| TitleBar.xbf | 1,728 | 1 | 103 |

Together these contain 375 metadata string entries, 24 encountered opcode kinds, and 30 decoded custom blocks: **20 Style_v2, 5 ResourceDictionary_v3, 5 VisualStateGroupCollection_v5**. Resource dictionaries contribute 145 explicit/implicit key-to-node locators, retaining duplicate keys across dictionaries/themes rather than flattening them into a single global value.

The following findings cite **decimal file offsets inside the named XBF member**, not package offsets. Numeric dimensions are authored XAML values, not verified pixels at every Windows display scale.

## Title bar and native menu

`TitleBar.xbf` contains named `DragBar`, `Title`, `ButtonBar`, `MinimizeButton` and `CloseButton` objects. Direct assignments recover:

- Root height **32** at offset **1245**; black background and a one-unit bottom border at **1273/1281**.
- Minimize button width/height **44/32** at **1556/1564**; its icon is **16 × 16**, with `Assets/Svg/Minimize.svg` assigned at **1591**.
- The close button is separately named at **1638** and has corresponding width/height/icon assignments later in the same stream.
- Resource-backed typography comes from `Resources.xaml`; the title uses `Subtitle3` at **1434**.

This identifies actual control names and properties. It does not recover the handlers that minimize/close the native host or prove whether this title bar appears in the supplied main-app screenshots.

`MenuControl.xbf` checks its peer type as `XboxPcTrayUI.MenuControl` at **2508**. It creates an MRU header/list and named buttons for Home, Game Pass, Library, Cloud Gaming, Store, queue, profile and quit. These are typed `Button` nodes plus names/connection IDs, not disconnected words from a string scan.

The menu dictionary at **2583** maps `MenuButtonStyle` into substream 1 at token 7. Its style block at **3451** sets width **200**, height **25**, horizontal content alignment, foreground/background resource references and a template token. Separate glyph/separator styles and the font resource references are decoded too.

The menu's visual-state block at **3740** names two groups: `CommonStates` and `FocusStates`. It includes `Normal`, `PointerOver`, `Focused`, `Unfocused`, and `PointerFocused`, with deferred storyboard/setter tokens. This is direct evidence that pointer and focus appearance are separate state paths. It is not proof that selecting any of these buttons opens a specific main-app route; that still requires the code-behind or observed navigation result.

## Typography and glyph/font pairing

The root resource dictionary in `Resources.xbf` at **4760** points to substream 1 and contains named font, text, icon and button resources. Each key resolves to an actual node boundary. Two recovered font values are:

- `SegoeSansText` → `Assets/Fonts/Segoe-Sans-Text.ttf#Segoe Sans Text`, at resource node **5394**.
- `SymbolsFontFamily` → `Assets/Fonts/XboxFluent.ttf#Xbox Fluent`, at **5401**.

The second font is **XboxFluent**, not XboxFluent2 or a Game Bar font. The associated native menu glyph constants are Home `E957`, Game Pass `E7A5`, Library `EA88`, Cloud Gaming `E94F`, Store `EA06`, Download `E98E`. A codepoint without its font and surface identity is not a usable icon specification. Preserve that pairing when comparing or implementing these native surfaces; do not substitute this table for the main app's separately established icon system.

The text resources below are actual `Style_v2` setter payloads, reached through the resource dictionary tokens. Sizes and line heights are authored values:

| Resource | Font size | Line height | Weight | Resource node offset |
|---|---:|---:|---|---:|
| Title1 | 26 | 32 | SemiBold | 5474 |
| Title2 | 20 | 24 | SemiBold | 5521 |
| Title3 | 14 | 18 | `700` | 5568 |
| Title4 | 14 | 20 | Bold | 5623 |
| Subtitle1 | 20 | 24 | Normal | 5670 |
| Subtitle3 | 14 | 18 | Normal | 5717 |
| Body | 16 | 24 | Normal | 5764 |
| Legal | 12 | 16 | Normal | 5811 |
| Label | 14 | 18 | SemiBold | 5858 |
| Display1 | 40 | 48 | SemiBold | 5905 |
| Section1 | 40 | 48 | SemiBold | 5952 |

These styles retain resource-based foreground references. The decoder does not collapse the effective brush/font/template after inheritance or resource lookup.

## Button templates and theme state

`LabelButton`, `PrimaryLabelButton`, and `SecondaryLabelButton` declare height **32** at their style blocks reached from resource nodes **6077/6124/6171**. The first two have horizontal padding **16**, while the secondary style's padding is zero. They refer to separate template substreams; the decoder follows the token location without instantiating a control.

`Resources.xbf` contains visual-state blocks at **6528**, **7005**, **7484**, and **7957**. The first three declare `Normal`, `PointerOver`, `Pressed`, `Disabled`; the fourth declares Normal/PointerOver/Pressed for the game-card template. Setter target names such as `Rect.Background` and `ContentPresenter.Background` resolve to different theme resources for each state. This provides concrete state-dependent styling behavior; it does not assert which state is active in a particular screenshot.

The root dictionary adds theme dictionaries named **Default**, **Dark**, and **HighContrast** at **5030/5190/5352**. Default/Dark use these explicit values for the sampled native controls:

| Key | Encoded ARGB | Dark color assignment offset |
|---|---|---:|
| FillBrush | `#FF2C2C2C` | 8928 |
| StrokeBrush | `#FF3E3E3E` | 8944 |
| ForegroundText | `#FFFFFFFF` | 8960 |
| RegularButtonBackground | `#FF3E434B` | 9120 |
| RegularButtonBackgroundActive | `#FF4E535B` | 9136 |
| RegularButtonBackgroundPressed | `#CC4E535B` | 9152 |
| RegularButtonBackgroundDisabled | `#663E434B` | 9168 |
| PrimaryButtonBackground | `#FF007738` | 9264 |
| PrimaryButtonBorder | `#FF008746` | 9344 |

HighContrast instead retains system resource references, including `SystemColorWindowColor`, `SystemColorHighlightColor`, and `SystemColorButtonTextColor`. Their effective colors depend on Windows theme state and must not be reported as fixed recovered RGB values. This is also why a single dark screenshot cannot specify every control state.

## Recap, events and reusable visual controls

- `RecapView.xbf` authors an **908 × 592** view at **1459/1467**, resource-dictionary inclusion, background image/gradient layers, game icon/title, last-played description/value, and a recap-content container. Gradient stops, opacity, padding and margins are typed constants.
- `SessionRecapView.xbf` authors **816 × 360** at **1407/1415**, with header/description, `ViewInAppButton`, and `RecapsContainer`. This gives the native recap component structure; its actual game/session data and button destination come from code-behind.
- `AchievementsRecapView.xbf` authors **264 × 264** at **2085/2093** and exposes named gamertag/date, time played, gamerscore, total/rare achievements, game logo/name and a background image. The names establish fields, not actual player achievements or service results.
- `GameEventsView.xbf` authors **816 × 360** at **1499/1507**, with event title/duration/description, image, and a View in app action. It is not evidence of the Store editorial service schema.
- `SessionReviewView.xbf` has separate feedback/recommendation grids, both **816 × 360**, with Like/Dislike/Next controls, previous/next buttons, and a game-card scroller. The stream alone does not recover the rule that chooses a grid or records a review.
- `SvgIcon.xbf` declares a Win2D `CanvasControl` named Canvas and a clear color **`#00FFFFFF`** at **1005**; its source/fill are custom properties supplied elsewhere. It is not a pre-rendered bitmap icon.
- `ImageBox.xbf` creates named root/background containers; `CapturesRecapView.xbf` creates a horizontal image container. Their image population logic is outside the decoded markup.

## Reproduce and inspect

From the repository root, the local format source directory already contains the pinned files and their source/hash manifest. For a new analysis machine, the two required stable tables can be downloaded as inert text from the pinned official revision:

```sh
mkdir -p work/reference/library/xbf/source
curl --fail --location \
  https://raw.githubusercontent.com/microsoft/microsoft-ui-xaml/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XCPTypesAutoGen/XamlGen/StableXbfTypeIndexes.g.csv \
  --output work/reference/library/xbf/source/StableXbfTypeIndexes.g.csv
curl --fail --location \
  https://raw.githubusercontent.com/microsoft/microsoft-ui-xaml/a5d85af03fa5c3597856fc5d17efb167d68a076b/dxaml/xcp/tools/XCPTypesAutoGen/XamlGen/StableXbfPropertyIndexes.g.csv \
  --output work/reference/library/xbf/source/StableXbfPropertyIndexes.g.csv

python3 scripts/analysis/inspect-xbf-resources.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix
python3 scripts/analysis/test-xbf-resources.py
```

Only Python's standard library is needed. The parser rejects mismatched stable-table hashes. It reads archive members without extracting their paths and emits private JSON under ignored `work/reference/library/xbf/`:

- `summary.json`: package hash, format/table provenance, member hashes and bounded decode counts.
- `NN-Name.xbf.json`: metadata, exact node offsets, values, custom blocks, deferred substreams, validated resource-entry locators, and any explicit decode errors.
- `source/`: pinned official format source and source/hash manifest from this investigation; source files are read as text, never compiled/executed.

Example local lookup of one recovered property or template uses the per-member JSON, with `archive_member`, `file_offset`, `stream_offset`, `operation`, `property`, `value`, `custom`, and `resource_entries` as evidence locators. A resource's `target_stream` and `target_node_index` locate its declaration. Reading its effective runtime value may still require resolving its template, theme, native converter, application property or binding.

Validation: **20 synthetic reader tests pass**, including metadata versions/UTF-16, exact typed constants, style and visual-state custom data, resource token boundaries, line-stream bounds, invalid references, corruption, unknown-node rejection, pinned-table hashes and exact decoded-report hash binding. The real eleven-member pass consumed 2,602 nodes with zero stream-decode errors. No rendered Windows/native UI, Linux recreation, callback execution, live service response or full application navigation was tested by this pass.

## How to use the findings in xboks

1. Identify the host: tray/recap/native title bar versus main React Native application versus Game Bar.
2. Use exact resource key, numeric trusted ID, source font and node offset together; preserve theme/hover/focus/pressed/disabled distinctions.
3. Recreate the relevant control independently in React/Electron only after a screenshot/host trace confirms it belongs to the target surface.
4. Wire names/connection IDs to actual Linux actions through the existing adapter contracts. The markup does not implement native callbacks, data retrieval, social, subscriptions or streaming.
5. Verify behavior and same-state pixels separately. These results remove uncertainty about specific native values while leaving main-app bytecode, native handlers and runtime appearance as separate acceptance work.
