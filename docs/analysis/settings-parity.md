# Settings parity audit

Reference: supplied Windows Xbox client 2610.1001.20.0 screenshots (36015, 36014, 36013, 36017, 36016, 35987, 35988, 35989), plus setting-name resources statically indexed from the local original package. No proprietary code is executed or shipped in this change.

The nine category tabs match the reference. At 1920×1080 the modal is at (560,65), 800×950, with a 230px navigation column. Each category was opened and captured in the isolated demo profile, with no horizontal overflow. Keyboard/controller category navigation, modal focus restoration and scrolling remain in place. Additional Linux controls and clear unsupported-state messages mean content is not yet pixel-identical to the original.

| Category | Implemented | Service/platform limitations |
|---|---|---|
| Account | Profile, gamertag link, order history, refund, redeem, privacy management links; existing sign-in/out/refresh retained | Linked accounts, activity privacy mutation and purchase sign-in are unavailable. No fake linked accounts or permissions. |
| Application | Compact mode, battery percentage from Linux sysfs, XDG autostart, tray-on-close, developer diagnostics visibility; appearance persisted | Offline device authorization is unavailable. Streaming quality/telemetry belongs to the official Remote Play service. Gaming-session startup overrides require distribution integration. |
| Subscriptions | Connected Xbox profile with gamertag/email and Manage account action; actual backend subscription badge; manage/history links; original plan/status/billing layout | No backend billing dates, prices, renewal failure or expired-card claims are invented. |
| Notifications | Original Game Pass and three Store preference controls; working desktop download-completion preference and Game Bar action | Catalog, wishlist and social notification services are not connected; their controls are disabled. |
| Install options | Default folder picker/save, bandwidth, parallel downloads, backend/runtime installation and updates, Proton paths and diagnostics | Windows volume formatting and Gaming Services management do not apply directly to Linux. |
| Library and extensions | Local game count and manual import; six Windows provider rows (Steam, Epic, GOG, EA, Ubisoft, Battle.net); real native/Flatpak/Wine desktop-entry detection; EA/Ubisoft/Battle.net/Riot extension rows | Automatic game discovery/import, provider authentication, hidden Xbox games and Windows extension execution are unavailable. |
| Audio | Original input/output/voice/push-to-talk/noise/navigation groups; actual system output volume and mute retained | Xbox voice devices, party chat, push-to-talk, suppression and navigation sound playback are unavailable. |
| Accessibility | Background and animation switches take immediate effect and persist; accessibility/Game Bar/accessories links | Themes, video previews and hover accessibility metadata are unavailable. Linux desktop accessibility replaces Windows Settings. |
| About | Actual launcher/backend/runtime versions, device section, Insider link, legal/help/source/accessibility links; existing launcher updater retained | No fabricated Windows device ID, serial number or Insider enrollment. |

Unsupported controls are disabled and explain the missing capability. They do not write cosmetic preferences that pretend to enable Xbox services. This is not a claim of full functional or pixel parity.

Validation: TypeScript checks for renderer and Electron, focused renderer/main tests, Vite build, nine-page Electron/CDP visual pass and persisted compact-mode interaction. Desktop-entry helpers are tested in temporary directories, not in the user's real autostart folder. Tray visibility depends on compositor/desktop support; login startup and a real desktop tray still need end-to-end desktop verification.

Provider detection reads only bounded desktop-entry metadata from XDG/native/Flatpak application directories, including nested Wine shortcuts. It never reads cookies or tokens, evaluates Exec entries, or equates an installed launcher with a linked account. The actual local check detected Steam. No separate Microsoft Store or linked provider account is invented from the Xbox identity.
