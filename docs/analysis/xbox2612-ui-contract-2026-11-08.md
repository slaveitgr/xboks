# Xbox 2612 CE shell and Home implementation contract

Recorded 2026-11-08 from the user-supplied `Microsoft.GamingApp 2612.1001.23.0` package. These are shipped layout values and bounded source-flow facts for independently implemented XBOKS components. They are not a complete UI reconstruction or a claim that every account/configuration renders the same surface.

## Identity and REA pass

The source is the extracted `Play.Xbox.20261101-1137.zip`, SHA-256 `abcaaa4cc6cd1ee7baddd52be30da1f0c77b9cb890047ee38a382948dd3b1e8b`, from the pinned bundle SHA-256 `a44c5bb5bc33df73453189e9773485b7da246678ad8574c046c69225142074cb`.

An actual focused REA `analyze_javascript_application` pass selected:

- `assets/Shell-n50awoo2.js`
- `assets/HomeRoute-l1dcwsp1.js`
- `assets/ShellLayout-z3tw18an.js`

Parent Evidence: `ev_feb15b260b0d4ed451e703026956cff0b3d6a16c17419d1c984c3ef2b084dea1`.
Summary Evidence: `ev_4a88186288adc99628a008de811d39e7685ec31650833ee6437722f44b54a824`.
Home module-reference view: `ev_a13428d133c0ae058df1c5d43e895c2648916d228e027bcbcc98476dd0d64aba`.
Selected file-facts view: `ev_eb536d80e0b290c9860b881a2a982031a82dd8019c9c4ec272e65d47d80127b2`.

REA parsed all three selected JS files with no syntax failures, reading 277,448 bytes and visiting 86,829 AST nodes. Semantic retention reached the 20,000-node per-file ceiling in two selected sources; 1,205 inventoried files were outside this selection. The application/semantic relationship graph is partial. No packaged script was executed by this analysis. Retention limits do not invalidate exact inert-source declarations, but they prevent a complete call-graph claim.

The exported private Evidence bundle is `work/xbox-2612/rea-ui-contract-2026-11-08.json` (78,827,814 bytes, four records). It remains outside Git. CSS declarations below were independently resolved from the original CSS through its semantic utility selectors and density/theme token values; they are static file observations, not a REA CSS semantic graph or measured runtime geometry.

## Exact source pins

Paths are within the shipped web archive.

| File | SHA-256 |
| --- | --- |
| `assets/Shell-n50awoo2.js` | `c78560969ebaeb62715b94f8149f09dd322c104f7557af4d05d298f3d637d59b` |
| `assets/HomeRoute-l1dcwsp1.js` | `06f96aade67fdb50c17d7563306a343aa5113cfcfe386fb9c8cf432aaf0b69fa` |
| `assets/ShellLayout-z3tw18an.js` | `6e41a16e1367b0a2dd7387b73fa10cbc295d35f9c3fd7b9afe8b319f41e972b4` |
| `assets/navDensityVisibility-ls5spu3e.js` | `eb04348fb0da9b483f4cf8603c4d9bc35d17fc8bd08594bad75b655e42e599d5` |
| `assets/customTokens-djnd6qc8.css` | `4d3e152e21a1f2203aa4ac2ba8f03a6a7158a6c1998f6c0281269a918dd19f1e` |
| `assets/high-k9x8a3m0.css` | `c15f5eae03f08b4c0d284fd6aac03e2cfbc3f0d39a5444896011d3b1fb706b58` |
| `assets/low-l7i7b210.css` | `83acfd91be0762e1f42f2786fff6599ad482d0629253587f3ae08bc1a6d6ba12` |
| `assets/standard-dark-z2qkyvot.css` | `bc7233374bf121ba334acec600c8d2b6b81d6fad5eb7bf217103664bb2f9e56c` |
| `assets/tailwind-b5k1rjp2.css` | `cd8439dabc6a11d4cc17765f7555101740d080326b8a3a275d259587ae52751c` |
| `assets/fonts-subset-g53lrknw.css` | `0e3abe356036ee9a39e1bf39e75cca437a767b0a31c7dc2f7c171879d94e785c` |
| `assets/xds-icons-kurzwpm0.js` | `ce1837f426e3b0e53cb57f9eb41a50ebf9b15623e42d3e1d9674bfac6460e44f` |
| `assets/StaticHomeBody-ea5ks26l.js` | `6fe28c306741893181f841fcdd23de8ad1921091b5cb8cb1ae4345e315f913f9` |

The last file is an inventoried/pinned MRU dependency, not a separately completed semantic trace in this pass.

## Desktop shell geometry

The high-density desktop dock is governed by application state plus media queries. A single percentage-width sidebar does not reproduce it.

| Condition | Shipped value | Source locator |
| --- | --- | --- |
| Collapsed dock | 83px outer width | `customTokens`: `--V3:83px`; `--V2:var(--V3)` |
| Default high density, width 960–1439px, height at least 481px | 83px unless the explicit expanded state overrides it | `customTokens` high-density media rule |
| Default high density, width at least 1440px | `clamp(352px, calc(10vw + 208px), 400px)` | `customTokens` width-1440 media rule |
| Explicit expanded state, width at least 960px | The same 352–400px clamp | `:root[data-density-mode=high][data-dock-expanded]` |
| Explicit collapsed state, width at least 960px | 83px | `:root[data-density-mode=high][data-dock-collapsed]` |
| Dock internal start/vertical padding | 15px | Shell `ps-internal-container-padding-regular` and `py-internal-container-padding-regular`; high token `--V2JY` |
| Native Bastion title bar | 48px | Tailwind root `--bastion-title-bar-height` |
| Dock below the native title bar | Top margin 48px; height `100dvh - 48px` | Shell `isTitleBarVisible` style branch |
| Desktop content top padding | 80px plus safe-area top | `pt-safe-offset-play-xbox-page-padding-top` → `--VG` in high density |
| Dock tab minimum height | 56px | `min-h-play-xbox-dock-nav-bar-tab-item-min-height` → `--VL` |
| Tab horizontal padding | 18px | `component-navigation-global-tab-item-container-padding-right-and-left` → `--V2M1` |
| Tab icon/text gap | 16px | `internal-icon-and-text-gap-action-separator` → `--V2K0` |
| Dock-search input variant | 320px | Shell `nav-search-input`, literal `w-[320px]` |
| Other responsive top-nav search variant | Flexible, maximum 960px | `max-w-play-xbox-nav-search-input-max-width` → `--VJ` |

For example, an explicitly expanded 1110px viewport has a 352px outer dock. With its 15px start padding, the visible inner panel begins at x=15 and is 337px wide. This follows the shipped CSS; it does not infer the user's saved expanded/collapsed preference.

The shell content maximum is 1920px. Its overflow gutter derives from the viewport minus the document scrollbar, dock width and this content maximum, clamped at zero. It is separate from page horizontal margins. Native title-bar height, page padding and the shell dock width must be represented separately.

## Density and typography

Values below assume a 16px root rem. CSS rem declarations should be preserved rather than converted into an unconditional viewport scale. All listed desktop/fullscreen examples have height at least 481px.

| Semantic value | Desktop high, 1280px and wider | Low density, 1280–1919px | Low density, 1920px and wider |
| --- | ---: | ---: | ---: |
| Horizontal page margin (`--V2JJ`) | 48px | 48px | 80px |
| New-section tight spacing (`--V2JT`) | 48px | 48px | 64px |
| Regular radius (`--V2ME`) | 8px | 10px | 12px |
| Body (`--V2H2` / `--V2OL`) | 1rem / 24px | 1.25rem / 32px | 1.625rem / 40px |
| Title 1 (`--V2OE` / `--V2OD`) | 2rem / 40px | 2.5rem / 48px | 3rem / 56px |
| Title 2 (`--V2H1` / `--V2OL`) | 1.25rem / 24px | 1.625rem / 32px | 2rem / 40px |
| Primary nav selected title 3 (`--V2H2` / `--V2IL`) | 1rem / 20px | 1.25rem / 24px | 1.625rem / 32px |
| Subtitle 2 (`--V2PI` / `--V2PH`) | 1rem / 20px | 1.125rem / 22px | 1.625rem / 32px |
| Nav icon (`size-icon-subtitle-2` → `--V2H2`) | 1rem | 1.25rem | 1.625rem |

Desktop high width 960–1279 uses a 32px horizontal margin. Low width below 960 uses a 24px margin and smaller type; the 960–1279 low range uses a 32px margin. These are actual breakpoint changes, not a uniform `clamp()` for all dimensions.

The primary dock labels select `type-title3` at weight 600 when selected, and `type-subtitle2` at weight 400 otherwise. Small recent-item/secondary-label styles are distinct; applying their 14px desktop size to primary navigation would be incorrect.

The font-family declaration is `Segoe Sans Variable Text`, then system fallbacks. The shipped font stylesheet includes Greek subsets. This records metrics; this document does not distribute Microsoft font files.

The standard-dark token mapping includes primary text `#fff`, secondary text `#ffffffa6`, selected invisible-container rest background `#3b3f444d` and transparent default invisible-container background `#1a1b1e00`. Backdrops, focus/hover and theme overrides remain separate states.

## Navigation and interactions

The concrete desktop primary dock child order is:

1. Home
2. Library, when its route is enabled
3. Game Pass, when enabled
4. Store, when enabled

The tab uses separate route-current and visual-pending-selection state. A pressed destination can show pending selection before routing completes. It must not mark an unrelated route as successfully loaded.

Remote Play and controller entry points are declared in the top-bar variants, rather than being inserted into this primary dock sequence. Search, notifications, profile and Xbox-mode buttons vary by the selected shell variant and signed-in state. Cloud destinations in an older client screenshot do not establish a 2612 primary-dock item.

The dock supports explicit expanded/collapsed state. Its source drag recognizer waits for 10px of primary mouse/touch movement, rejects a predominantly vertical gesture, then toggles after 48px of horizontal travel. RTL reverses direction. It cancels on pointer cancellation/window blur and suppresses the following click after an active drag. The width transition is 300ms with reduced-motion/animation-off overrides.

Icon component identities are named in the pinned icon module: `Home`/`HomeSolid`, `Library`/`LibrarySolid`, `GamePass`, `Store`/`StoreSolid`, `RemotePlayConsole` and `Search`. Filled/unfilled navigation states are intentional. The module includes animated and static forms with differing viewBoxes; dimensions must come from the surrounding icon token, not the SVG viewBox number.

## Home content contract

The packaged local signed-in layout declares this order:

`MRU → Spotlight → OfferBanner → PlayWithFriends → Trending → RecentlyAdded → EditorialChannels → ComingSoon → Deals → Genres`.

The signed-out layout instead declares:

`MRU → Spotlight → OfferBanner → PublisherCollections → TopFree → RecentlyAdded → EditorialChannels → ComingSoon → Genres`.

These are local fallback module specifications. The dynamic-page feature can request a service-fed remote layout. Pending remote layout shows a skeleton. Failed/invalid remote layout falls back to local; market/content availability and sign-in predicates further affect rendered modules. Do not turn this declaration into fabricated personal shelves, player counts or a promise that every module is visible.

`PureMRUSection` shows an exposure skeleton while pending, renders nothing without store content, and otherwise creates the inline MRU with the resolved cloud-content availability. The page has a separate offline-MRU suppression branch. A game tile's primary press, hover preview and context-menu actions are not established by these three selected source files; `StaticHomeBody` and its tile dependencies are the next trace boundary.

The local Spotlight configuration includes typed navigation actions such as a buy-and-stream gallery. Product and collection actions need separate routing from arbitrary external URLs. A local image/name match does not validate its service-fed destination.

## Implementation and observation boundary

The geometry and state declarations above can guide original React/CSS components now. Runtime acceptance must still compare the exact original and XBOKS at recorded viewport, density, root font scale, expanded/collapsed state, locale and feature configuration.

Remaining checks include original Home initial/scrolled content, the real dock toggle/drag, Back restoring scroll/focus, search-overlay behavior, each profile-menu destination, MRU click/hover/context-menu behavior, high/low density changes and streaming/social results. The original client's currently running route and account contents were not inspected by this static pass. Legacy UI screenshots are not relabeled as new CE reference images.
