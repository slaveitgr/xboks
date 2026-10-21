# Native PRI resource evidence

The supplied Xbox and Game Bar packages now have a **bounded structural PRI reader**. It follows resource names through the schema, resource-map directory, decision/qualifier tables, candidate records and data-item references. This is different from a printable-string scan: every decoded value has an owning named resource, declared value type, qualifier set and byte offset.

Original names, translations, asset paths and binary values remain under ignored `work/reference/library/pri/` storage. This chapter publishes coverage and short examples; it does not redistribute those resource catalogs into xboks or claim complete native UI reconstruction.

## Format source

The format implementation is based on Microsoft's MRT Core source in **WindowsAppSDK commit `0cf06784786e1e18d25099ca1d2e3dbeefce677e`**, rather than inferred offsets from printable text:

- [FileBase.h](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/include/mrm/common/file/FileBase.h): container, table-of-contents, section headers and trailers.
- [HNamesSection.h](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/include/mrm/common/file/HNamesSection.h) and [HSchema.cpp](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/mrmmin/HSchema.cpp): hierarchical names, item indexes and schema identities/versions.
- [MrmFiles.h](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/include/mrm/common/file/MrmFiles.h) and [ResourceMap.cpp](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/mrmmin/ResourceMap.cpp): map directories/ranges/items, candidate locators and referenced data items.
- [DecisionInfo.cpp](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/mrmmin/DecisionInfo.cpp), [MrmConstants.h](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/include/mrm/platform/MrmConstants.h) and [MrmEnvironment.h](https://github.com/microsoft/WindowsAppSDK/blob/0cf06784786e1e18d25099ca1d2e3dbeefce677e/dev/MRTCore/mrt/mrm/include/mrm/MrmEnvironment.h): qualifier references, built-in qualifier names and declared string/path encodings.

These sources are used as format documentation. No Windows package code or MRT runtime is executed.

## Exact inspected coverage

All five PRI files in the supplied three architecture/language packages use `mrm_pri2` with container version 0.1. Their **74 sections** pass container/TOC/header/trailer and supported section-reader checks, with zero rejected structures or unsupported candidate locators in these inputs.

| Package / PRI entry | Schema item names | Mapped resource entries | Candidate values |
| --- | ---: | ---: | ---: |
| Xbox x64 / `resources.pri` | 6,337 | 6,101 | 44,613 |
| Xbox x64 / `Xbox.Web.Client.pri` | 0 | 0 | 0 |
| Xbox x64 / `Xbox.Web.pri` | 0 | 0 | 0 |
| Xbox Greek pack / `resources.pri` | Uses exact main-schema reference | 5,395 | 5,219 |
| Game Bar x64 / `resources.pri` | 1,315 | 1,315 | 2,504 |
| **Total** | **7,652 distinct input-schema item records** | **12,811** | **52,336** |

Every candidate-table index is referenced by a decoded named resource; there are **zero unreferenced candidate values** in these maps. The values contain **51,315 declared strings**, **866 declared paths**, and **155 embedded-data candidates**. Embedded data is recorded by byte size, offset and SHA-256; its binary format is not semantically decoded by this tool.

There are **156 Xbox-main mapped entries** and **176 Greek-pack mapped entries** with no candidate in that file. They remain empty. The reader does not fabricate a translation or choose an English fallback for them.

## Greek labels are bound through the resource tables

The Greek PRI intentionally contains an empty local schema section. Its resource map instead contains an external schema reference. The reader matches that reference against the supplied Xbox-main schema by **unique identity and the full version record**, including the stored schema checksum, scope count and item count. It does not match by row order alone or translated text. The stored checksum is compared; this reader does not recompute Microsoft's schema-checksum algorithm.

The resulting **5,219 Greek candidates** explicitly carry **`Language = EL-GR`**, preserving that exact casing and their raw qualifier/operator atoms, priority and fallback-score fields. Examples:

| Schema item index | Exact resource key | Greek candidate |
| --- | --- | --- |
| 729 | `Resources/Account` | Λογαριασμός |
| 3043 | `Resources/MyGameListItem_ContextMenu_ViewGameDetails` | Προβολή λεπτομερειών παιχνιδιού |
| 4275 | `Resources/Settings` | Ρυθμίσεις |

This enables an exact **key lookup** from a Hermes localization symbol such as `MyGameListItem_ContextMenu_ViewGameDetails` to `Resources/<symbol>`. The lookup does not establish which screen renders the symbol. That still needs the function/instruction evidence and the observed screen state. The main React Native UI, native tray UI and Game Bar must retain their separate ownership and namespaces.

The Xbox-main namespace is **`ms-appx://Microsoft.GamingApp/`**. Game Bar uses **`ms-appx://Microsoft.XboxGamingOverlay/`**. A matching suffix in those two namespaces is not proof that the resources are interchangeable.

## Qualifier handling

Decoded candidates preserve qualifier sets in their stored order. In the inspected inputs these include language variants, scale, target size, contrast, alternate form and theme. For example, main Xbox candidates include English regional language variants and distinct `WHITE`, `BLACK`, `HIGH`, `UNPLATED` and `LIGHTUNPLATED` values. The Greek pack carries `EL-GR`; the inspected Game Bar x64 PRI carries `EN-GB` and `EN-US` candidates, not a Greek localization pack.

The reader identifies built-in qualifier names only when their recorded atom-pool/index matches the pinned MRT constants. Unknown atoms remain numeric. It preserves raw operator/priority/fallback fields and does **not** implement Windows' qualifier ranking or decide which asset Windows would choose for the user's environment. An asset path alone does not establish its rendered size, placement, crop, color state or Linux filesystem location.

## Reproduce and query locally

```sh
python3 scripts/analysis/inspect-pri-resources.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  work/reference/XboxAppPackage_2610.1001.20.0_language-el.msix \
  work/reference/GameBar_7.326.10141.0_x64.appx \
  --private-output work/reference/library/pri

python3 scripts/analysis/test-pri-resources.py
```

The CLI accepts local PRI files or MSIX/APPX ZIP packages. ZIP entries are read with their CRC checks, without extracting arbitrary package paths. Supply the main Xbox package with the language pack so the schema reference can be resolved. A missing or mismatched reference remains explicitly unsupported. Structural failures produce error records and a nonzero exit status.

Private schema **1** output:

| File | Contents |
| --- | --- |
| `summary.json` | Format-source commit; all input PRI hashes/entry names; section inventory; decoded schemas/descriptors/decisions; per-map coverage; errors/unsupported records; JSONL SHA-256, byte and row binding. |
| `resources.jsonl` | One mapped resource per line: input PRI hash, map section, item index, exact key, decision index and candidate list. Candidates retain map/value byte offsets, declared type atom, qualifier set and either decoded string/path or embedded-data hash. |

The current JSONL contains **12,811 rows / 22,845,856 bytes**, SHA-256 `8efe2e779211de0303c6bfd71287fda5a31ae8fbd0c5e6b0c6ba1d20b0a8662a`. The parser performs no normalization of resource key or translation case. Readers should retain both the PRI hash and resource namespace when joining records.

Twelve synthetic tests cover genuine name→candidate→Greek string binding, missing/mismatched external schema checksums, malformed TOC/header/trailer data, name-parent/payload/pool references, unsupported large-name format, decision references, data-item/encoding bounds, external-file candidates and hash-bound repeatable output. They require no Microsoft package.

## Limits

Supported structures observed here are standard hierarchical nodes, extended name pools, schema references, resource-map v2 directories/items/candidates, decision qualifiers, PRI descriptors and small/large data-item records. Large hierarchical-name nodes, large resource-map directory/item extensions, explicit environment remapping, resource-link sections and external-file candidate resolution are explicitly unsupported if encountered. Descriptor references are parsed; deployment/activation behavior is not reproduced.

This work supplies trustworthy names, labels, qualifier alternatives and resource locations. It does not recover view layout from strings, decode embedded XBF/images automatically, prove that a flight/account can reach a screen, or replace dynamic Windows observation. xboks can use this evidence to fix localization, icons/assets and state labels while preserving the separate layout, behavior and Linux platform work.
