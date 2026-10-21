# Xbox app Store: layout and navigation contract

This analysis concerns the **Store inside Microsoft.GamingApp**, not the separate Microsoft Store application. Static evidence is from the supplied **2610.1001.20.0 x64** package, Hermes v96, bundle SHA-256 `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. Screenshot evidence includes the older S35992/S35993 registry and the **2611.1001.5.0** captures indexed in [screenshots-2611.json](screenshots-2611.json). Function IDs below belong to 2610; screenshots do not update that bytecode baseline.

No original application code was executed, no account or commerce request was made, and no Windows click outcome was recorded. Offsets are relative to the named function. The package, raw instruction traces, fonts, extracted artwork and screenshot pixels remain in ignored local storage. This document contains selected behavior contracts and asset locators, not redistributable source assets.

## Captured layout

S2611-091 is fullscreen; S2611-142 is windowed above the Windows taskbar. Both show the compact 68-pixel app rail and the same Store fallback. The app's search/header remains fixed while the Store content scrolls, as S2611-143–147 demonstrate. Do not reproduce the taskbar, account avatar/name, selected Windows apps or device clock as Store content.

At the 1920-pixel capture width, S2611-142 has these approximate screenshot-pixel measurements; they are not a claim about Windows DIP values:

| Element | Visible geometry and behavior |
| --- | --- |
| Minecraft fallback | Centered at x694, y52, 600×400; rounded image tile with dark lower gradient |
| Fallback title | x726, y360; approximately 32px bold; subtitle below at x726, y405, approximately 16px |
| Five shortcuts | x494/698/902/1106/1310, y486; 184×56 each with 20px gaps; text-only in this capture |
| First shelf heading | x188, y619; approximately 26px bold; adjacent right chevron and muted description beneath |
| Standard shelf cards | x188, y688 onward; approximately 183px wide, 21px gaps; square 183px artwork and roughly 103px metadata body; eight visible |
| Shelf navigation | Right overlaid chevron button; heading/chevron represents the collection destination separately from individual product activation |

The captured shelf sequence is XBOX Play Anywhere, game deals, a Wishlist banner, deals with Game Pass, picks for the current account, new releases, top paid, top free and most played. Some intervening headings are outside the scroll captures; the screenshots do not establish a universal complete service layout. S2611-143 shows the deals shelf and beginning of Wishlist; 144 shows Wishlist, Game Pass deals and recommendations; 145 shows recommendations, new releases and top paid; 146/147 show top free, most played and the bottom Browse all games button.

Cards show a bold title of up to two lines, a muted publisher where supplied, and a separate price/status area. Captured conditional treatments include an original struck price plus current price, yellow discount tag/savings, green member pricing, owned/installed check labels, and artwork overlays for Game Pass, bundle and add-on. These are distinct data conditions. A Game Pass logo on a product does not establish ownership, an active membership does not establish that particular game's entitlement, and a public title is not proof of installability.

## One fallback versus three loading tiles

The single Minecraft tile is a positively identified original fallback:

- F62408 reads `data.length` and chooses `renderValidContent` or `renderFallback`.
- F62409 uses `DefaultSpotlightTile_Title`, `DefaultSpotlightTile_Subtitle` and `defaultSpotlightTileImage`.
- PRI `Resources/DefaultSpotlightTile_Title` is **Minecraft**; the English subtitle is **Build, create, explore**. The Greek subtitle matches the captured wording.
- F10524:3665–3669 assigns image locator `https://aka.ms/AA545i7`; 3725–3729 assigns target `msgamepass://details?id=9NXP44L49SHJ`.
- F62508 passes that target into `FallbackSpotlightContent`; F62513 renders the whole tile as a custom Button with title, subtitle, image and gradient. F62514 calls `executeDeeplink` on activation. There is no separate visible install/buy CTA in this fallback.

F62501:359–411 explicitly constructs three loading items, `placeholder1`, `placeholder2`, `placeholder3`. That corroborates S35992's three skeletons. It does **not** prove that loaded Store always contains three feature campaigns. Both valid content (F62413:171–174) and fetching content (F62415:111–114) set `minNumberToDisplay` to 1. The older S35993 is partly obscured by a social drawer and must not supply an invented unobscured three-card layout.

For actual service spotlight items, F62429 uses `doubleAndHalfWidthSizingStrategy`, current-card index, indicator pips, and pause/resume controls. It consults disable-animations, auto-advance, startup-modal and viewport state. Focus/hover affects scrolling and auto-advance; it is not equivalent to executing the product action. F62502 computes the spotlight image height from card width ×9/16; the fallback is a separate fixed presentation.

## Shortcut and spotlight destinations

The five captured shortcuts appear in this order:

| Control | Static action and route |
| --- | --- |
| All PC games | F62370/F62371 calls `navigationActions.searchGallery(searchAllQuery, Games)`; F10532:714–718 defines `searchAllQuery` as `*`, and Games as `games`; F21799 constructs `/search/games` with the query and current filter/sort state |
| Top paid | F62373/F62374 calls `navigationActions.collectionGallery('toppaid')`; F21797 constructs `/collectiongallery` with `collectionId`, optional product type/pricing and filters |
| Add-ons | F62370/F62371 calls the same wildcard search action with Addons=`addons`, yielding `/search/addons` |
| Redeem | F62364/F62365 performs signed-in and redemption-method checks; see below |
| My Wishlist | F62378/F62379 optionally calls an injected wishlist navigation callback and dispatches `navigationActions.wishlist`; F21822 pushes `WishlistRoute`, `/wishlist` |

F62355 selects each renderer by `SubNavButtonType.SearchGames`, `SearchAddOns`, `TopPaid`, `Redeem` or `Wishlist`. F62359 supports text, an optional icon, narrator label, position/set size, hint badge, high-contrast styling and separate focused/hover/pressed states. `EnableSubNavButtonGrayGradient` is a feature gate; the captured gray gradient is a real variant, not a universal color constant. Keyboard/controller focus must remain separate from activation.

Spotlight entries are typed destinations, not always games. F62522 distinguishes:

| Item type | Activation |
| --- | --- |
| Product | `gameDetails(itemId, …)`; DLC classification can select `dlcDetails` |
| Collection | `collectionGallery(itemId)` |
| Editorial | `editorialPage(itemId)` |
| Link | `openURL(itemId)` |

The product information route is `/store/gamedetails`, editorial is `/editorial`, and collection is `/collectiongallery` (F10548). The separately documented [product navigation trace](product-navigation-trace.md) binds a selected stable `productId` into game-details navigation. Product IDs, local game IDs, collection IDs, titles and URLs must remain different kinds of values. In particular, All PC games, Top paid and Add-ons are not searches for those English labels.

## Redemption and Wishlist are account features

F62364 reads `getIsSignedIn`. Its callback F62365:163–252 dispatches `userActions.signInFlow()` and returns when signed out; this trace does not establish automatic redemption retry after sign-in. F62366 reads `getIsIdentityMismatch` and selects **AMCRedeem** for a gaming/Store identity mismatch, otherwise **InlineRedeem**. F62365:264–345 either opens `redeemUrl` or dispatches `purchaseActions.redeemCode.start`. F10524:1630–1634 defines the external URL as `https://account.microsoft.com/billing/redeem`.

A Linux handoff may explicitly open that official account page, but it must not claim that a code has been redeemed or imitate a completed purchase. An inline redemption implementation needs its own trusted account, hosted commerce surface, completion/error/cancel handling and platform boundary. The original has richer native/hosted redemption contracts; a URL alone does not recreate them.

Wishlist is a dedicated account-backed collection. F11994–12000 have `pcgafd/wishlists` builders, including default-list creation/read, removal, add-product and visibility settings; F11999 uses `/default/products/addproduct`. F20963 invokes get-or-create through POST. F21410 maps collection identity, product IDs, total count, continuation and refresh lifecycle. The Store banner F62383 uses wishlist hooks, `hasStoreIdentity`, sorted products, pending removal and subscription access; F62384 counts `isOnGamePass` and sale conditions separately. It shows Wishlist, explanatory copy, total items, games in Game Pass/on sale, Show Wishlist and Share, with empty/signed-out variants.

The current app's device-local **Play later** collection is a different feature and must not be represented as a synchronized Xbox Wishlist. Cloud wishlist support needs account-bound read/write/visibility requests, stale-account cancellation, pagination, pending-operation rollback and explicit errors. Never show another account's prior list during account transitions.

## Store content and current backend limits

F65960 renders `WishlistQuickAddProvider`, `SafeBottomPersistedScrollView` and `LayoutModule` with `PersistedLayouts['gamingapp/store']`; it can insert Recently viewed at a computed location. F11987 builds the Store-home path `pcgafd/storehome`; F11963 supplies device-family and handheld context. F21396 hydrates spotlight items. The function names, parameters and layout path establish a service-fed layout boundary, not a complete recovered HTTP authentication/response contract.

The current local API has `searchCatalog`, `getFeaturedCatalog`, details, artwork and authenticated account-library data. `CatalogService.featured` requests public `TopTrending` with 12 results. That list is not the original Xbox Store-home layout. Current `CatalogProduct` can provide stable ID, title, description, publisher, poster/hero URL, categories, one formatted purchase price, included-with text, release date, rating and package-support state. It does not currently establish all of the following:

| Required for original behavior | Additional data needed |
| --- | --- |
| Hero campaigns and shelf order | Store-home layout, typed spotlight IDs/targets, localized text/artwork and campaign lifetime |
| All-PC/top-paid/add-on galleries | Correct category or collection service query, filters, sorting and continuation; never title-label substitution |
| Xbox Play Anywhere shelf | Explicit product capability/collection membership, not title or publisher inference |
| Deal/member badges | Numeric original/current/member prices, currency, offer eligibility, effective times and discount semantics |
| Picks for you | Genuine account recommendations; a trending list is not personalized |
| Owned/installed state | Current-account entitlement and verified matching local installation, independently of catalog availability |
| Wishlist banner/gallery | Current Store identity, synchronized list/count/visibility and per-product sale/Game Pass data |

An accurate fallback, honest loading/error state, stable product navigation and known public catalog facts can be implemented now. Complete live equivalence additionally needs those service adapters. Keep source failures visible and avoid relabeling arbitrary products as verified original shelves.

## Available icons and asset handling

The existing optional local kit contains `Store.svg`, `GiftCard.svg`, `Heart.svg`, `HeartWishlist.svg`, `ChevronRight.svg`, `ChevronLeft.svg`, `CheckInCircle.svg` and `GamePassInline2.svg` under ignored `public/original-xbox/icons`. Current `XboxIcons.tsx` exports Store, Gift, Heart, chevrons, InstalledCheck and GamePassBadge with public Lucide fallbacks. HeartWishlist exists locally but is not currently an exported alias. The captured five shortcut buttons do not require icons.

The original package also contains `HeartWishlist.svg`, `WishlistBackground.png`, `WishlistOnHomeBackground.png` and dark/high-contrast empty-card artwork. These are evidence locators, not a license to add them to Git. Minecraft's fallback locator is an original remote image; availability was not tested in this analysis. Game artwork should retain genuine product identity and available catalog URLs; never redistribute the Windows package, extracted fonts, original screenshots or account-specific cached assets.

## Verification boundary

This review verified the selected operands, constants, branches and route construction against the existing bytecode reader and local reference database. It separately inspected screenshot pixels and PRI values. It did not execute the original app, verify live commerce/wishlist services, determine every feature flag or prove pixel parity at other viewport sizes.

Implementation checks should cover exact product/category/collection IDs, Back restoring Store scroll, loading-to-fallback versus loading-to-campaign behavior, empty/error galleries, keyboard/controller focus without activation, no stale market/account/product response, and unavailability of private assets. A passing build or screenshot fixture does not establish cloud wishlist or purchase completion.
