# Profile, membership badge and Cloud Gaming navigation

This targeted static review covers the locally supplied **Xbox app 2610.1001.20.0 x64** Hermes v96 bundle and its mapped PRI resources. The input bundle SHA-256 is `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. The separately supplied screenshots identify **2611.1001.5.0**; their visible states corroborate layout, but do not establish that the newer binary has identical functions or gates. No original package code was executed, no account was queried, and no original binaries, fonts, private screenshots or account details are included here.

Function offsets below are decimal and relative to their function. The private function evidence and SQLite index remain under ignored `work/reference/library/`. The [bytecode evidence chapter](bytecode-analysis.md) explains their limitations.

## Expanded and compact navigation are distinct shell states

| Evidence | Contract |
| --- | --- |
| F22756:127/133 and 139/142 | `navPaneExpandedWidth` is **260**; `navPaneCollapsedWidth` is **68**. |
| F22756:228–248; F22762:7–48 | `NavPaneMode` exposes `Desktop` and `Handheld`. The width selector chooses collapsed width for `Handheld`, expanded width otherwise. |
| F67983:116/122; F68194:182/188 | The shell and ordinary navigation item both read `shellSelectors.isUsingExpandedNavPane`. |
| F68194:648–723 | The text-label construction is conditional on the expanded-state result. The icon, accessibility label, tooltip and selected-route behavior are separate. |
| F67683:333/341, 788–806 | The account button has separate collapsed/expanded styles and passes `isExpanded` to `GamerProfile`. |
| F67734:9 and 199→361 | The collapsed account header retains the gamer picture; the gamertag and subscription badge are inside the expanded branch. |

The supplied profile captures **S2611-084/085** show the narrow icon rail. A badge absent from that rail is consistent with the original. A wide rail with visible account text should show the verified main subscription badge when its data is available. Compact shell presentation, sign-in identity and membership status must remain independent.

The original also varies Store position through `EnableMoveStoreTabHigherInNavPane` (F67983:151/166/172). A fixed screenshot order is not proof that the flag has the same value for every account/build.

## Cloud Gaming is a real navigation destination

| Layer | Concrete evidence |
| --- | --- |
| Label | PRI `Resources/Navigation_CloudGamingTab` has EN-US and EL-GR candidates **Cloud Gaming**. |
| Navigation control | F67983:1208 literal identifies `NavPanel_CloudGamingButton`, `Lottie_XCloud_Black` and `Lottie_XCloud_White`; label resolution is at1240/1246 and `onPress` assignment at1280. |
| Route constant | F10548:327/331 assigns `NavigationRoute.XCloudRoute` to **`/xcloud`**. |
| Selection action | F67986 obtains that route URI at60–83, uses `CloudGamingTab` telemetry, announces selection, and invokes `navigationActions.xCloud` at189/195. |
| Navigation implementation | F21807:7–29 pushes `XCloudRoute`. This is distinct from F10548's `/streaming` route. |
| Ordinary-shell visibility | F67983 invokes `getIsXCloudSupportedInMarket` at97/103; its result is combined with `getIsGamePassUltimateSupportedInMarket` at456/462. The resulting condition gates Cloud control construction at1154→1310. This is market support, not a check that the current user owns Ultimate. |
| Separate demonstration shell | F68320 also constructs a Cloud item at671, but its handler opens the RDX modal. This branch must not be mistaken for the ordinary authenticated route. |

The local asset kit already contains `Cloud.svg` and `CloudSolid.svg`. Their source package members are under `Bundle/assets/node_modules/%40gaming/xds-foundation/svg/`. The actual navigation control uses the named Lottie assets; using the SVG is a static icon implementation choice, not proof of animation parity.

Current xboks has no Cloud page in its `Page` union. Its backend capability named `streaming` concerns Store package/license/content operations and must not authorize Xbox Cloud Gaming. The existing Remote Play host uses `/play/consoles`; it represents console streaming, a separate destination. A new Cloud page may offer an explicit hosted-cloud handoff, but service availability, cloud catalog access, session provisioning, controller input and successful game streaming require their own implementation/evidence.

## The subscription badge comes from account entitlement data

F67734 `GamerProfile` reads `userSubscriptionSelectors.getMainSubscription` at37/43/51 and its `productId` at67. The gamertag uses `forceHideSuffix: true` and `includeRealName: false` in the object at254. Neither Store promotion art nor the currently selected Game Pass page supplies this badge.

F67735 `SubscriptionBadge` compares the subscription ID and selects these glyphs/literals:

| Plan identifier | Source enum value | Badge glyph | Original size |
| --- | --- | --- | --- |
| `CFQ7TTC0KHS0` | `SubscriptionId.Ultimate` | `GamePassUltimateFullHeight` | **70 × 14**, literal at606, glyph at645 |
| `CFQ7TTC0KGQ8` | `SubscriptionId.Pc` | `BadgePCGames` | 69.125 × 14, literal at505 |
| `CFQ7TTC0P85B` | `SubscriptionId.Standard` | `BadgePremium` | 66.5 × 14, literal at404 |
| `CFQ7TTC0K5DJ` | `SubscriptionId.Core` | `BadgeEssential` | 70.875 × 14, literal at303 |

F21081:281–351 maps those product IDs, also including Console, Duet and UltimateFamily. Its `SubscriptionStatus` keys at233–273 are Active, Expired, Banned and Revoked. Its `subscriptionTierPriority` array at1487–1551 is Ultimate, Standard, Core, Pc, Duet, Console. The newer displayed Premium/Essential names coexist with legacy internal Standard/Core identifiers. Do not substitute plan names for product-ID validation.

This priority is used by the actual header selector: F27802 creates a selector with F27833 at682/687 and exports it as `getMainSubscription` at1203. F27833 iterates `subscriptionTierPriority` at14–30, maps each entry through `subscriptionIdToNameMap` at45/51, and returns the first entry whose `isActive` is true at77/83/92. A separate recurrence-sorting helper has a different purpose and must not determine this header badge.

`public/original-xbox/icons/GamePassUltimateFullHeight.svg` and `GamePassUltimateInline2.svg` already exist in the private local asset kit. The former is the exact named glyph used by this header's Ultimate branch. This review adds no asset copies or redistribution authorization.

The other exact source assets are **`BadgePCGames.svg`**, **`BadgePremium.svg`** and **`BadgeEssential.svg`**. Names such as `PCGamePassFullHeight.svg`, `GamePassPremiumFullHeight.svg` and `GamePassEssentialFullHeight.svg` are not present in this MSIX. No Console badge branch exists in F67735 and no Console subscription SVG was found in the package. `GamePassInline2.svg` belongs to its Duet branch, not Console. A retained Console label should therefore use text fallback. Every badge must also fall back to text when the private original asset kit is absent or cannot load.

xboks has an account-bound `auth.subscription` summary and `subscriptionBadge()` validator in [subscription.ts](../../../src/shared/subscription.ts). It accepts known plan IDs and a bounded timestamp, and the Sidebar's `AccountMembership` displays a badge only for a validated active result. This task changed the previously recognized five-ID selection to explicit **Ultimate → Premium → Essential → PC → Console** priority, independent of provider result order, matching the original header selector. It adds no newly recognized product codes. Failure or unknown status must not become a claimed Ultimate membership.

The inspected backend source's `subscription.rs` uses the existing authenticated Store subscription-entitlements query, validates Active plus future expiry, returns only allowed product IDs with `checkedAt`, and binds its short-lived cache to the selected account. It does not expose billing dates, payment instruments or renewal controls to the renderer. Cached membership and unavailable membership are separate from a signed-out account.

## View profile navigates internally with verified identity

| Evidence | Contract |
| --- | --- |
| F67712:4227–4422 | The account menu has a distinct Profile item, `ViewProfileButton`, `profileHandler` and associated `ProfileRoute`. |
| F67697:7–32 | The handler obtains loaded or previous `userXboxProfileLCE` data. |
| F67697:51/57/62, 77/83 | It calls `props.navigateToProfile(profile.xuid)`, then `Popup.dismissAll()`. It does not open a gamertag-derived external URL. |
| F10548:107/111 | `NavigationRoute.ProfileRoute` is **`/social/profile`**. |
| F21815:11–27 and 44–105 | The route has `xuid`, optional `content`, pathname ProfileRoute, and encoded query search. Its third argument selects push versus replace at117–141. |
| F66939 `ProfileScreen`:16–45, 103, 135/155 | The screen reads authenticated user information, uses an XUID, announces loading, and has separate signed-out content and ProfilePage branches. |
| F66980:154/160; F67219:164–337 | Profile content initially selects Achievements; explicit achievements/about content choices have their own labels and handlers. |
| F67231:15–218 | Header and achievements-header loading templates are separate from loaded content. |

Short localized resources are `ProfilePage_AchievementsTabHeader` (Achievements / Επιτεύγματα) and `ProfilePage_AboutTabHeader` (About / Πληροφορίες). A profile view should preserve loading, unavailable and signed-out states rather than render fabricated zero totals while data loads.

The loaded reference profile visibly separates identity/presence, social links and counts, bio/location, account achievement summary, per-title achievement progress, recent titles, supported devices and earned badges. None of the private example values are copied here.

## xboks adapter baseline for this task

This inventory records the source state inspected before the profile/Cloud navigation changes in this task; later implementation may extend these DTOs. The package findings above remain independently pinned to the original bundle.

The task's subsequent source adds validated optional own-profile details through `XboxSelfProfileDetails` (including provider gamerscore, bio, location and display names), plus explicit cache/refresh/error status. Older engines may omit them. A parser accepting those fields does not establish that the installed engine returned them or that original social totals, profile writes and earned badges are implemented.

| Data | Current adapter evidence and limits |
| --- | --- |
| Own gamertag and gamer picture | [account-profile.ts](../../../src/main/account-profile.ts) invokes the selected backend's `profile --json`, validates account/schema, and caches only that account's normalized picture, gamertag and subscription. It discards unknown fields. |
| Verified own XUID | Already available through [XboxSocialResult.selfXuid](../../../src/shared/xbox-social.ts). The bundled companion's `social.rs` reads one self profile, validates its decimal ID, and publishes it in ready results. [parseXboxSocial](../../../src/main/xbox-social.ts) checks account equality and validates the XUID; account/backend changes cancel requests and clear its in-memory cache. The disabled account-menu tooltip claiming no backend XUID is available is therefore stale. |
| Current-account subscription | `auth.subscription` is usable when validation succeeds. A badge is not evidence of cloud-region support or a live cloud session. |
| Friends and their presence | Existing friends results support a real list. Treat a loaded list's length as a loaded subset unless result completeness is established; it does not establish following/follower totals. |
| Per-title activity and achievements | Separate existing adapters can provide their own authenticated title results. A sum of known local-game achievements must not be labeled the account's whole-profile Gamerscore. |
| Bio/location, follower/following counts, tenure/earned badges, linked social accounts, complete account achievement totals/history | Not currently exported by the own-profile DTO. The separate profile view must mark these unavailable or add explicit account-bound backend fields and validation before displaying them. |
| Profile editing and presence writes | Need dedicated authorized service operations. A visible button or a successful profile read is not an implementation of these writes. |

A current-account in-app profile route can therefore be implemented immediately around verified own identity, membership and existing read adapters. Its selection must remain bound to the account that started the request across awaits; logout/account change must clear private results. Using a returned verified self XUID is preferable to deriving identity from the display gamertag. Full original profile/service parity remains a separate task.

## Reproduce the targeted lookup

The existing tooling reads local package bytes without executing them:

```sh
python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def --function 67986

python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def --function 67735

python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def --function 21815
```

Use the private SQLite `string_sites` → `strings` join to locate identifiers and the named PRI candidates to verify localization. String hits, imports, test IDs and static visibility gates do not prove an authenticated cloud session, profile write, effective server feature configuration or runtime behavior of the newer screenshot build.
