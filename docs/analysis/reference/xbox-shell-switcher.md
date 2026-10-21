# Xbox mode switcher and foreground app context

This chapter separates three original surfaces: the OS Xbox-mode Task View, the Game Bar Controller Bar's recent games/launchers, and the app/window that was active before Game Bar took focus. Measurements are from the supplied 1920 × 1080 captures; original images, background content and account/app documents remain private. Geometry is an observation at that resolution, not a recovered Windows layout constant.

## Observed screenshots

| Capture | Observed state | Measured layout / controls |
| --- | --- | --- |
| 148 | Xbox window selected in the white/gray OS switcher; another open app preview is visible to the right. | Selected outer frame approximately `(497,245,926,591)`; blue focus border about 4 px, inner preview 906 × 510, title strip about 60 px. |
| 149 | Another open application is selected, with preceding/following window previews visible at the sides. | Same outer frame as 148. Neighbor previews occupy approximately y369–711 and are partly offscreen. |
| 150 | A narrower application window is selected. | Frame approximately `(553,245,815,591)`: same height but reduced width. Preserve real window aspect rather than forcing all thumbnails to 16:9. |
| 148–150 | Top app-icon rail, system status, bottom desktop/mode choices. | Icon slots approximately 72 × 72 at y11; artwork about 32 × 32. LB/RB flank the rail. Full-width bottom bar approximately `(8,1018,1904,54)`. |
| 107 | A modal asks before returning to the desktop. | Modal approximately `(699,415,523,251)`, with two horizontal action buttons in its lower band. |
| 110 | Desktop-window entry into Xbox mode offers restart or immediate entry. | Modal approximately `(701,388,518,305)`; three full-width stacked buttons, about 470 × 32, with 8 px gaps. This is not a game installation/restart dialog. |

The switcher cards show a title/icon and an actual window preview. The selected card contains A `Επιλογή` and X `Κλείσιμο`. The bottom choices are `Λειτουργία XBOX` and `Επιφάνεια εργασίας των Windows`; the current Xbox choice has a short blue underline. The helper hint says `Άνοιγμα επικάλυψης εφαρμογής (όταν είναι διαθέσιμη)`. A close control is visible on the selected non-home application in capture 150. The clock and power/audio state belong to shell chrome. Icon order changes between captures; a fixed universal order or a complete MRU algorithm cannot be inferred from these still images.

Capture 107's title is `Μετάβαση στην επιφάνεια εργασίας των Windows`, with mouse/keyboard/touch guidance, `Να μην εμφανιστεί ξανά υπενθύμιση`, `Συνέχεια` and `Άκυρο`.

Capture 110's title is `Επανεκκίνηση για καλύτερες επιδόσεις`. The three choices are `Επανεκκίνηση (βελτιστοποιημένες επιδόσεις)`, `Έναρξη τώρα (δεν υπάρχουν αλλαγές επιδόσεων)` and `Παραμείνετε στην επιφάνεια εργασίας`. Its body explains that a restart returns to Xbox mode for optimized performance and that immediate entry is also possible. These are original labels, not a promise that the Linux extension implements Windows startup policy.

## Windows behavior and restart boundary

Microsoft's current [Xbox-mode support article](https://support.microsoft.com/en-us/servicing/os/windows/docs/2025/10/windows-gaming-full-screen-experience) documents Task View using Win+Tab, long-press Xbox or bottom swipe; left stick/LB/RB/arrows navigate, A activates and X closes open items. It distinguishes desktop return from restart. On handhelds with startup into Xbox mode enabled, returning from the desktop can offer a restart to regain startup/background-process optimizations, or immediate entry without restarting. Startup apps can be deferred until desktop entry. It also describes one displayed window at a time, fullscreen where supported and altered desktop window/shortcut behavior. These Windows OS policies do not follow from maximizing the Xbox app.

The [April 2026 Xbox announcement](https://news.xbox.com/en-us/2026/04/30/xbox-mode-pc-windows-11/) confirms that Xbox mode, formerly Full Screen Experience, expands across PC form factors. Availability and wording can vary; the supplied screenshots remain the visual baseline for the captured build.

The existing GNOME integration is a warm transition with the current desktop/apps preserved. Its truthful entry flow can say `Έναρξη τώρα` / `Παραμονή στην επιφάνεια εργασίας`, explicitly describing that no restart is required. It must not label reboot as a performance optimization unless a separately implemented distribution/session policy actually establishes that effect. A future dedicated gaming session may offer a different, explicit session-switch/restart flow after saves, downloads, background work and account continuity have been handled. Do not reboot, kill desktop apps or alter startup services merely to imitate a screenshot.

## Local package evidence and limits

The original PC Hermes bundle is pinned in [bytecode analysis](bytecode-analysis.md). F51320 `FullScreenExperienceSubsystem` (file offset 16136093) initializes from `getFullScreenExperienceStateOnLaunch` at +56; it dispatches OS-derived `isInFSEMode` +100/+106, `isFSESupported` +164/+170 and `isGarrisonHomeFSEApp` +226/+232, then subscribes to `fullScreenExperienceStateChangedEmitter` +389/+395. F42254 (14807772) calls `enterFullScreenExperienceAsync` at +14; F42258 (14807939) similarly calls the exit method. This proves native state/entry delegation, not the complete implementation of Windows Task View or its restart dialog.

In the pinned Game Bar 7.326 package ([library and input hashes](gamebar-widgets.md)):

- `Home/ControllerBar/ControllerBarControl.xbf` is embedded at PRI offset 330228. Its runtime dictionary at XBF offset 3893 names separate `LauncherItemTemplate`, `ThirdPartyLauncherItemTemplate` and MRU placeholder styles.
- `GameBar.__IGameLauncherViewModelPublicNonVirtuals` MethodDef 942 returns `MruLauncherItems`; 943 returns `ThirdPartyLauncherItems`; 945 exposes `ShouldShowEmptyState`.
- `Win32GameMruLauncherItem` MethodDef 1746–1754 exposes unique ID, packaged/running state, title, executable path, icon, load and launch. Running state is distinct from membership in a recent list.
- Greek PRI `resources/EmptyMruListPlaceholder/Text` says recent games on the device appear there; `resources/MruEndGameButton_Text` is `Έξοδος από το παιχνίδι`. Controller Bar settings also explicitly distinguish opening above a game from opening elsewhere.
- `Home/HomePanel.xbf` is at PRI offset 316724. Its `HomeBarItemsActiveSize` MethodDef 2974 refers to active **widget** items; it must not be renamed into proof of foreground OS application enumeration. `HomePanel_RunningItem` is a widget running label, not sufficient evidence of a game/window selector.

These contracts support a genuine recent-game/launcher Controller Bar. They do not justify using arbitrary `data.games.slice(0,4)` as an OS-running-app list, or treating every installed game as recently used. The white Task View belongs to Windows shell behavior; no complete shell implementation was recovered from the supplied Xbox/Game Bar app packages. Capture 131 on the desktop also has no active game name and disabled recording actions: a desktop cannot simply be relabeled as a running game.

## Clean Linux app-context bridge

The GNOME Shell extension can supply compositor-known window context. The Wayland client itself cannot reliably enumerate or inspect other applications through generic Electron window APIs. Suggested contract:

1. Before showing Game Bar, obtain an authenticated snapshot of the focused eligible external window. Freeze an opaque window token, app desktop ID, display label/icon reference, observation timestamp and explicit capability flags. Focus gained by Game Bar must not overwrite that context with xboks itself.
2. Use Shell.WindowTracker and live Meta.Window objects. Keep an extension-local map/token bound to the actual window object's lifetime (stable sequence plus generation), not just PID or a title string. Window removal invalidates its token. Do not persist window titles, thumbnails or process details as account/library history.
3. Keep `foreground context`, `currently open windows`, `launcher-owned running game` and `genuine recent launcher items` separate. Associate a game only through verified launcher process ownership/ancestry; do not infer a game from window-title matching. Unknown app/game context remains unknown.
4. For the switcher, use actual eligible same-session window actors and local Shell clones for previews. Filter shell/lock/Guide/internal windows; bound item count and text lengths; use real app artwork where available and a neutral fallback otherwise. Missing extension support must produce a capability-aware empty/unavailable state, not sample app cards.
5. Activate only a still-live selected window with a current compositor timestamp. Close should request the window manager's normal close operation, honor `can_close` and allow application save/confirmation dialogs. Never turn X into an unconditional PID kill. Revalidate token, session and operation immediately before acting.
6. Bind the bridge to the actual xboks helper/process using D-Bus sender credentials and a verified owner/registration lifecycle. A renderer-supplied PID, app ID or arbitrary D-Bus caller must not authorize global window inspection/actions. The current FSE Enter authorization requires focused xboks; an additional background context/switcher service needs its own tested ownership proof rather than relaxing that rule globally.

When already visible, Guide context is frozen until dismissal, except that destruction invalidates it. Capture or game-specific controls still need a real target adapter; showing a true app name does not grant screenshot/video capability for that app. Clear context and previews on lock/greeter/session change, bridge loss and shutdown. A stale context cannot become a new foreground or capture target after an asynchronous round trip.

## Scoped native controller input

The existing native helper emits only BTN_MODE globally. A Shell-hosted switcher has no Chromium Gamepad API; its navigation must be an explicitly scoped extension of that protocol. Enable only normalized up/down/left/right, accept/back and LB/RB while the authenticated owned Guide/switcher is actually visible. X maps to close-window only in switcher scope. The default background mode remains Guide-only. Never expose raw axis/button telemetry or read keyboard/mouse interfaces.

Seed current buttons/axes and require release/neutral when entering a new scope, so a held A cannot activate the first window automatically. Apply dead zone/hysteresis and bounded repeat, discard repeats/overrun frames, and recheck active unlocked session, surface generation and owned visibility before delivery. Immediately clear the surface on hide, lock, scope loss, bridge failure or quit. Suppress renderer gamepad navigation while native input owns the same visible surface to avoid double moves/toggles. No input grab, udev permission change or hardware event injection is needed.

Acceptance still requires real controller navigation, close/save-dialog behavior, window removal during selection, lock during preview/open, multi-monitor scaling and restoration after crashes. Static package contracts and synthetic bridge/input tests do not establish these live desktop outcomes.
