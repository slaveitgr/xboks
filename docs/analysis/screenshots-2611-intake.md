# Xbox screenshot intake: 2611.1001.5.0

On 2026-10-21 the supplied archive was downloaded successfully and inspected as data. It contains **71 PNG images**, numbered 81–151, all **1920×1080**, with 58,214,778 uncompressed bytes. Every image was read with ZIP CRC verification, decoded/verified as a single-frame PNG and retained byte-for-byte. The archive SHA-256 is `cf9a68623f0593ee99be27386036d0b189e7dca4d5396f9179eb391880615855`.

The [sanitized capture catalog](reference/screenshots-2611.json) records each image hash, dimensions, surface and observation scope. Originals, account details, conversations, desktop contents, thumbnails, the download URL and the local gallery stay in ignored `work/reference/screenshots-2026-10-21/`; they are not public repository assets.

## Separate reference version

Headers visible in captures 84, 87, 89, 91 and 142 identify **Microsoft GamingApp 2611.1001.5.0**. Existing static package/bytecode analysis remains pinned to **2610.1001.20.0**. This intake adds a newer visual evidence layer; it does not convert older function IDs or contracts into analysis of the new binary. The Game Bar binary version has not been independently established here.

Comparison below is against xboks **0.3.12**, commit `007798b77fdc77a8334ac44358ac10b40a4ae9cd`. It combines visual inspection with current source, rather than assigning a misleading whole-frame pixel score to different content and application states. Several new captures include native window controls and the Windows taskbar; a future image comparison must explicitly match client bounds, locale, state and capture geometry. Existing equal-size comparison tooling must not silently resize or hide those differences.

## Concrete implementation gaps

| Area / screenshot IDs | New visible evidence | Current xboks gap / implementation boundary |
| --- | --- | --- |
| Library, 83/93 | Five tabs: My games, **My apps**, Play later, Play history, Install Queue; distinct Active and Ready to install lists, Add all/Ignore all, compact transfer preview | `LibraryChrome.tsx` has four tabs and omits My apps. `App.tsx` queue lacks the separate discovery/adoption section. Existing resumable queue logic must be preserved while rebuilding this frame. |
| Account, 84–88 | Full profile loading/loaded pages, achievements/recent games/social summaries; active subscription frame; in-app Offers and credits modal with Active/Redeemed/Expired tabs | View profile is disabled and Offers routes externally. No account profile page or equivalent offers modal exists. Billing dates, profile history, offers and linked accounts require actual service data. |
| Remote Play, 82/151 | A first-run introduction with illustration and Next control | Current console prompt opens the hosted console web client without this introduction. Screenshots establish the opening state, not the entire setup or stream success. |
| Home, 90/94–100 | Centered five-card Recently added panel; deals, franchise campaign, popular Game Pass, top free, benefits carousel, Play Anywhere, Coming soon and themed shelves | Current `HomePage` is substantially simpler: Jump back, Featured and generic Discover. Shelf composition, card geometry, pagination and data sources require separate implementation. |
| Game Pass / Store, 91/92/142–147 | Campaign carousel, pause/dots and partial next tile; centered Store hero, five category actions, Play Anywhere and multiple lower shelves | Current Game Pass has a small account-derived hero and one games row. Store uses a three-feature rail and exposes a manual install form. Page hierarchy must change; personal library membership is not campaign metadata. |
| Product, 101–103 | More tab with three-column information; Reviews sidebar/cards/actions; bundle contents and edition comparison | Current More shows limited metadata, Reviews is unavailable, and Details lacks bundle/edition sections. Do not synthesize ratings, reviews, legal text, sizes or entitlements when service DTOs do not supply them. |
| Friends/chat, 104–106/112/135 | Profile/avatar/status, notification bell, add-person/overflow, friend requests, unread badges, Start party row; messages with avatars/sender/time, bottom composer with Send/Add/More | Real personal chat/presence adapters exist, but renderer layout and menu placement differ. Group/system inbox threads and party voice remain separate unsupported capabilities; no private reference conversation is copied as app data. |
| Guide settings, 115–127 | Quick settings, compact/expanded toolbar and nested Back-header pages: Game features (116), Personalization (117–118), Input (119–120), Widgets (121–123), General (124–125) | More settings currently exits Guide into app settings. These need an internal guide navigation stack, state-specific layout and scrolling. Windows session, recording and controller services cannot be implemented by a cosmetic toggle. |
| Guide Home/directory/browser, 111/114/128/141 | Home/Library pair, recent apps, launcher icons; scrollable widget directory; browser with address/tabs/menu | Current Guide has six fixed tabs, an extra heading/queue row, no directory and external browser search. Preserve keyboard/controller Back boundaries when adding real widget navigation. |
| Guide Audio/Capture/Gallery, 129–132/140 | Mixer with applications and devices, capture controls and empty/resized Gallery window | System output controls and local microphone test exist. Current capture only saves the xboks window; video/desktop capture, capture library and resize state are absent. |
| Extra widgets, 113/133/134 | Spotify promotion/library and Performance telemetry | Neither complete widget exists. Playback/account authorization and real telemetry providers are required before presenting live state. |
| Guide social settings, 136–139 | Wider Account/Notifications/Accessibility pages; linked provider cards and visibility switches; speech/text options | Current Guide social has no such settings surface. Installed Steam/Twitch/etc software does not prove an Xbox-linked account; transcription controls need a real supported capability. |
| OS gaming experience, 107/110/148–150 | Windows desktop transition prompt, Xbox-mode entry choices and task switcher | These belong to distribution/compositor/session integration. Browser fullscreen or an app modal cannot establish OS-session parity. |

The ordinary expanded Guide panel already approximates the captured anchor at x=44, y=104, width=464. Missing pages, wider nested surfaces, toolbar states and behavior are larger gaps than that shared base anchor. Capture 136, for example, has a wider social settings panel that must not be forced into the fixed base width.

Capture 89 contains an OS protocol-handler error and 108 includes an unrelated third-party update popup. Preserve these originals as evidence, but exclude the unrelated overlays from Xbox UI acceptance. Captures 148–150 are operating-system task switching, including other applications, rather than new Xbox pages.

## Implementation order

1. Complete the client navigation model: fifth Library tab, separate discovery queue, profile/Offers/Remote Play opening states and product tabs.
2. Rebuild Home, Game Pass and Store shelf composition against named capture states and real catalog data.
3. Add the Guide's internal settings stack, widget directory and compact/wide states; retain Linux network/Bluetooth/power adapters and controller focus rules.
4. Match Friends/chat placement and add further widgets only with explicit service/platform capabilities.
5. Capture matching Greek 1920×1080 states from the actual renderer, then run `scripts/ui/compare-reference.py` with explicitly documented client bounds/masks. Test navigation independently from visible pixels.

This intake changes the reference library and gap analysis. It does not claim those UI gaps were implemented, that original click outcomes were recorded, or that Xbox services/OS integration were validated.
