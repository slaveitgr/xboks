# Product navigation: bounded semantic case study

Build: **Microsoft.GamingApp 2610.1001.20.0 x64**, Hermes v96. This case study follows selected instruction operands, environment-slot stores/loads, property construction, module dependencies and calls. It goes beyond name/string matching, but remains **static, bounded analysis**: the original application was not executed, all possible callers were not recovered and no service response is verified.

Raw annotated function outputs are local-only under `work/reference/library/traces/function-<ID>.json`. Selected module registrations are in `module-bindings.json`; lookup snapshots are `lookup-<ID>.json`. All instruction offsets below are **relative to the named function body**. They are not source line numbers. Public prose publishes a small reconstructed contract, not the original bundle or bulk instruction data.

## Proven route and module binding

The module registration pattern in global F0 identifies module **2001** with factory **F21792**. Its dependency index 5 is module **803**, whose factory **F10548** sets `NavigationRoute.StoreGameDetailsRoute` to **`/store/gamedetails`**: load constant at offset 247, property assignment at 251.

F21792 imports that dependency into its environment slot 3 at offsets 171–183. It creates closure **F21801** at 399 and stores it in environment slot **13** at 404. It creates **F21824** at 702, assigns it as `gameDetails` on the navigation-actions object at 707, then exports the object as `navigationActions` at 980.

These assignments establish more than the co-occurrence of route and action names: they connect the callable property, its query helper and the route constant within the selected module's static initialization pattern. They do not prove that every account/feature-flight executes this factory or that all application entry points reach this method.

## Exact bounded navigation payload

**F21824 `gameDetails`** constructs a navigation object and invokes an imported `push` function, returning its result:

| Relative offsets | Instruction-level data movement |
| --- | --- |
| 0 | Load fifth explicit argument; retain it for conditional attribution |
| 3–10 | Resolve environment slot 0 and its `push` property |
| 15–32 | Allocate navigation object; assign `pathname` from `NavigationRoute.StoreGameDetailsRoute` |
| 37–59 | Load env slot 13/F21801; pass explicit arguments 1, 2 and 3; assign result as `search` |
| 64–82 | Resolve `Object.assign`; construct `{ocid: argument4}` |
| 87–104 | If argument5 is truthy, create `{searchAttribution: argument5}`; otherwise use empty object; combine with the ocid object |
| 110–119 | Assign combined object as `state`; call imported `push(navigationObject)` and return the result |

F21792 initializes environment slot 0 from dependency index 1, module **2002**, at offsets 106–118. The selected trace does not recover module 2002's complete implementation. Thus the defensible statement is **“calls imported push and returns its result”**, not “directly mutates browser history.” The callbacks below pass that result to a dispatch function.

**F21801 `createPdpLocationSearch`** supplies the query object:

| Relative offsets | Proven input-to-field mapping |
| --- | --- |
| 0, 30–35 | Explicit argument2 is retained when truthy; otherwise changed to undefined |
| 23–26 | Explicit argument1 → object field `productId` |
| 35 | Normalized argument2 → `catalogId` |
| 40–43 | Explicit argument3 → `refComponent` |
| 3–15, 48–53 | Resolve imported `default.buildQuery`, pass the object and return the result |

An independently expressed equivalent of these **local object-construction operations** is:

```text
queryFields = {
  productId: firstArgument,
  catalogId: secondArgument if truthy, otherwise undefined,
  refComponent: thirdArgument
}
location = {
  pathname: "/store/gamedetails",
  search: importedBuildQuery(queryFields),
  state: assign({ocid: fourthArgument},
                fifthArgument ? {searchAttribution: fifthArgument} : {})
}
return importedPush(location)
```

This establishes **which argument carries the catalog product identity**, independently of a title or local install path. It does not establish query escaping, ordering, omission rules, query-string prefix or the precise behavior of `buildQuery`; the helper's implementation is not followed here. Do not replace the reconstructed query object with a guessed URL serialization and call it original behavior.

## Catalog View details callback

The module registration pattern identifies module **5653**, factory **F52997**. Its dependency index 5 is module **2001**. F52997 imports it to environment slot 5 at offsets 154–166, establishing the static source of the callback's `navigationActions` property.

**F53004 `useNavigateToGameDetailsCallback`**:

- Loads explicit argument1 at 2 and stores it in closure environment slot 0 at 8.
- Loads argument2 at 5 and stores it in slot 1 at 12; this is the optional action/telemetry settings object consumed by the child.
- Calls `useDispatch`, storing the result in slot 2 at 34.
- Creates closure **F53005** at 63 and supplies it to `useCallback`, with dependency values corresponding to those captured arguments and dispatch.

**F53005**, after its telemetry/default-selection branches:

- At 298 loads captured dispatch from slot 2.
- At 302–312 resolves imported `navigationActions.gameDetails` from the parent module environment slot 5.
- At 318 loads captured slot 0 unchanged.
- At 322 calls `gameDetails(capturedArgument1)`.
- At 327 calls captured dispatch with that call's result.

Combining those assignments with F21801 proves the bounded value path:

```text
hook explicit argument1
  → captured environment slot0
  → navigationActions.gameDetails explicit argument1
  → createPdpLocationSearch explicit argument1
  → query object.productId
```

The optional telemetry settings support defaults/overrides for target/action/feature/parent/attribution metadata. Those branches were not semantically reconstructed in full; they do not visibly replace the captured argument used by the final navigation call. This case study does not identify every Store/Game Pass/Home card caller or prove that every card uses this hook. Editorial targets and MRU/third-party action categories remain separate investigation items.

## Library View game details item

Module **7055**, factory **F64023**, declares dependency index **21** as module **2001**. F64023 imports that dependency into environment slot 21 at offsets 386–398.

**F64024 `useViewGameDetailsItem`**:

- Stores explicit argument1 into its closure slot 0 (offsets 2–5), and argument2 into slot 1 (9–12).
- Calls `useDispatch` and stores its result in closure slot 2 (19–34).
- Returns an object with localized **View game details** text (38–69), Info icon (73–83) and action closure **F64025** (87–92).

**F64025 `action`** performs telemetry, then resolves parent slot21's `navigationActions.gameDetails` (57–67), passes captured slot0 at 73 and dispatches its result with captured slot2 at 78. The value initially loaded from captured slot0 at 36 is retained through the straight-line telemetry call; no arithmetic/conversion or replacement occurs before it is passed to gameDetails.

The **same product-ID argument position** is therefore used. However, this does not prove that every library caller supplies a valid catalog ID. Mapping a local/third-party installation into that argument is an upstream caller contract requiring separate verification. No conclusion about the installed card's ordinary primary click follows from a context-menu action hook.

## Queue View game details action

Module **7061**, factory **F64096**, also declares dependency index **21** as module **2001**, imported into slot 21 at offsets 386–398.

**F64100 `useViewGameOperationDetails`** stores explicit argument1 in captured slot 0 (2–5), stores `useDispatch` result in slot 1 (12–27), builds an Info/tooltip action and creates callback **F64101** at 101.

**F64101**:

- Loads captured slot0 at 47.
- Uses an install-queue parent/target in telemetry; the same loaded value remains available after that call.
- Resolves module2001's `navigationActions.gameDetails` at 70–80.
- Calls it with captured slot0 at 86, then dispatches the result through captured slot1 at 91.

It shares the product route contract with the library/catalog details action. It is a different operation from resume, pause or cancellation. This trace does not recover every conditional action set; **F64107** separately contains operation-state selection vocabulary and requires further branch analysis. Screenshot S35995 corroborates the visible failed-operation menu, not every possible queue menu.

## Product-details query hook: F42911

Module **4646**, factory **F42883**, assigns closure **F42911** as `useProductDetailsQuery` at offsets 157–163. It creates **F42910** and stores that selector hook in environment slot **49** at 70–75. It creates **F43036** and stores it in slot **38** at 904–909.

The bounded operations of **F42911** establish:

1. Explicit argument1 is loaded at 0 and retained as the product identifier. An optional second argument is read with a **false fallback** (5–36).
2. An empty-string guard path calls a captured helper with the query-hook identifier (36–55). The helper's throwing/assertion behavior is not reconstructed here; do not describe it as a verified UI error.
3. At 60–67, F42910 is invoked with the same argument1 to obtain a selector.
4. For truthy argument1, 91–122 constructs an object with **`productIds: [argument1]`**, calls `internalActions.fetchProductDetails` with that object and retains the result. The falsey-ID branch bypasses that construction.
5. At 127–144 it creates options with `skipFetch` from the optional second argument/fallback and `fetchPredicate` from `productLceNeedsLoad`.
6. At 149 it calls `useReduxLceQuery` with selector, the branch-produced value and those options, returning its result.

This is meaningful evidence of an **identity-keyed asynchronous query/cache boundary**, rather than a screen built only from a game title or installation executable. It is not a recovered network endpoint, schema for every returned field or proof that a request fires on each render: skip/predicate/cache behavior remains owned by the untraced query implementation.

F42910 also reads content-rating systems, subscription data and adult-status selectors before constructing its callback. **F43036 `selectProductDetailsWithOptionalId`** returns `LCE_NOT_REQUESTED` when its identifier argument is falsey (0–22). Otherwise, it accesses product summary state and product details state with that identifier, then extracts `productDetails` (24–115). Complete assembly/selection behavior resides in called helpers, not in this short wrapper alone.

## F51227 is an auxiliary entitlement trace

F51226 is a three-instruction wrapper named `fetchProductDetails`; its generator body is **F51227**. The name alone is ambiguous: the body is in the **ContentAccessProductEntitlementSagaManager** family, with diagnostic context for obtaining extra/current product editions.

Within F51227:

- The input is retained in a generator environment slot at 20.
- Offsets 30–107 resolve a dependency's `getProductDetailsAsync` and construct a yielded call with the retained input.
- After resumption, 120–137 obtains `getDataOrPrevious` and branches on absence.
- 196–343 classify product type into a content-access product kind.
- 349–405 read editions, map/filter them and construct `{productKind, otherEditionIds}`.
- 416–500 handle/log an error and complete without a successful editions object.

The selected evidence **does not establish a direct call edge F42911 → F51227**, nor that this auxiliary function is the primary Store detail-page fetch implementation. Its name must not be used to collapse catalog detail rendering, entitlement resolution and edition discovery into one service. Actual API request/response handling and generator effect execution are still unverified.

## What this proves for xboks, and what remains open

Proven within selected static paths: catalog/library/queue **View details** callbacks preserve their first captured argument into one `gameDetails` action; module bindings connect that action to F21824; the action/query helper assigns it to the **`productId` query field** on **`/store/gamedetails`**; the catalog detail query hook separately creates an identity-keyed **`productIds` array** with cache/skip options.

Still open: all upstream card/installation-to-product mappings; decoding route search back to current product state; every dispatch/middleware/push implementation; serialized URL formatting; exact service endpoint/authentication/response mapping; all query/cache branches; feature gates; loaded Details/Reviews/More rendering and media order; runtime input/error/Back/scroll behavior. No Windows activation or Xbox service request was performed.

Implementation implications are precise: preserve a catalog product ID independently of local install ID and title; route selected products to their identity-keyed information; keep View details independent of launch/resume/cancel; retain conditional entitlement/type-specific actions; expose explicit loading/cache/error states; reject stale responses for previously selected products. Those are independent Linux implementation requirements derived from the trace, not a claim that Microsoft's runtime has been ported.

To reproduce a raw function trace locally:

```sh
python3 scripts/analysis/build-xbox-function-evidence.py \
  work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --metadata work/reference/hermes96-decoded.json \
  --function 21824
```

Repeat for **10548, 21792, 21801, 42911, 42883, 42910, 43036, 52997, 53004, 53005, 64023, 64024, 64025, 64096, 64100, 64101, 51226, 51227**. Module registration patterns are bounded constants in the private evidence index. A successful reader run validates parsing limits, not behavior equivalence.
