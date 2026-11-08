# Xbox 2612 Settings V2 reconstruction

Checkpoint: 2026-11-08. Target: the New app experience shipped in Microsoft.GamingApp 2612.1001.23.0. This checkpoint covers the Settings shell, route ownership and selected existing Linux settings providers. It does not establish complete Windows feature or visual parity.

## Evidence

The selected shipped member is `assets/SettingsDialog-fcedlpya.js`, SHA-256 `0ffc4f4f6eddff64a4c9e28669e0bd8acb85bc10fe470aa584f36cb0c9e34409`, 589,123 bytes. Its source archive is `Play.Xbox.20261101-1137.zip`, SHA-256 `abcaaa4cc6cd1ee7baddd52be30da1f0c77b9cb890047ee38a382948dd3b1e8b`.

A new focused REA pass analyzed that exact source without executing its bootstrap:

- Parent application evidence: `ev_c7d24c303de6e933d5cb62681fb27fcc84e97a5022c89fc81efb935506cf6181`.
- Summary: `ev_d1500f06e1256a7ff3b5bc3bb21d92ea757d05d3a131b5953e08065beabc7197`.
- One source parsed, no syntax failure. Semantic retention was limited to 5,000 nodes and 1,000 unknowns; other application sources were outside scope. A successful parse is not a complete control-flow or service analysis.
- The ignored export is `work/xbox-2612/rea-settings-reconstruction-20261108.json`.

Attempting to authenticate the older, much larger focused export exceeded the analysis server's available heap headroom. That unchanged request was not repeated; this smaller selected-source analysis provides the current evidence boundary.

Additional inert CSS facts were checked against:

| Member | SHA-256 |
| --- | --- |
| `tailwind-b5k1rjp2.css` | `cd8439dabc6a11d4cc17765f7555101740d080326b8a3a275d259587ae52751c` |
| `high-k9x8a3m0.css` | `c15f5eae03f08b4c0d284fd6aac03e2cfbc3f0d39a5444896011d3b1fb706b58` |
| `low-l7i7b210.css` | `83acfd91be0762e1f42f2786fff6599ad482d0629253587f3ae08bc1a6d6ba12` |
| `standard-dark-z2qkyvot.css` | `bc7233374bf121ba334acec600c8d2b6b81d6fad5eb7bf217103664bb2f9e56c` |

These establish utility mappings, theme values and density declarations, not their complete resolved values in every host configuration.

## Observed original client

The parent investigation navigated the running original client through its own Account menu and Settings without changing a setting:

- Account Settings capture: `ev_86fbccdae8c20089110d7b753a9e3ff3a75796e8fd4c36ffa9bbf90ee0cdc05e`.
- System category capture: `ev_de35ff6b90c5d820ee163aa3809215a00b8abb6cc8d10bb6cbb7d74ad4e411c0`.
- Devices & connections: `ev_c788ff9093da51e1c59bb5d7797d6f6cef3c1692daa25b7a2ca61970c416a145`.
- Play & social: `ev_5c7c784b56ab4d49632f4bf8f302f44a8430f750ae4fc3e43728df22fcaac754`.
- Apps: `ev_3eb162154218b6a1becc0aaf1c7f2ad39f4cae47923d30082ad13b212e328f6a`.
- Accessibility: `ev_7d032d6d68781a8ae812ea4dbc43a4e214fa8d99fc985af73c54cb71fe89f0d7`.

At the recorded 1641 × 1049 capture, the desktop modal occupied approximately 1200 × 895 pixels, with a 272-pixel rail. The rail showed the actual profile, six text category buttons and Help & feedback. Main rows had approximately 70-pixel height, 8-pixel gaps and 12-pixel corners. Private account and friend imagery from those observations is not published here.

The observed signed-in Account order was View profile, Redeem a code, Subscriptions, Privacy & safety, Change gamerpic, Change gamertag, View order history, Request a refund, Manage Microsoft Store account and Sign out. It was a menu of actions, rather than the previous XBOKS profile form.

The observed System order was Notifications, Display, XBOX mode, Install & storage, Audio, Language & region, App startup and About. Developer was absent in that runtime. These observed labels and ordering take precedence over guesses made from the registry alone.

The observed Play & social root contained Offline play, Cloud Gaming and Remote Play. Manage games was not exposed by that runtime. The Devices & connections content was empty under the Wine host; that does not establish the page is empty on Windows.

Apps contained Detected apps and Compatible apps sections, without a large Apps heading. Its provider identities were Battle.net, Steam, Ubisoft Connect, EA app, Epic Games Store, GOG GALAXY and Riot Games. The original host detected the first three; XBOKS must use its own measured Linux detection instead of copying that host's state.

Accessibility displayed preferences inline: themes on profiles, video preview on hover, background images, Motion and further accessibility links. Motion offered System default, Full, Reduced and Off. The source registry's additional accessibility detail routes were not rendered as root cards in that observation.

## Source contracts used

The registry near byte 562,000 declares Account, Devices & connections, System, Play & social, Apps and Accessibility. Recommended is mobile-only; Apps and related provider routes are gated by the desktop host; some Account and notification details have commerce/authentication predicates. XBOKS does not fabricate those Windows host flags.

Audio belongs to System. Offline play belongs to Play & social. Safety/privacy belongs to Account. Notifications has General, Social & messaging, Achievements, Promotions & marketing and Store updates child routes. Accessibility declares Audio & visual assist and High contrast detail routes.

The renderer near byte 584,000 selects the same V2 route registry in both density modes. The desktop presentation is a rounded modal capped at 1200 pixels and a viewport-relative height accounting for the title-bar safe area. Low density uses the full-page presentation. The master-detail renderer separates category navigation, nested detail Back and content scroll history; it does not restore the older nine-item Settings rail merely because the desktop density is active.

The shipped Xbox mode provider checks supported, active and permission state independently, serializes transitions and reports an error when the native transition cannot be confirmed. Window fullscreen alone is insufficient evidence of an active OS gaming mode.

## XBOKS changes

- Both desktop and fullscreen Settings now use V2 navigation, with density-specific sizing.
- The signed-in Account root follows the observed ten-action menu and uses only the authenticated profile supplied by the app. Sign-in/session controls remain available to the signed-out flow.
- Root callbacks handle View profile, sign-in, sign-out and Help & feedback. The existing backend capabilities still gate account writes.
- Corrected category ownership and observed System order; Developer visibility follows the local developer preference.
- Added notification child-page routing and part filtering, so one child no longer exposes unrelated settings from the old page.
- Back handles provider subpages before notification parents and categories. Category and detail transitions retain scroll positions and return focus to the originating row. Narrow navigation separates the rail, category page and detail page.
- The Xbox mode switch now requests both entry and exit through the existing acknowledged fullscreen-experience API. Wrong or unavailable acknowledgements fail rather than claiming success.
- Devices reads connected controllers from the browser's Gamepad API and opens Bluetooth settings through the existing validated IPC. Missing device data is not interpreted as disconnected hardware.
- License history, save management, billing and notification preferences continue to state when the connected service does not provide them. No successful service result is synthesized.
- Apps now uses the observed seven-provider grid and sections, with pending/error/actual Linux detection states. Provider account linking and automatic library import remain explicitly unavailable. The Display My apps preference is stored locally and emits the existing library-change event; its consumer is integrated by the app shell.
- Accessibility now keeps the observed inline layout and four Motion choices. Legacy reduce-motion preferences migrate to Off; System default tracks the OS reduced-motion media preference. Reduced suppresses spatial transitions and keeps short color/opacity feedback. This is a renderer preference, not a native Windows motion implementation.
- Existing Engine, Proton, storage, download and account providers remain reachable through the new routes. Engine and download controls live under System → Install & storage; verified launcher updates live under System → About. Signed-in wallet diagnostics remain reachable from About → XBOKS Engine settings, and signed-out account session controls retain their existing keyring flow. The duplicate unguarded sign-in entry was removed; the remaining form preserves backend capability and in-progress authentication guards.

## Remaining boundaries

Redeem, gamerpic/gamertag editing and Microsoft account management retain the existing Microsoft website handoffs. Their inline Windows dialog/service behavior has not been recreated by this change. Apps uses the Linux launcher integration and detection providers; it is not the Windows native extension host. Missing optional provider artwork falls back to its provider initial; complete asset parity is not established. Devices is an explicit Linux adaptation with measured controller status and existing Bluetooth settings access, rather than a claim that the Wine-host blank page represents Windows behavior. Language support remains the app's implemented languages. Per-game save writes, full billing data and unsupported notification preferences are not supplied by this UI work.

Only the recorded desktop original was visually checked for the geometry above. Fullscreen Settings, the narrow layout, gamepad focus/Back transitions, all notification detail pages and account actions require additional runtime comparison. The local React checks exercise rendering and selected navigation/acknowledgement contracts; they do not prove the full UI or service behavior.

## Verification

The final focused Settings and reachability checks passed 64 tests across `settings-v2.test.tsx`, `settings.test.tsx`, `original-settings.test.tsx`, `appearance.test.ts`, `account-profile.test.tsx`, `browser-sign-in.test.tsx`, `keyring-setup.test.tsx` and `maintenance.test.tsx`. Scoped `git diff --check` passed. They cover category ownership/order, guarded native mode acknowledgements, Back priority, notification isolation, actual provider identities, preference save failures, legacy motion migration and dynamic OS motion changes. Additional app-level account, keyring and maintenance checks verify that the moved controls remain reachable and their capability guards remain in place. The final integrated renderer fixture passed 156 checks with zero failures and 52 screenshots, including direct Apps/Accessibility roots, provider Back/focus, About keyring reachability, async sliders and signed-out login capability guards. There were zero browser errors, forbidden actions, unexpected API calls or source drift. The complete renderer fingerprint is recorded by the parent UI checkpoint. This is fixture acceptance, not live original Windows/service verification. The initial frozen fixture pass predates five bounded corrections: inline Apps/Accessibility initial routes, inherited provider image styling, signed-in About keyring reachability, duplicate sign-in removal and whitespace cleanup. The follow-up fixture run uses the corrected production files below.

| Corrected implementation | SHA-256 |
| --- | --- |
| `SettingsFrame.tsx` | `7f403827fa49443e56b6e48f479ffadc6268285abc7a97df8eda7fa982325dc8` |
| `OriginalSettings.tsx` | `ab3583d089a3caa6f1aa066e00f9100c21442050b580355c9c8da13c4125a310` |
| `settings-v2.tsx` | `c8ef3b1debe73c06d2354a63d79b260444a54b4d08873afcda584c42fc89baaa` |
| `settings-v2.css` | `14f43ebe4f2718336c0bdd8588156e6749bbf1195f64466c2f50d45c450b0272` |
| `appearance.ts` | `118817918cd479428b0264255110b46469b5bf1c683dd701d4498c42c4865b16` |

Repository-wide typecheck passed after the concurrent test corrections. The latest full unit run at this document update passed 2443 of 2444 tests; one separate Spotify GJS adapter test remained under diagnosis. The parent records the final repository-wide result.

No Microsoft source, account screenshot, prefix, token or raw authentication log is added to the public implementation by this checkpoint.

Accepted integrated fixture: `work/redesign-2026-11/new-experience-integration-final-5/experience-redesign-report.json` (156/156; 52 screenshots), with its sibling exact `source-fingerprint.json`. Earlier interrupted fixture attempts are superseded. See the [parity ledger](xbox2612-new-ui-parity-ledger-2026-11-08.md) for checksums, observed original surfaces and remaining boundaries.
