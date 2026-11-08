# New Experience Store collection mechanisms

Target: the supplied Microsoft.GamingApp 2612.1001.23.0 Play.Xbox payload.
This checkpoint separates original static declarations, public service observations
and independent XBOKS implementation. No account, purchase, game installation or
stream was used by these checks.

## Original contract

The selected StoreDealsRoute and StoreCollectionsService modules were analyzed
as inert source by REA, parent `ev_99582c3dc8be1b2ed668051dba01e51b4d4e0a14cf3a133058ce2d75f3d4aad2`.
All three selected files parsed; unselected dependencies remain unknown. The
private export is `work/xbox-2612/rea-store-services-20261108.json`. The
StoreCollectionsService adaptor concerns entitled add-ons and is **not** the
public browsing transport.

The already pinned `entry.client-lsuj6d01.js` (SHA256
`d80ceff4f093a428d847dcf1d1cbf087864a400051c18bf0485cdbf19c179cd6`)
contains these additional bounded inert-text contexts, at UTF-8 byte offsets:

- `1559867`: infinite collection queries start at zero; continuation consumes
  the actual number of source product IDs, independently of rendered cards.
- `2608354`: channel result schema contains channelId, title, totalItems,
  productIds and optional filters.
- `2615464`: the collection adaptor uses
  `https://reef.xboxservices.com/channels/{channelId}/browse`, with market,
  language, pageSize and skipItems.
- `2653819`: a separate legacy Emerald browsing adaptor uses POST and a
  different response shape. It must not be substituted for Reef pagination.

These are exact source contexts, not a claim that the large shared module has
been semantically traced in full. The StorePage category declarations supply
18 specific DynamicChannel IDs; their localized genre or mood names do not
establish membership by a string match against product categories.

## Public observations

Anonymous requests to the original Reef Deals channel returned the correct
channel ID, a service total, ranked product IDs and a different next page for
skipItems=4. They required a fresh anonymous MS-CV correlation vector and no
credential, session cookie or Xbox token. A guessed Microsoft Store computed
list named Deals returned a free Roblox row; it was rejected as a substitute.

Adding an unverified deviceFamily=PC query produced a misleading HTTP-200
`Failed to Get Channel` sentinel. The implementation omits that parameter and
rejects the sentinel as an error. A legacy Emerald POST repeated its first page
despite PageNumber changes; it is not used for continuation.

These observations establish public collection delivery at the checkpoint,
not account entitlement, complete catalog coverage, offer eligibility or a
working native Windows session. A Deals channel can contain console products;
each card's PC installability remains a separate DisplayCatalog result.

## XBOKS implementation

- Browse/Deals are real Store destinations. Categories and Wishlist have their
  own navigation, with details and Back preserving route, loaded pages, scroll
  and focused control.
- Deals and all 18 categories use allowlisted exact channel IDs. Mood membership
  comes from the service, without locally filtering out returned products whose
  genre labels do not contain the mood name.
- Cursor state is bound to its collection/category and market. Page size is 24,
  offset and cursor size are bounded, and repeated source pages are rejected.
- Exact returned IDs are enriched with public DisplayCatalog metadata, without
  inferring ownership, license, subscription or a supported runtime.
- Missing or ambiguous prices remain absent. Public availability stubs can
  include zero-valued offers that do not establish a free purchase.
- Personalized Picks for you and remote campaign layout remain separate service
  work; generic Featured products are not labeled as personal recommendations.

The adapter tests cover actual request construction, anonymous headers, response
bounds, exact category membership, source ordering, continuation, cache isolation,
invalid IDs, cross-market/category cursors, failed-channel sentinels and missing
metadata. Renderer fixture tests cover the route and input behavior; they are
separate from public-service and physical-controller acceptance.

The compiled production adapter was also exercised anonymously for market GR:
24 Deals products, an advancing continuation page of 24 products, and 24 Cozy-category
products were returned. The safe summary is retained privately as
`work/wine-uwp-xbox-2026-11-07/observation/ui-reconstruction-20261108/public-store-live-check.json`.
No account or entitlement operation occurred. The catalog and channel adapters
passed 113 tests across two files, including 38 channel-specific tests.
