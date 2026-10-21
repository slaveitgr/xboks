# Changelog

## Unreleased

- Fix Jurassic World Evolution 3 aborting during app-constrained notification registration at startup.
- Fix repeated Xbox task-queue termination requests leaving games waiting during world cleanup or shutdown.

## 0.3.24 — 2026-10-22

- Replace the default console website flow with an in-app account-bound console picker and home-streaming session/player using existing sign-in. Add private xhome offering/discovery, opaque console/session identities, bounded SDP/ICE, controller input and cleanup. Live One X video/audio/input remains unverified; standalone wake and purpose-ticket transfer remain explicitly unavailable.

- Replace the Cloud Gaming entry screen with an in-app catalog, recent play, popular/EA Play collections, Stream your own game, exact product details, controller navigation, filters and paging, based on original package evidence.
- Reuse the signed-in Engine account for private GSSV cloud authentication. Add account-bound session provisioning, state, SDP/ICE and keepalive with an experimental direct WebRTC player, scoped input, cancellation and cleanup. No launcher credential enters the renderer.
- Add explicit cloud country compatibility settings based on Better xCloud's MIT login-only technique. Automatic remains the default. An existing-account Poland compatibility probe read catalog/MRU successfully; no live game was started. Additional ReadyToConnect transfer tickets remain unsupported.
- Keep a tray icon while XBOKS runs, independently of the close-to-tray preference, with launcher/Game Bar/quit actions and visible-launch fallback when tray creation fails.
- Add genuine dark/light GNOME Shell switcher captures and native cloud UI captures to both project guides. Sample account/session data and isolated native capture environments are identified.

## 0.3.23 — 2026-10-21

- Introduce the XBOKS name and owner-supplied green sphere logo across the launcher, application menu, tray, desktop entries and project presentation. Preserve existing install paths, accounts, games and runtime compatibility IDs.
- Rewrite the English and Greek README around current features, setup, roadmap and an actual-application screenshot gallery. Keep source/license attribution in the dedicated notices and About page.
- Keep the native Guide window identity compatible with already-loaded GNOME extensions; updated matchers accept either display-title casing.
- Support older GJS Unix-signal APIs in the Spotify and desktop-experience helpers while preserving bounded shutdown and service ownership checks.
- Reset inherited publication approvals: future XBOKS stable artifacts require their own exact-candidate approval. Runtime helper display labels are updated in source; this does not replace an installed compatibility runtime.

## 0.3.22 — 2026-10-21

- Rebuild Store navigation from the original client/package evidence: centered Minecraft editorial fallback, five category shortcuts, measured game shelves, real public PC/Top paid/Add-ons galleries, pagination and product-specific details. Cloud wishlist remains unavailable until its authenticated provider is connected; code redemption opens Microsoft's official account flow.
- Separate installed Engine/runtime readiness from update-channel status. An unpublished update is informational; actual fetch/verification errors remain visible. Localize Engine storage/download controls and remove internal storage implementation text from settings.
- Integrate the six newer upstream backend patches and native wallet lifecycle: provider detection, explicit collection creation/unlock, bounded cancellation, owned session cleanup, credential persistence, encrypted-image resume and launch errors. Preserve xboks identities and required private compatibility protocols.
- Harden owned path migration with atomic no-replace publication, profile leases, unrelated-installation preservation and an offline selected-runtime/prefix copy helper. Existing games, custom paths and separate Nexus data are preserved.
- Keep the existing pinned runtime code: the newest upstream delta changes its release status only. Offline/native tests do not establish individual game compatibility or live account acceptance.

## 0.3.21 — 2026-10-21

- Add Cloud gaming between Library and Store, using an isolated official Xbox web view with separate sign-in, origin-limited navigation and trusted Back/Home/Retry/Close controls. Rendering the destination does not start a stream, sign in or imply entitlement. Demo mode blocks the native page; real Linux browser/game acceptance remains unverified.
- Enable View profile as an in-app current-account page with provider-returned identity, avatar, verified subscription and optional score/biography/location. Cache/source and refresh errors remain explicit; unknown statistics never become zeros. Bind profile snapshots and async completions to the selected account.
- Use the actual locally extracted membership glyphs with text fallback and the original Ultimate/Premium/Essential/PC priority. Expanded navigation shows gamertag and membership; compact navigation retains avatar-only layout and an accessible membership label. No original Microsoft assets are added to Git.
- Append a validated backend profile-details patch. Existing backends remain compatible and return fewer fields; installing the launcher alone does not rebuild or replace the selected backend.
- Document the original `/xcloud` and `/social/profile` routes, market gates, sidebar states and badge resources in the [sanitized reference](docs/analysis/reference/profile-cloud-navigation.md).

## 0.3.20 — 2026-10-21

- Follow the GNOME desktop light/dark preference in the native task switcher. Keep the white reference surface for light/default, and use the black radial background, dark cards, white labels and cyan selection from the dark reference. Apply changes while open without replacing native icons/previews or losing selection. Extension v4 requires a fresh GNOME login; protocol capability remains 3.
- Connect desktop Game Bar Settings → Enter Xbox mode to the existing launcher entry dialog. Serialize handoffs, preserve source/target window identity and wait for actual compositor focus before delivering the event. Cancel old requests across Guide reopen, lock/suspend or lazy main-window replacement, and expire buffered events. Opening this dialog does not enter the mode or request a restart. Keep Home/Library routes and Return to desktop behavior.
- Add a default-off per-game Use GameMode option with Greek/English copy. Request the installed `gamemoderun` only around the game Wine payload, compose with existing launch tools and avoid duplicate known custom wrappers. If the optional executable is missing, log the reason and continue the game without it. Explicit custom launch commands retain their existing required-tool behavior. Provider activation and real-game benefit require separate verification.
- Add a [Linux Xbox mode performance guide](docs/analysis/xbox-mode-performance.md), distinguishing current presentation/game-launch policy from planned selected-app startup deferral and a future minimal Gaming Session. No background apps or host power settings are changed by entering Xbox mode; no performance gain is claimed without measurements.

## 0.3.19 — 2026-10-21

- Keep Guide system-volume and device/application-mixer sliders focused while asynchronous audio writes are pending. Block extra edits during the write, allow vertical navigation away and avoid restoring focus over the next control. Controller left/right edits controlled volume and Settings-opacity ranges; min/max consumes the direction without duplicate writes or toolbar jumps.
- Add the screenshot-110-style Greek/English Xbox mode entry dialog with three explicit choices: Restart, Start now (no performance changes), and Remain on desktop. Opening reads status only, without writing startup settings, entering fullscreen or scheduling a restart. The dialog uses scoped controller/keyboard controls and safe initial focus on Remain.
- Implement a guarded real logind reboot only after explicit Restart confirmation. Require an installed persistent Linux launcher, available GNOME integration, an idle focused app and current reboot capability. Bind the fresh expiring token to the originating window, then record a profile-specific, boot-bound startup intent for one Xbox mode attempt after login. Roll back this intent if the reboot request is rejected; preserve unrelated startup files and the selected desktop session.
- Keep B/Escape cancellation available during read-only token preparation. Once entry or the power request is dispatched, disable Remain and consume cancellation until the result arrives. Failures stay in the dialog and unlock its controls. GNOME restart does not apply additional performance optimizations.
- Upgrade the native GNOME Shell 51 switcher to v3: Alt+Tab moves forward, Alt+Shift+Tab moves backward, and releasing Alt activates the selected native window. Bare Super remains persistent until explicit selection/dismissal. These handlers apply only during the app-owned Xbox mode lease. Preserve real window aspect ratios, screenshot-measured card placement and native 32-pixel app icons.
- Temporarily place ordinary application windows in fullscreen and prevent minimization while the owned Xbox mode lease is active. Restore saved window states and Shell chrome on Desktop, lock, owner loss or extension disable. Loading v3 requires a fresh GNOME session; re-enabling an already imported extension does not reload its JavaScript.
- Pass 68 Guide and 49 entry-dialog checks in real Chromium with synthetic input/native bridges, including delayed writes, token expiry and the dispatch/cancellation boundary. No fixture reboots the machine. The user physically confirmed basic Guide navigation on 0.3.18 and system-volume slider focus/adjustment on 0.3.19. Physical Alt+Tab, live v3 window policy/restoration and the actual reboot/login flow remain unverified.

## 0.3.18 — 2026-10-21

- Add scoped native Guide navigation for D-pad/left stick, A/B and LB/RB without depending on Chromium exposing a standard gamepad. Admit navigation only to the visible, focused Guide or owned Shell switcher, pause on lock/suspend and suppress duplicate browser input. Background operation remains Guide-button-only.
- Focus the actual Guide web contents after opening/compositor activation, restore the selected tab on reopen, keep shoulder navigation focused across toolbar pages and give controller focus a clear white ring. Cancel delayed window loads on hide/destroy so they cannot reopen over a locked session.
- Show the actual previously focused application on Game Bar Home through GNOME extension v2. Returning closes the Guide; recent games use valid timestamps from the current account’s local play history instead of the first installed titles.
- Add a GNOME Shell 51 native light task switcher with real running-window icons, available live previews, LB/RB selection, A activation, explicit X normal window close and bottom Xbox/Desktop controls. Bare Super opens it only during the app-owned Xbox mode lease; ordinary desktop behavior is preserved.
- Extend the persistent GNOME bridge with versioned foreground/focus/switcher operations. New features require extension v2 loaded in a fresh GNOME session; disabling/re-enabling an already imported extension does not load updated JavaScript. No automatic logout or reboot is scheduled.
- Keep Fullscreen Experience a warm transition in the current desktop session. It does not stop other applications, create a dedicated gaming session or claim a Windows reboot-specific resource optimization.
- Verify the Guide renderer with 41 isolated browser checks and focused unit/integration tests, including absent Chromium gamepad exposure, nested Back, input ownership, focus and actual foreground context. Inputs and native interfaces in these tests are synthetic; physical controller navigation, the live v2 switcher and external-game acceptance remain open.

## 0.3.17 — 2026-10-21

- Resolve the launcher's real path before locating its native executable, including user-bin symlinks and Debian alternatives. This fixes the reported Win+G command failing to find `xboks.bin`.
- Add native Debian/Ubuntu packaging with the matching Chromium SUID sandbox installed under root-owned `/opt/xboks`. Keep Electron sandboxing enabled; do not disable Ubuntu's user-namespace policy. This addresses the reported AppImage startup failure from normal desktop and user-service sessions.
- Listen for the controller's Guide button in the background through a joystick-only Linux input helper. Respect active, unlocked local sessions, release devices on shutdown, and prevent duplicate toggles from renderer polling. Device permissions and physical controller acceptance remain distinct from synthetic tests.

## 0.3.16 — 2026-10-21

- Fix a main-process exception when closing Game Bar: retain the microphone ownership ID before Electron destroys its web contents, keep late callbacks bound to the old owner, and make repeated teardown safe.
- Report denied Spotify desktop permissions explicitly with bounded diagnostic codes. The Snap MPRIS policy can reject an inherited named security label; no sandbox or security-policy workaround is applied.
- Add an opt-in [resident Game Bar user service](docs/analysis/gamebar-service.md), separately controlled login enablement/immediate startup, a shared profile/process and graceful main-process shutdown. Installing with `--enable` leaves the current app running; existing-instance handoff is distinct from systemd supervision, and live login/recovery acceptance remains open.
- Host official console Remote Play in an isolated view inside the main app with trusted navigation/retry/close controls and separate Microsoft web sign-in. The [original Windows analysis](docs/analysis/reference/remote-play-ownership.md) proves an internal native console route and `GameStreamView`, not a separate browser window; this web adapter does not claim native service parity or Xbox One X gameplay acceptance.
- Distinguish Spotify desktop permission denial from player discovery/transport errors, with a safe stage-specific diagnostic and permission guidance. Denied controls remain disabled; no Snap policy, desktop confinement or player permissions are changed automatically.

## 0.3.15 — 2026-10-21

- Repair group/other-writable permissions on owned, real Proton game-prefix directories before and after initialization. Keep runtime ownership checks enabled, preserve saves and custom locations, and reject symlink prefixes. This addresses the reported Asphalt launch guard; successful gameplay still needs confirmation.
- Add the Game Bar widget directory, paged favorites, panels kept open within the guide, scoped settings categories, appearance/accessibility preferences and controller navigation that respects hidden widgets. Optional locally extracted Game Bar fonts now use their own verified glyph family instead of the Xbox app font.
- Connect the native Spotify desktop player through MPRIS: artwork and track state, previous/next, play/pause, capability-gated seek and explicit Open Spotify. No background playback or automatic launch; native, Flatpak and Snap desktop IDs are supported. Recommendations, saved-library actions and Spotify Connect are not implemented by MPRIS.
- Connect the PipeWire application mixer and default input/output devices, with current node-serial validation and volume/mute capabilities. Add live Linux CPU/RAM and available AMD GPU/VRAM counters; unavailable values remain unknown and game FPS is not inferred.
- Add a gallery restricted to xboks PNG captures, with bounded local thumbnail reads, Open and explicitly confirmed Delete. Capture remains limited to the xboks window; game video and arbitrary desktop capture are not implemented.
- Recover all 74 embedded native Game Bar XBF resources, Greek PRI labels and typed widget/settings contracts into a reproducible private reference database. Publish the sanitized feature map and analysis tools, keeping original packages, fonts and screenshots outside Git. Complete native call graphs, Xbox party voice and verified compositor overlay behavior remain separate work.

## 0.3.14 — 2026-10-21

- Show a content-selection step before installation, including a resolved single base game. Next opens the real install location; only the final Install action submits the selected package ID, market and destination. Alternative packages remain single-choice; unsupported optional-language/chunk selection and unknown sizes are not fabricated.
- Add the original-style handheld compatibility information surface to Store and installed-game pages, with Greek/English labels, scoped Back, focus restoration and optional illustrations extracted from the locally supplied package.
- Read explicit Windows handheld classifications from Xbox's public product service. Missing ratings remain unknown, descriptive metadata survives service failure, and Windows handheld ratings never become Linux/Proton certification or local performance predictions.
- Document the recovered original enums, assets, translations, layout and independent performance-rating boundary. Source checkout includes a native illustration fallback; original package assets and user photos remain outside Git.

## 0.3.13 — 2026-10-21

- Add an optional GNOME Shell 51 Fullscreen Experience extension with a persistent local bridge, focused-app ownership checks and restoration on exit, connection loss, disable or lock. Ctrl+Super+Escape is the required emergency restore shortcut. This keeps the desktop and its applications running; it is not a separate gaming session or a memory-saving feature.
- Separate acknowledged GNOME/session integration from ordinary app window fullscreen. Missing integration retains window fullscreen with an explicit notice.
- Match the header display states: desktop windows show the sole Xbox mode entry button; fullscreen shows the clock and available real battery/charging/external-power status. Unknown readings do not become synthetic charging or battery indicators.
- Package the extension source and an explicit staging/install helper that checks GNOME major 51 and refuses an existing extension destination. Installation is inactive. New local UUIDs require a fresh user-chosen GNOME login before enablement; neither installer nor application logs out or restarts the desktop.
- Cover extension ownership/restoration, mocked Shell lifecycle, the real GJS helper over an isolated fake D-Bus service, native fullscreen orchestration and header/power states with automated tests. Live GNOME/dock/lock/multi-monitor/controller/game acceptance remains pending.
- Document the GNOME integration and standalone Gamescope/Kiosk roadmap in English and Greek. A native compositor Game Bar over external games remains future work; the existing guide is a separate Electron window.

## Backend 0.2.7

- Keep independently verified account-library records available when other license records are invalid or conflicting.
- Add safe library error codes and HTTP status diagnostics without recording account or credential contents.

## 0.3.7

- Keep independently verified library games available when individual license records are invalid, with a warning when results are incomplete.
- Add a local backend diagnostic log with safe error codes, an in-app viewer and a Copy log button.
- Improve spacing around action buttons in Advanced / Diagnostics.

## Backend 0.2.6

- Prevent sign-in and installation panics when stored credentials are invalid, verify keyring writes and show actionable sign-in errors. Thanks @jordanfaz for reporting the issue.
- Include nested dependency source directories in the corresponding-source archive for offline builds.

## 0.3.6

- Prevent repeated task-queue closes from releasing pending work or crashing during game shutdown.
- Support app-state notification registration during game startup.
- Accept SKU-qualified product IDs when requesting genuine Store license receipts.
- Fix LIMBO failing to start with a pixel shader compiler error.
- Fix Brotato installation failing while reading package metadata. Thanks @Techzilla44 for reporting the issue.
- Fix Kingdom Come: Deliverance II crashing during startup. Thanks @TinyRoar-Basti for reporting the issue.
- Support asynchronous multiplayer privilege resolution using authenticated Xbox account permissions. Account restrictions still require resolution through Xbox settings.
- Fix PowerWash Simulator 2 getting stuck on the initial loading screen.
- Deliver installation-progress notifications, fixing Indiana Jones and the Great Circle crashing after the opening logos.
- Enumerate installed package chunks, languages, tags and features from layout metadata.
- Support a legacy XPackage interface and its installed-package metadata queries.
- Clear My Library search on restart while remembering Access and Play state filters.
- Add gamepad navigation for the launcher, including directional focus, dialogs and game options, while preserving mouse and touch controls. Thanks @Techzilla44 for the suggestion.
- Support gzip response decompression and server certificate-chain queries in the shared runtime's WinHTTP implementation.
- Prevent doubled keyboard input in Steam Game Mode without changing game input settings. Thanks @Techzilla44 for reporting the issue.
- Search all pages of the account library automatically instead of only the games already loaded.
- Open the selected game from Most recent and library search results.
- Delete uninstalled game files directly instead of moving them to Trash, with an explicit permanent-deletion warning and an option to keep the files.
- Preview installation progress when hovering over Install Queue and show a desktop notification when a download completes.
- Allow removing an unrelated game while another game downloads, keeping active installation folders protected.
- Ignore commented-out manifest examples when importing games and reading runtime package metadata.

## 0.3.5

- Add an optional per-game DualSense compatibility mode for controllers not detected through native HIDRAW input.
- Prevent automatic display sleep while a game is running, including when playing with a controller.
- Keep library cards in place when loading more games and fix opening game options with a single click or tap. Thanks @Techzilla44 for reporting these issues.
- Queue multiple game installations and download other games while playing. Keep queued installations cancellable.
- Preserve cover proportions in Steam portrait library cards.
- Add games and Nexus to Steam with library artwork, including while Steam is running.
- Fix access to the KDE keyring when launching game shortcuts in Steam Game Mode.
- Fix launcher startup from Steam Game Mode when the Steam overlay is injected.
- Support Store game-license change subscriptions in the shared runtime.
- Support Google Chrome installed through Discover/Flatpak for browser sign-in. Thanks @quentingeorgel for reporting the issue.
- Fix games remaining active after a normal exit.
- Fix games exiting during speech initialization when using the bundled runtime.
- Support chunk-order requests for verified installed packages in the runtime.

## 0.3.4

- Fix games failing to launch with a WINEPREFIX error when no custom launch options or overlays are enabled.
- Correct the demo's version display and use wide Store artwork for banners and game details.

## 0.3.3

- Offer Continue in browser when Microsoft passkey sign-in is waiting, including during first-time setup. Requires Google Chrome installed on the computer; other browsers are not supported.
- Let users cancel a waiting passkey request without closing Microsoft sign-in.
- Bundle a fallback font to prevent font-related startup crashes on minimal Linux installations.
- Keep My Library filters after restarting Nexus and close search suggestions when leaving the search field or changing pages.
- Fix desktop game shortcuts reporting an invalid profile path when Nexus is already running.
- Show an installation package picker for Store offers with multiple downloads instead of waiting for terminal input. Requires the updated Nexus backend.
- Name game shortcut files after the game, with safe handling of duplicate titles.
- Add per-game MangoHud, gamescope and custom command-prefix settings.
- Align the game details with the library grid and give installed and installable cards matching heights.
- Use Store covers and wide detail artwork instead of small package icons, with a local-image fallback.
- Use wide Store artwork for the Home banner instead of stretching package icons.
- Make the library refresh control compact and aligned with the filters.

## 0.3.2

- Fix Microsoft sign-in on SteamOS without installing WebKitGTK or changing the system partition. Start the built-in KDE keyring automatically when needed.
- Keep My Library's Access, Play state and search filters when switching between tabs.

The updated sign-in backend requires launcher 0.3.2 or newer. Update both the launcher and Nexus backend.
