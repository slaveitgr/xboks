# Xbox 2610: function-level bytecode evidence

This chapter describes reproducible static evidence for the supplied **Microsoft.GamingApp 2610.1001.20.0 x64** package. It supplies function IDs, instruction offsets, literal values and relationships for implementing xboks. It does **not** claim complete source recovery, complete behavioral reverse engineering or a verified Windows-to-Linux port.

## Inputs and method

The input is the package's 19,267,652-byte `index.bundle`, Hermes execution-form bytecode **v96**. Its SHA-256 is `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. The matching local opcode definition has SHA-256 `62bfc95c5ab7d96bc58c31f1a9faa8772afb9500d5f87e541c8a3623645f1a85`.

The reader first validates the bundle using the existing bounded metadata reader, including its footer SHA-1. An optional decoded-metadata input must match freshly parsed metadata exactly. Footer integrity is not Authenticode verification.

Opcode order/types and operand annotations follow [Hermes v0.13.0 BytecodeList.def](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeList.def). Section alignment follows the pinned [BytecodeDataProvider.cpp](https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeDataProvider.cpp). Array and object literal buffers are decoded separately from instruction operands using the pinned [serialized-literal format](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/SerializedLiteralGenerator.h) and [generator implementation](https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/SerializedLiteralGenerator.cpp). Every read is checked against its owning buffer; nothing from the package is executed.

The previous instruction index retained one string operand per opcode. `CreateRegExp` contains two annotated string operands, so the new reader retains and validates both. More importantly, object keys, object values and array values often reference strings through serialized literal buffers. A search limited to instruction operands misses those sites.

## Coverage measured on this bundle

| Evidence | Count |
| --- | ---: |
| Functions decoded | 68,878 |
| Instructions decoded | 2,541,891 |
| Defined / actually used opcodes | 206 / 161 |
| Explicit instruction string-reference sites | 781,319 |
| Object-key string-reference sites | 95,735 |
| Object-value string-reference sites | 54,426 |
| Array string-reference sites | 11,386 |
| Decoded object-literal constructions | 18,291 |
| Addr-operand branch edges checked | 170,039 |
| Invalid instruction/string/function/literal/Addr-target results | 0 |
| Closure-creation references | 66,865 |
| Generator-body references | 2,012 |
| Direct-call opcodes in this bundle | 0 |
| Calls to a closure ID tracked within the same basic block | 4,660 |
| Property-to-closure assignments | 23,313 |

The aggregate includes **942,866 string sites**, rather than unique strings. A repeated use at another instruction is a distinct site. A literal's `buffer_offset` is relative to its owning literal buffer, while its `offset` is the construction instruction's offset within the function. Both matter when inspecting a shared literal buffer.

The branch check confirms that each decoded `Addr8`/`Addr32` operand lands on an instruction boundary in the same function. The producer additionally validates switch case targets before tracking local register provenance. The separate [control-flow audit](control-flow.md) records all **23 `SwitchImm` tables** and exception ranges/targets. Neither constitutes a complete semantic control-flow graph.

## Function and module relationships

The index deliberately distinguishes these relationships:

| Kind | What is established |
| --- | --- |
| `closure` | An instruction creates a closure for a particular function ID. It does not establish invocation. |
| `generator_body` | An instruction references a generator body. It does not establish immediate execution. |
| `direct_call` | The opcode explicitly names its callee function ID. No such opcodes occur in this input. |
| `local_closure_call` | A call's callee register contains a function ID created or copied within the same basic block. |
| `property_closure_assignment` | A known local closure is assigned to a named object property. It connects callback names to function bodies. |

For ordinary dynamic calls the index also records local provenance, such as an environment-slot property path. This is a symbolic expression, **not** a resolved source module or proven runtime callee. There are 272,164 ordinary call/construct sites; 249,268 have some local provenance and 22,896 remain unknown. Most provenance-bearing sites still lack an exact callee function ID. Registers are cleared at branch/block boundaries and `Catch` entries rather than guessing merged state.

The global function contains **7,725 constant `__d`/`Call4` module-registration patterns**, with 7,725 unique module IDs and factory IDs. Their dependency arrays declare **52,239 edges**, all targeting another registered module ID. The reader additionally records **50,937 factory dependency-call patterns** where a known factory calls its Metro-style require/import parameter with a constant dependency-array slot. A declaration alone is not proof of an executed import; a call pattern establishes bytecode structure, not authenticated service success. Dynamic imports and nested captured-environment import flows remain outside this limited resolver.

## Concrete UI findings

All offsets below are **relative to the named function**, in decimal. The query command below additionally prints absolute bundle offsets. These findings are directly recoverable; they do not depend on interpreting a string-table search as a complete implementation.

### Settings geometry is present in bytecode literals

The anonymous module factory **46838** starts at bundle offset **15,384,754**. Its style construction contains:

| Relative offset | Assigned style | Verified fixed values |
| --- | --- | --- |
| 913 | `container` | `width: 800`, `maxHeight: 950` |
| 1014 | `tabPane` | `width: 230`, column direction |
| 1091 | `tabButton` | `height: 36`, horizontal margin 10, horizontal padding 12 |

The following property assignment sites associate the literal constructions with those style names. This independently corroborates the 800×950 settings dialog and 230 px rail observed in the screenshots. **950 is a maximum height**, not an unconditional height at every viewport. A literal's `null` color/style field can be overwritten by a later theme-resource assignment; it must not be interpreted as the final rendered value.

### Settings tabs have separate handlers

In **46848 `_SettingsModal`**, named property assignments bind the selectors to separate closures:

| Assignment offset | Property | Target function |
| --- | --- | ---: |
| 318 | `selectAccountTab` | 46849 |
| 329 | `selectGeneralTab` | 46850 |
| 340 | `selectSubscriptionsTab` | 46851 |
| 362 | `selectNotificationsTab` | 46853 |
| 373 | `selectInstallOptionsTab` | 46854 |
| 428 | `selectAudioTab` | 46859 |
| 450 | `selectExtensionsTab` | 46861 |

The selector bodies reference the settings modal route, a tab-specific action and `currentTab`. The reconstruction contract therefore needs actual selection, route/state updates and rendered corresponding contents. The presence of additional mobile/developer/cloud selectors does not prove those tabs are visible in the supplied Windows configuration.

**48595 `_SettingsNotificationsTab`** separately binds catalog, wishlist-sale, wishlist-Game-Pass and wishlist-preorder toggles at offsets **165, 176, 187 and 198**. They must not be collapsed into one generic preference.

### Install menus are selected from operation state/capabilities

**64026 `useActiveInstallItemMenuItems`** reads the product state, capabilities, install-operation data and `pauseResumeCancelInstallSupported` at offsets **121, 147, 169 and 207**. Resume/Pause/Prioritize/Manage labels occur in separate construction paths, rather than a universal menu list.

The closure references connect it to **64029** (resume action reference at 58), **64030** (pause at 58), **64033** (cancel at 58) and **64034** (install-customization modal at 37). These are useful implementation anchors for xboks. The index alone does not prove every guard, order or async outcome; those require tracing each branch and validating the observed Windows states.

### Product cards, product queries and details are separate layers

**57102 `useCommonGameCardProps`** references the product's `id` and a separate context-menu hook. **57086 `useOnGameCardContextMenuCallback`** builds context-menu and keyboard callbacks; its anonymous children **57087–57088** carry the content/product ID and menu anchor. Focusing a card is not evidence of selecting its primary action.

**42911 `useProductDetailsQuery`** references `fetchProductDetails` at **101**, `productIds` at **117**, and distinct skip/fetch-predicate fields at **129–144**. **51227** references `getProductDetailsAsync` at **88** and handles product-kind/edition metadata. **61960 `useDisplayProductDetails`** references the product-details hook at **21** and additional product information at **71**. These are separate evidence anchors for navigation, product lookup, editions/entitlements and displayed information. A local installation record or reused card title cannot satisfy the whole details-page contract.

## Reproduce and query

From the repository root, with the original package extracted locally:

```sh
python3 scripts/analysis/build-xbox-function-evidence.py \
  work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --metadata work/reference/hermes96-decoded.json \
  --private-output work/reference/library

python3 scripts/analysis/build-xbox-function-evidence.py \
  work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --function 46838

python3 scripts/analysis/test-xbox-function-evidence.py
```

`--function` emits one annotated function as JSON, with exact instruction/file offsets, all annotated string/function operands and decoded literal values. Keep that output local. Sixteen synthetic tests cover malformed operands/literals, multiple string operands, signed/long literal sequences, branch/switch boundaries, distinction between calls/closures, register invalidation including cross-case aliases, callback assignment and declared-vs-called module dependencies. They do not require a Microsoft package.

Private output schema **1**:

| File | Contents |
| --- | --- |
| `work/reference/library/function-evidence.json` | Input hashes, JSONL SHA-256/byte/row binding, counts, errors, opcode histogram, topic indexes, function names, literal section boundaries, module registration/declaration/call-pattern records and limitations. |
| `work/reference/library/function-evidence.jsonl` | One function per line: `id`, `name`, `file_offset`, `bytes`, `instructions`, `string_sites`, `function_relations`, `calls`, `closure_bindings`, `object_literals`, `jump_edges`, `jump_errors`, `topics`, module patterns. |

Topics are heuristic lookup aids covering settings, details, menus, library, Home/Game Pass, Remote Play, Fullscreen Experience, controller input, social/notifications, install/launch and Game Bar. A topic match is not an implementation-completeness or reachability score. Original strings, style objects and instructions remain in ignored `work/reference/` storage; the public library contains measured facts, short identifiers and reproduction instructions.

## Work still requiring semantic/dynamic analysis

The generated index does not recover register data flow across all branches, asynchronous scheduling, computed object-property effects, complete Metro import semantics, native bridge return contracts, regex semantics, preserved function-source tables, feature-flag/account/server conditions or native PE machine-code semantics. Its companion structural audit supplies the encoded switch and exception targets, not their complete runtime semantics. It also does not demonstrate runtime Windows behavior. A faithful implementation must pair each screen/action with targeted function traces, the supplied screenshot state, runtime observation where available, Linux adapter behavior and regression evidence. None of the aggregate counts turns those remaining tasks into completed work.
