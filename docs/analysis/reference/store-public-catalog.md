# Public Store collections

Verified anonymously on 2026-10-21. These sources supply actual catalog products,
separate from the original app's authenticated `pcgafd/storehome` editorial layout.
The source order is retained; no title search is renamed as Top paid.

| Gallery | Official request | Observed first / second page |
| --- | --- | --- |
| All PC games | `https://apps.microsoft.com/api/products/search?query=*&mediaType=games&age=all&price=all&category=all&subscription=all&gl=US&hl=en-us` | 20 / 20 products, distinct service cursors |
| Top paid | `https://apps.microsoft.com/api/Reco/GetComputedProductsList?listName=TopPaid&pgNo=1&noItems=24&filteredCategories=AllProducts&mediaType=Games&gl=US&hl=en-us&exp=0` | 22 / 18 products, title `Top paid games`, next page 2 / 3 |
| Add-ons | `https://apps.microsoft.com/api/products/search?query=*&mediaType=addons&age=all&price=all&category=all&subscription=all&gl=US&hl=en-us` | 3 / 0 products, followed by `hasMorePages=false` |

The add-on route returned `9P5JQ1XPRGN6`, `9PKCNQ57B2JG`, and `9P4HCS6S5C2K`:
Minecraft Dungeons expansions for Windows. Each row explicitly supplied category
`Add-on`; an independent `displaycatalog.mp.microsoft.com/v7.0/products` request
confirmed all three have `ProductType=Durable`. The implementation rejects a
response containing base-game categories rather than filling the add-on gallery.

The public Microsoft Store web client at
`https://apps.microsoft.com/assets/js/telemetry-service-BHr57qHt.js` exposes
`search(query,mediaType,age,price,category,subscription,cursor)` and
`getComputedProductsList(listName,pgNo,noItems,filteredCategories,mediaType,...)`
with these parameter names. Its TopPaid enum and computed collection route are
also present in the public client. Chunk names may change; they are evidence,
not application dependencies.

`CatalogService.collection(kind, market, cursor?)` accepts only `all-pc`,
`toppaid`, and `addons`. Requests omit credentials, reject redirects, time out,
and cap responses at 2 MiB and 60 rows. Paging tokens bind the source cursor or
page to its gallery and normalized market; invalid/nonadvancing pages fail.
Package support still comes from existing DisplayCatalog enrichment. Returned
prices and inclusion text remain separate from ownership and local installation.

These galleries do not establish editorial deals, Xbox Play Anywhere eligibility,
member discounts, personalized recommendations, or cloud wishlist access. The
Store renderer uses the source-backed original Minecraft fallback and honest
generic catalog/genre headings until corresponding providers exist. See
[original client navigation evidence](store-navigation.md) for the fallback,
loading placeholders, and captured layout measurements.

Focused validation: `npx vitest run src/main/catalog.test.ts
src/renderer/xbox-store-page.test.tsx`; isolated renderer validation:
`node scripts/ui/store-smoke.mjs work/store-ui-smoke`. The fixture uses synthetic
catalog products/prices and a locally served public fallback image; its browser
can access only the fixture origin and uses private HOME/XDG paths and disabled
system/session D-Bus addresses. It does not sign in, purchase, install, or touch
the running application.
