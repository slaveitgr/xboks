# Menu behavior and input traces

Pinned input: **Microsoft.GamingApp 2610.1001.20.0 x64, Hermes v96**. These are bounded static dataflow traces, not a complete reconstruction of every menu, physical-input trace or service implementation. The accompanying [menu-behavior-contracts.json](menu-behavior-contracts.json) contains **55 rules**, each with exact function/instruction offsets and explicit unknowns. Every rule has `original_runtime_verified: false`.

Raw annotated functions are private at `work/reference/library/traces/menus/function-<ID>.json`. `module-bindings.json` records selected constant module-registration patterns and function-creation ancestor chains. Such a chain proves code ownership/reference, not that a function was called at runtime. Relative instruction offsets below are specific to this build.

## Menu bugs must be separated into four decisions

The original code distinguishes **primary activation**, **action category**, **menu item state** and **input/surface ownership**. A menu that contains plausible labels can still open the wrong surface, act on the wrong identity, expose an unsupported action or consume Back incorrectly. The implementation should treat these as separate contracts.

### Catalog card primary click is not its context menu

**F56947 `GameCard`** captures `productId`, `onBeforeClick` and channel context, creates callback F56948 (339–344), and passes that callback to the card shell as **`onClick`** (434).

**F56948** receives the actual product object as its first argument. It optionally calls `onBeforeClick(product)` (0–22), then reads **`product.id`** (27) and **`product.productType`** (37). After telemetry, it calls imported **`dispatchNavigation`** with those values, captured dispatch and channel ID (260–284). The `oneStoreProductId` field appears in telemetry construction (171–175); this selected path does not replace the actual navigation identifier with it.

The imported resolver is tied to module **2001** through module **6114**'s factory F56944: dependency index 9 is module2001; factory instructions 213–225 import it into environment slot8, which F56948 reads at260.

**F21800 `dispatchNavigation`**, module2001, checks product type:

| Branch | Decision and action offsets |
| --- | --- |
| DLC | Predicate at33, branch38; `dlcDetails` at134, call155, dispatch159 |
| Subscription | Predicate at51, branch60; `subscriptionDetails` at98, call119, dispatch123 |
| Other | `gameDetails` at63, call87, dispatch91 |

The selected primary catalog-card path therefore opens **type-specific information**; it does not call a game-launch action. This conclusion applies to this component/path, not every recent/installed/third-party tile. The separate [product-navigation trace](product-navigation-trace.md) establishes the game-details query fields and shared View details callbacks.

Context invocation uses **F57086 `useOnGameCardContextMenuCallback`**. It constructs request F57088 with **popupId, productId, anchor, telemetry and modifiers** (F57088:6,18,26,35,44), invokes the context-menu hook (F57086:141), then returns distinct **`onContextMenu`** and **`onKeyDown`** handlers (159/164). Attaching primary `onClick` to hover/focus or conflating context selection with launch breaks this separation.

### Category and menu candidate state are separate

**F57124 `useProductActionCategory`** reads item identity, overview data, PC/cloud capability, installed-catalog state, shell layout, an explicit feature gate and initial-fetch state (35–226). Later branches distinguish MRU, playtest, third-party identity, loading, cloud category, post-install, subscription, bundle, DLC and game/offline types (243–811). **F57126** selects a different operations builder from that category.

Only selected guards are traced here; cloud helper internals and feature-flight combinations are not recovered completely. The supported conclusion is that a single fixed menu for every product is incorrect.

For normal Game category, **F57758 `useGameCtaOperations`** constructs candidates from provider-disabled, uninstalling, update, install, play, alternate install/play, cloud play/upsell, extension, purchase, wishlist, Play later, hide, share, post-install and package hooks. Candidate builder calls at46–492 are then combined at503. These hooks' own conditions determine their state. The candidate list is not evidence that all those actions appear simultaneously.

**F58069** performs a narrow, provable transformation:

- If `candidate.renderState === RenderState.Hide`, return without appending (3–27 →132).
- Otherwise append title/text, icon, icon flow, action, **disabled** and **loading** independently (69–127).

`hidden`, `disabled` and `loading` cannot be reduced to one boolean. Replacing an unavailable service with an enabled no-op or deleting a disabled item also changes the contract.

**F57116** applies operation-ID suppression and overrides, then wraps the action. **F57117** invokes the retained candidate action with the menu's **anchor** (39–45). That anchor may matter for the next surface/focus origin; it is not decorative geometry alone.

**F57113 `ProductContextMenuRenderer`** uses candidate operations, transforms them and checks pending state. Its predicate **F57119** matches `RenderState.Wait` (3–27). Wait leads to LoadingContextMenu (F57113:207–212 →284–305). A resolved nonempty visible list renders ContextMenu (215–274); an empty list returns null (222→282) and an effect **F57118** dismisses the owning `popupId` (7–47). An empty resolved list should not leave a blank, focus-trapping panel.

## Queue menus preserve two identities

Module **7055**, factory **F64023**, owns the active-install menu hooks and imports navigation module2001 in dependency slot21. The selected View details callback is documented in the earlier product-navigation case study.

**F64026 `useActiveInstallItemMenuItems`** receives an item identifier. It reads `itemIdentifier.productId` with empty-string fallback for selectors (2–74), obtaining item state, capabilities and operation data (127/153/175). It retains the original item identifier in captured slot0 for mutation requests. **Catalog product identity and operation identity are not interchangeable.**

The active-item portion requires a truthy operation state and identifier (490/496). It appends View game details first (507), then applies the capability and state guards below:

| Action | Visibility guard | Construction offsets | Execution |
| --- | --- | --- | --- |
| View game details | Valid operation state/item; independent of pause/resume capability | F64026:490–507 | Shared game-details callback bound to productId |
| Resume | `pauseResumeCancelInstallSupported` and state Paused/Error | F64026:512–644 | F64029:73–78 dispatches `resumeItemInstall.start(originalItemIdentifier)` |
| Pause | Same capability and state Downloading/Installing | F64026:649–782 | F64030:73–78 dispatches `pauseItemInstall.start(originalItemIdentifier)` |
| Prioritize | Same capability and state Queued | F64026:787–868 | F64031:80–85 dispatches `prioritizeItemInstall.start(originalItemIdentifier)` |
| Cancel | Same capability and state Downloading/Installing/Paused/Queued/Error | F64026:873–1012 | F64033:73–78 dispatches `cancelItemInstall.start(originalItemIdentifier)` |
| Manage installation | Separate `intelligentDeliverySupported` capability | F64026:1017–1088 | F64034:47 calls customization modal with normalized productId |
| Expand/collapse | Truthy hook argument2 and argument4; argument3 selects label/icon | F64026:1093–1187 | Passed argument4 callback |

Preupdating uses distinct resume/pause/cancel labels; the catalog item state and operation state are separate values. Cancel label selection is in F64027; the request does not establish downstream deletion, confirmation or rollback behavior. Existing xboks file-preservation safeguards must not be removed merely because this callback dispatches a cancellation action.

The **row's error/detail button is another decision**: **F64107** first requires a truthy item identifier (argument1), item state (argument2) and operation state (argument3?.state). Its guards at16–39 return undefined when those prerequisites are absent. With those prerequisites satisfied, operation Error selects a warning/error-modal target (79→532–602), while other branches select View details, resume, pause or prioritize metadata. The row error icon and overflow View game details cannot be wired to one generic callback.

Screenshot `35995` corroborates only the visible failed-operation menu. No runtime resume/cancel outcome is established by that image or these action-creator traces.

## User-added and external app menus are source-aware

Module **7087**, factory **F64326**, supplies **F64337 `useAppContextMenuItems`**. It asks five hooks for supported flags and corresponding items, then **F64338** conditionally appends supported items in order **Launch → Download → Uninstall → Remove → Edit** (11–107). Unsupported rows are omitted.

| Item | Exact local support condition | Action binding |
| --- | --- | --- |
| Launch | F64328:9–37, `actionType === ActionType.Launch` | F64328:103–114, `getExecuteActionAsyncHandler(app)` |
| Download | F64330:9–37, `actionType === ActionType.Download` | Hook-provided asynchronous app-card action, F64330:93–97 |
| Uninstall | F64332:9–69, `source !== AppSource.User && actionType !== ActionType.Download` | **`getOpenWindowsSettingsAsyncHandler()`**, F64332:147–157 |
| Remove from library | F64334:9–37, `source === AppSource.User` | `getRemoveAsyncHandler(app)`, 103–114 |
| Edit in library | F64336:9–37, `source === AppSource.User` | `getEditAsyncHandler(app)`, 103–114 |

The Uninstall literal object explicitly marks **`isExternal: true`** and initializes disabled/loading false. It requests Windows Settings rather than deleting files directly. Remove/Edit are different operations for user-managed library entries. Linux needs its own explicit adapter/capability policy; a generic menu that offers Uninstall, Remove and Edit for every source is incorrect.

These app-card hooks do not exhaust the normal Xbox game CTA menu, nor do they prove any installation/authentication behavior of Steam, Epic or another provider.

## Common menu press, hover and dismissal

**F47516**, bound by **F47515 `_ContextMenuItem`** as its press handler, establishes ordering:

1. Optional telemetry only when relevant element metadata exists (24–243).
2. If `props.popupId` is truthy, dismiss that popup (256–311); otherwise `Popup.dismissAll()` (275→284).
3. If an action announcement exists, announce it (331–377).
4. If `element.action` is non-null, call it (397–428).

Dismissal precedes action invocation. This prevents the old popup from remaining above the new dialog/page and helps preserve explicit surface ownership. The callback itself contains **no local `disabled` check**; input suppression for disabled rows belongs partly to its rendered control/host and still needs verification. Never treat calling the action as proof that a remote mutation succeeded.

**F47517** handles mouse entry by focusing `event.currentTarget` (3,9,14). It does not execute the selected item. This is direct evidence against reusing focus handlers as activation callbacks for the generic menu item.

Modal and popup scopes are separate: **F43679 `Modal.dismissAll`** requests OverlayType.Modal at82; **F43782 `Popup.dismissAll`** requests OverlayType.Popup at74. “All” is scoped to a surface class/window adapter, not automatically every application window.

## Profile flyout routes and gates

Module **7576** owns the profile component family. **F67716** reads signed-in status, connection state and profile LCE, extracts profile data and passes them to `getListItems` (7–76).

**F67711** builds the normal list with distinct conditions:

- `isOfflineShell` selects **F67715** instead (29–35→1029–1035); that dedicated list is Settings, separator, Feedback and Quit.
- Profile/subscription/account-dependent rows require signed-in state and usable profile data (45–54).
- Rewards uses loaded rewards data (135/177); offers/credits has its own feature predicate (230/236).
- Presence selects online/offline counterpart from current mode (508–611).
- Sign-in/out choice and availability are separate: its item is disabled when not connected and its focusability also uses connection state (674–719).
- Developer/catalog and unsubscribe entries have additional gates.
- Normal-list Quit is omitted when `isInFSEMode` is true (889–895). This is distinct from the offline-list branch.

| Menu selection | Concrete handler effect |
| --- | --- |
| Settings | **F67701:** refresh recurrence at18, `showSettingsModal(SettingsTab.Account)` at53 |
| My subscriptions | **F67702:** refresh recurrence at18, `showSettingsModal(SettingsTab.Subscriptions)` at53 |
| View profile | **F67697:** require profile data, use `profile.xuid`, call profile prop at62, dismiss popups at83 |
| Insider | **F67703:** existing/non-insider URI selection at27–51, `launchDeeplink` at57 |
| Support | **F67706:** `showSupportModal()` at15 |
| Feedback | **F67707:** `showFeedbackModal(launchFeedbackHub)` at33 |
| Quit | F67700 invokes quit prop; **F67719:** dispatch `shellActions.exitApp` result, 26/32 |
| Sign out | **F67720:** dispatch `userActions.signOut` result, 26/32 |
| Appear online/offline | **F67709/F67710:** loaded-profile guard, respective prop at57, accessibility announcement at106; F67723/F67724 dispatch corresponding start requests |

In particular, My subscriptions must select **Subscriptions**, not reopen the previous settings pane. Support and Feedback are modal flows in these handlers; replacing both with unrelated external links does not reproduce them. Quit and Sign out are different action types even if translated UI labels can appear similar.

Exact internal Support/Feedback content, Insider URI resolution, all signed-out variants and resulting service behavior remain unverified.

## About links have specific target roles

Settings About belongs to module **5043**. The handlers **F46886–F46895** all resolve `openURLWithTelemetry` at7, read a specific imported URL role at32, and invoke the helper at50 with link/AppSettings metadata. Their selected roles are:

| Handler | Role |
| --- | --- |
| F46886 | `pcInfoUrl` — Help |
| F46887 | `termsOfSaleUrl` |
| F46888 | `privacyStatementUrl` |
| F46889 | `servicesAgreementUrl` |
| F46890 | `termsOfUseUrl` |
| F46891 | `thirdPartyNoticesUrl` |
| F46892 | `webThirdPartyNoticesUrl` |
| F46893 | `rankingDisclosureUrl` |
| F46894 | `accessibleGamingSupportUrl` |
| F46895 | `xboxAppUpdatesUrl` |

These roles must not all resolve to the same generic home page. This bounded trace does not resolve every actual URI constant or external launcher behavior. Greek displayed strings can be joined through the package's main resource namespace; this RN settings surface must not be conflated with separately packaged Game Bar or tray/XBF resources.

## Friends quick actions preserve target identity

Module **5128**, factory **F47799**, imports navigation module2001 from dependency index15 into environment slot14 (315–327). **F47803** separately captures **targetXuid**, current-user XUID, current product, target user's product, Game Pass status, party/activity and communication/multiplayer capability state (8–139). These are not interchangeable identities.

| Action | Bounded effect/guard |
| --- | --- |
| Chat, F47812 | Build `{chatType: OneToOne, recipientXuid: targetXuid}` at26–53, dispatch navigateToConversation at58–65, dismiss quick-action popup at96 |
| View game, F47826 | Require truthy target-user product ID and target-user Game Pass condition at3–17; call `gameDetails(targetUserProductId)` at155–166 |
| Profile, F47827 | Dismiss Social Hub modal at23–29; call `navigationActions.profile(targetXuid)` and dispatch at51–68 |
| Invite to game, F47808 | Check captured multiplayer denial and invite eligibility before requesting invite; denied path throws; no service success established |
| Join game, F47811 | Require current-user identity and available activity; otherwise log/return before join request |
| Escape, F47828 | Match `nativeEvent.key` to Escape at3–32; stop propagation at42; dismiss popups at62 |

**F21815 `profile`** constructs a profile route query with XUID and optional content, then chooses imported push or replace based on its third argument (11–23,44–105,117–141). Full serialization behavior is not followed here.

There is no local communication-privacy gate in the selected chat callback. That is not proof that chat is universally permitted: upstream item visibility/disabled state and downstream service enforcement remain open. Do not invent those guards or represent an installed provider launcher as a linked Xbox friend/account.

## Back is consumed, ordered and identity-aware

The selected original infrastructure has a concrete controller/back model:

- **F22447** obtains Gamepad B Down (70–106), registers native button/event delivery during first enable subscription (122–217), and supplies callback **F22448**.
- **F22449** adds registered back callbacks to a Set (12–21) and retains a removal handle.
- **F22448** copies Set values, reverses them (21–42), then invokes callbacks in reverse insertion order. It stops at the first truthy result (65–79), returning true; if none consumes the input, returns false (88–90).
- **F22501** registers a hook callback under `hardwareBackPress` and returns a cleanup closure (9–47).

This proves **last-registered-first-considered with explicit consumption** in this adapter. It does not prove the registration order/lifetime of every popup/modal or physical controller delivery. The current deepest surface must own the input; blindly routing B to Home loses this contract.

Focus identity is also explicit: **F43501** compares a validated back-navigation target's itemId with the current item (81–104), and **F43502** dispatches `updateBackNavAutoFocusTarget({itemId,autoFocusDisabled})` (34–67). Actual element focus and scroll restoration are outside these short hooks and must be runtime-tested.

## Shared menu guidance for xboks

The following are independent implementation recommendations derived from the traces, not recovered Microsoft type definitions:

1. Define an action by stable ID, label/icon, **visible/disabled/loading** states, exact target identity, execution function, surface/dismiss scope and focus origin.
2. Resolve primary card activation separately from context-menu actions. Catalog game/DLC/subscription navigation must use product identity and type; installed/MRU/local-app activation requires its own verified source policy.
3. Reuse matching action definitions between a card menu and product overflow, while allowing category/operation/provider-specific lists. A single fixed menu everywhere is not parity.
4. Preserve productId versus original operation identifier versus target XUID. Include the target in every asynchronous mutation request; do not read whichever item happens to be selected later.
5. Dismiss the owning popup before opening its next dialog/page; keep context anchor/focus return stable. Pending/empty menus need explicit loading/dismiss behavior.
6. Derive destructive/platform actions from actual capabilities. Windows external uninstall maps to an explicit Linux adapter, while Remove from library remains a separate operation.
7. Register Back handlers by active surface with a consumed result and cleanup. Restore a stable item identity rather than relying on DOM position or sending every Back to Home.

Meaningful acceptance checks: catalog game/DLC/subscription click opens matching information; right-click/keyboard context preserves selected product; hover does not activate; hidden/disabled/loading differ; queue error/paused/downloading/queued produce the appropriate guarded action sets; View details never resumes/cancels; user-added Remove/Edit differs from provider Uninstall; profile Subscriptions selects its tab; target-user chat/profile/game details preserve target identity; Escape/B close the current surface and return focus; failed actions keep explicit errors.

No app code was changed for this trace work. Parsing/offset checks validate the evidence locators, not Windows/Linux behavior or complete menu parity.
