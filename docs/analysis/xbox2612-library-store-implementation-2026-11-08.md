# Xbox 2612 Library and Store implementation checkpoint

Target: Microsoft.GamingApp 2612.1001.23.0, shipped Play.Xbox payload. This combines a bounded static contract, original-client observations under Wine and a Linux reconstruction checkpoint. It does not establish Windows execution or complete page parity.

## Evidence

REA analyzed the original selected modules as inert JavaScript. Parent application evidence `ev_8399446f6b60e89781f82391002b69791e4e56159de8ab2188a837c6abeacaf6` selected StorePage and LibraryPage. Both parsed; Library reached the selected semantic-node retention limit. Unselected dependencies and dynamic service results remain unknown.

The focused Library policy follow-up, parent `ev_dfd78ba4fb717a1e893c6625648e05c118c58c5accbe06421afe2feb7d7138c9`, parsed its one selected helper without semantic-retention exhaustion. This is complete examination of that file, not complete application coverage. The authenticated private export is retained under the ignored research directory; it is not distributed with the app.

| Source inside web payload | SHA-256 | Relevant UTF-8 byte offset |
| --- | --- | --- |
| assets/StorePage-n6gz5rpf.js | 09f1ea7e7165dde486f8783a779e5db323918a69e8e225f26e02a7e5a4698967 | 1029 category declarations; 6237 local collection composition; 7202 remote-layout flag; 8327 selected-collection restoration |
| assets/LibraryPage-m1h6t29i.js | f361e8abc938d6a363dd2ab4a9bd3af3d487c7ee4d3704e28902d5159bc46baa | 37418 responsive grid maximum; 72787 header actions; 79680 tabs component |
| assets/useLibraryFilterScope-hoxg0coy.js | 6ecc38ad12f150f92f1a8a834e77fc5f2d2019735176efa418d65162a1be44fb | 2011 dock Queue gate; 2077 sub-navigation policy; 2514 inline policy; 2765 surface selection |

## Original declarations

The Store chooses remote dynamic layout when the configuration enables it. A missing or failed remote layout falls back to local collection stubs. The local composition declares personalized picks only when fully signed in, then deals, new games, a localized category cover grid, top selling, top free, coming soon, popular, trending, personalized add-ons when signed in, most wishlisted, Play Anywhere and demos. The source does not declare an unconditional Minecraft hero followed by five primary landing buttons.

The category grid declares 18 genres and moods and sorts their translated labels using the active locale. Its declarations and IDs do not supply the actual product membership of each DynamicChannel.

Library navigation has distinct inline and sub-navigation surfaces. The sub-navigation order is Installed when native access exists, Apps when enabled, Recently played, Play later, My games before Queue at high density or after Queue at low density. The high-density Queue entry is omitted when the dock already offers it. The inline surface starts with My games, followed by Apps, Play history, Play later, Full library and Queue subject to their gates. App capability and sign-in/offline gates are explicit; an inventory of tab labels does not establish that they are all visible for a given user.


The parent runtime pass subsequently captured the actual new high-density Library (`ev_4be2591c71760494f896dd2aecc7b457cb814a40245800f873fa275f2c535f58`). That observed configuration showed Installed, Apps, Recently played and My games as pill navigation, with Queue in the left dock and Play later absent. This corroborates configuration-dependent visibility rather than proving universal absence of Play later. The account-bearing capture remains private. The host now represents the observed navigation policy with capability-aware Installed/Apps routes, `showLater={false}`, `queueInDock` and high density. Installed filters actual installed/imported games. Apps has an actual Linux desktop inventory and launch provider; it is not exposed using fabricated entries.

A later original-client capture (`ev_8eef01a22def9004681ab194295a1aff5249e9312262b74bd83c843c90f28c6f`) showed the actual Store landing: Browse/Deals pills, categories icon, wishlist, two hero placeholders and Picks for you. The private capture lives in a misleading `settings-display` directory. Its content is Store, not Settings Display. The original placeholders do not establish successful campaign loading.

## Implemented Linux changes

- Reconstructed the observed Store Browse/Deals pill bar with Categories and Wishlist actions. The initial Browse route has two visible wide cards, manual carousel pages and product-specific details; its products come from the public Featured provider rather than an invented personal campaign.
- Kept genuine returned product IDs, prices, subscription annotations, installation evidence, stale-request rejection and pagination ownership.
- Category selection uses the exact category provider, backed by the declared DynamicChannel membership. Missing category capability is unavailable, never a substitute search or filtered first PC page. Public PC metadata is used only for optional category-cover illustration. Category Back restores the corresponding category button; another Back restores the Categories action on Browse.
- Added localized category sorting, returned collection counts, loading/error/empty states and density-aware category/product grids. Deals uses its dedicated original public channel; formatted prices do not establish sale membership.
- Retain bounded, account/market/backend-owned collection snapshots and pagination when visiting details or another Store route. Reject stale results, serialize More, retry a failed continuation without losing the first page, and restore each navigation origin and scroll position. Browse/Deals are sections rather than an indefinitely accumulating history of tab clicks.
- Reworked Library navigation to intrinsic label widths, one keyboard tab stop, capability-gated Installed/Apps entries, density ordering and suppression of duplicate Queue entry points.

`LibraryTabs` exports `showInstalled`, `showApps`, `showHistory`, `showLater`, `showQueue`, `queueInDock`, `highDensity` and `surface`. Apps is now wired through `DesktopApps.tsx` to the validated GJS desktop-entry inventory and launch IPC. It supports returned application icons, search, refresh, bounded failure states and launch serialization. The Settings Display My apps preference controls the actual tab, with a safe return to Installed when hidden. Installed uses the installed-only game inventory. These are functional Linux adaptations, not the Windows extension host.

## Remaining gaps

The Store now represents the observed Browse/Deals navigation and wide-card geometry. The Browse cards are public Featured products, not the original authenticated editorial campaigns. Picks for you is omitted because its authenticated provider has not been implemented; generic Trending data is not relabeled as a recommendation. Wishlist reports sign-in or capability availability and performs no inferred account operation. Exact remote layout, campaign content, the current user’s shelf order, inline commerce and full catalog membership remain separate service integrations.

Deals and the 18 category routes use original declared public DynamicChannel IDs through the catalog adapter. Mood membership is returned by its category provider rather than guessed from a public genre string. Product metadata and installation eligibility remain independent from channel membership. The Categories screen, its collection utilities and local Back history are functional Linux adaptations; the original Categories and Deals detail transitions were not observed in this runtime pass.

The responsive values are a reconstruction using the shared shell gutter and explicit density overrides. They are not a measured pixel-equivalence claim. Original Library Installed and Store landing are now observed under Wine. Comparisons of their other tabs, detail routes, controller focus, category/product Back and artwork at matching viewport/density remain necessary.

## Validation

Targeted Store, Library chrome, collection persistence and library-layout tests pass: 31 tests across four files. These cover data ownership/pagination, declared category order/filtering, navigation gates and accessible selected-tab semantics. They do not execute the original client or establish live commerce/entitlement behavior.

The earlier integrated renderer fixture passed 156 checks with zero failures and 52 screenshots, including Library Apps/Installed, the previous Store category/product Back and seven-provider Settings navigation. This run predates the Browse/Deals/category-provider changes and does not validate them. It used isolated returned-data fixtures and validated source fingerprints; it does not establish live Windows services or exact original landing parity.

Earlier accepted integrated fixture: `work/redesign-2026-11/new-experience-integration-final-5/experience-redesign-report.json` (156/156; 52 screenshots), with its sibling exact `source-fingerprint.json`. Earlier interrupted fixture attempts are superseded. See the [parity ledger](xbox2612-new-ui-parity-ledger-2026-11-08.md) for checksums, observed original surfaces and remaining boundaries.


### Store Browse/Deals follow-up verification

The revised Store has 28 focused tests covering real request routing, missing provider behavior, stale category and account requests, failure/retry and continuation ownership, source-derived category declarations, native-shaped navigation semantics, returned hero identity, and nested Back focus/scroll records. Renderer type checking passed with the final shared category API. Cancelled initial reads are restarted on return; only settled snapshots can be retained. Integrated browser verification of the revised routes is tracked separately; the earlier 156-check report is not reused as evidence of these new transitions.
