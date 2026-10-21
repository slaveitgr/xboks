# Xbox mode performance implementation guide

Reviewed against the xboks 0.3.20 implementation on 2026-10-21. This records current support and an implementation plan, not a benchmark or a claim of measured performance gains. The current GNOME extension provides a transition within an existing desktop; startup reduction and a minimal gaming login require additional work. See [Fullscreen Experience architecture](fullscreen-experience-linux.md) and [switcher/restart behavior](reference/xbox-shell-switcher.md).

## Reference behavior and current support

Microsoft associates background-process reduction with entering Xbox mode at startup on supported handhelds. Startup apps can run at login, wait until the first Desktop transition, or remain off. Returning after using Desktop can offer a restart to regain those startup optimizations. This does not establish that an ordinary mode toggle terminates already-running desktop apps. [Microsoft Xbox mode support](https://support.microsoft.com/en-us/servicing/os/windows/docs/2025/10/windows-gaming-full-screen-experience).

| Capability | Current repository support | Pending work |
| --- | --- | --- |
| GNOME presentation | Existing session, windows and applications remain alive | Keep its status separate from performance status |
| Restart into Xbox mode | [`XboxModeStartup`](../../src/main/xbox-mode-startup.ts) prepares a profile-bound, one-shot ordinary login autostart | It does not suppress other startup apps or create a reduced session |
| GameMode | Default-off per-game checkbox in [`GameLaunchToolFields`](../../src/renderer/App.tsx); [`game-wrapper.ts`](../../src/main/game-wrapper.ts) adds `gamemoderun` to the Wine payload, preserving custom launch options | Provider-active status and real detached/native game lifecycle acceptance |
| Game lifetime | [`proton.ts`](../../src/main/proton.ts) waits for the isolated prefix's Wine processes; [`game-process.ts`](../../src/main/game-process.ts) tracks Stop/cleanup; GameMode preload owns its clients | An additional main-process performance lease is not implemented |
| Display sleep | [`GameDisplayBlocker`](../../src/main/game-display.ts) acquires and releases an inhibitor while a game runs | Reuse its idempotent-release pattern for other temporary resources |
| Downloads | Unrelated installations/downloads may continue during a game | Optional acknowledged pause and ownership-aware resume |
| Measurements | [`guide-performance.ts`](../../src/main/guide-performance.ts) reads system CPU, memory and optional GPU/VRAM counters; hidden Guide widgets skip polling | Process-tree accounting and actual game frametime capture |
| Deferred apps / minimal login | Not implemented | Pre-login startup policy, followed by an independently tested session |

## Shell parity still requiring work

The supplied Home/Library and settings screenshots confirm the existing launcher routes and the Game Bar entry added in 0.3.20. The dark Task View reference is implemented by extension v4’s desktop-theme observer; native visual and physical-input acceptance remains separate from isolated tests.

The complete Microsoft behavior also requires explicit Win+Tab/Win+F11 routes, long-press Xbox selection, supported touch gestures, most-recent-window-per-app grouping and a black surround for apps that reject fullscreen. These are not implemented by the new theme or GameMode checkbox. Retain reversible ownership and exact shortcut restoration when adding them; never infer this coverage from Alt+Tab or a successful mode entry.

## Stage 1: temporary per-game optimizations

### Implemented in 0.3.20

The per-game checkbox requests GameMode and defaults to off. [`normalizeLaunchTools`](../../src/shared/launch-tools.ts) accepts older saved settings without the new field and normalizes it to false; invalid non-boolean values are rejected. Existing custom `gamemoderun %command%` options remain effective even when the checkbox is off.

When requested, the game wrapper resolves an executable `gamemoderun` and places it directly around Wine, inside optional Gamescope or MangoHud, with custom wrappers outside. It preserves literal arguments, environment and exit status. A custom prefix that invokes `gamemoderun` directly or through a recognized `env`/MangoHud/Gamescope chain is preserved without adding a second copy. Arbitrary arguments named `gamemoderun` do not suppress the checkbox request; opaque wrappers cannot prove they invoke GameMode. Authentication, prefix setup, prerequisite installers, account services and Stop remain outside the added wrapper. If the optional executable is missing or not executable, the launch log records a warning and the game starts without that added wrapper. Explicit user-configured missing tools still produce their existing launch error.

`gamemoderun` uses GameMode's preload client; those client processes and the daemon's cleanup own the request. There is **no additional `GamePerformanceLease`, global GameMode setting, power-profile hold or download-pause policy** in this implementation. A checkbox records intent and executable resolution does not prove provider activation. Synthetic tests cover default/legacy settings, ordering, quoting, exit status, duplicate custom prefixes and missing-tool fallback. Real provider activation, detached launcher handoff, client release after normal/forced exit and native runtime/architecture behavior still require acceptance testing.

### Remaining work

1. Add provider capability/outcome reporting only from real observations: unavailable, available, requested, active, failed/released, with a bounded diagnostic reason. Continue a valid game launch when an optional optimization is unavailable; do not install packages or change permissions implicitly.
2. If a global default or future main-process `GamePerformanceLease` is added, acquire only for actual game activity and release idempotently on spawn failure, completion, Stop and shutdown. Keep ownership through child-launcher handoff. Coordinate additional resources alongside [`prepareGameLaunch`](../../src/main/index.ts) and its existing display inhibitor; avoid creating a second unpaired GameMode request around the preload integration.
3. If a supervisor API replaces automatic preload, pair start/end for the verified process, avoid PID-reuse races, and retain a crash cleanup path. Do not use the `gamemoded --request` CLI toggle as an idempotent acquire/release API. GameMode supports reference-counted clients and dead-client cleanup; test detached Wine descendants and the architectures actually shipped.
4. Offer "pause downloads while playing" separately. Pause only tasks with acknowledged pause support, prevent automatic queue advancement, and record the IDs/generations paused by the policy. Resume only tasks still owned by it; a user's later pause, cancellation or preference change wins. Never interrupt an unsupported installer or save synchronization to simulate reduced activity.

GameMode can temporarily request CPU, IO and other policies, but its actual effects depend on configuration and permissions. Do not advertise GPU tuning, negative niceness, affinity or `SCHED_ISO` merely because GameMode is installed. Respect its existing configuration rather than rewriting it globally. [GameMode 1.8.2 documentation](https://github.com/FeralInteractive/gamemode/tree/1.8.2), [client API](https://github.com/FeralInteractive/gamemode/blob/1.8.2/lib/gamemode_client.h), [configuration](https://github.com/FeralInteractive/gamemode/blob/1.8.2/example/gamemode.ini).

If a higher-power option is added, keep it separate and opt-in. Prefer power-profiles-daemon `HoldProfile`/`ReleaseProfile` on a persistent owned connection: disconnect releases the hold, and a manual profile change cancels it. Do not restore a hard-coded profile or have two providers compete over the same CPU policy. An already-active performance profile supplies no evidence of an additional improvement. [Power Profiles API](https://upower.pages.freedesktop.org/power-profiles-daemon/gdbus-org.freedesktop.UPower.PowerProfiles.html).

Later, a transient systemd unit can contain the complete game tree for accounting and measured CPU weighting. A detached Unix process group is not a cgroup. Probe delegated controllers and hierarchy before offering controls; resource weights matter under contention and do not remove background memory. Avoid global scheduler/sysctl changes, overclocking, arbitrary process freezing, memory caps and broad service shutdowns. [systemd resource control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).

## Stage 2: selected startup deferral before login

Offer per-app choices: **At login**, **When opening Desktop**, **Off**. Apply this only to user-selected optional startup apps; preserve audio, input, network, portals, credentials, screen locking, authorization, accessibility and required remote-access functionality. Explain that the policy takes effect at the next applicable login. A launcher autostart running alongside other entries cannot reliably prevent them from starting.

Implement a separate transaction from the current one-shot launcher autostart:

1. **Prepare:** enumerate supported startup entries and store the selected policy, original bytes/digest, permissions/ownership and an opaque transaction ID. Use per-user overrides or dispatch entries without editing system entries. Preserve desktop-entry argument semantics and launch through a desktop-entry API or a validated argv path, never an arbitrary shell string. Detect unsupported activation routes rather than promising to intercept them.
2. **Commit before login:** atomically publish only owned overrides and a bounded intent. Startup dispatch must be able to see committed intent before xboks has finished starting. On canceled preparation, roll back only unchanged owned files. Do not reuse the current launch intent's deletion as the lifetime of the deferred queue.
3. **Claim at login:** a dedicated user-session helper validates and atomically claims the transaction for one login/session. Bind its queue to that session and establish a startup deadline/watchdog. Reject stale, foreign or already-claimed intent. Multiple app windows and dispatcher invocations must not create multiple owners. Keep minimal sanitized diagnostics; do not persist process arguments, account data or window titles.
4. **Release on Desktop:** after an acknowledged explicit Desktop transition, release the selected deferred apps and mark the queue released. Use stable owned activation units/IDs so retries check prior activation rather than blindly spawning duplicates. Record ambiguous launch outcomes instead of claiming exactly-once behavior for arbitrary applications. Re-entering Xbox mode leaves the released apps running. Off entries remain off.
5. **Fallback and restore:** if the owner fails, the startup deadline expires, or the session cannot be identified, fall back to ordinary desktop startup and release deferred optional apps. On normal completion, disablement, uninstall or the next recovery pass, restore only files whose ownership and bytes still match the transaction. Preserve user/package changes and report conflicts. Bound pending state to a session and expiry so a crash cannot silently defer apps forever.

XDG defines per-user startup overrides and `Hidden=true`; it does not define a Desktop-transition trigger or supervise this transaction. A persistent `Hidden=true` file without recovery is not a temporary deferral policy. [XDG autostart specification](https://specifications.freedesktop.org/autostart/latest/).

Desktop-file interception also does not cover services started directly by GNOME systemd dependencies, D-Bus activation or another application's explicit launch. Publish the supported entries and remaining activation routes. Current-session entry can reduce xboks-owned work, but cannot recover the full memory benefit of applications never starting. [systemd desktop integration](https://systemd.io/DESKTOP_ENVIRONMENTS/).

## Stage 3: minimal GNOME 51 gaming session

Prototype a separate named login session after the extension and per-game policy are verified. Current GNOME session definitions use `Kiosk=true` to suppress ordinary desktop-file autostarts, with explicit systemd dependencies providing required functionality. A `.session` file alone supplies no services; old `RequiredComponents` recipes should not be used as the GNOME 51 design. Keep a separate Gamescope session as another future adapter with its own acceptance tests. [GNOME session documentation](https://gnome.pages.gitlab.gnome.org/gnome-session/re01.html).

Select and test the compositor, launcher/Guide, audio, input, display/power, credentials, authorization, portal and recovery services. Audit dependency and D-Bus activation paths so omitted optional services do not immediately return. Bind units to the graphical session, use finite shutdown deadlines and preserve a usable desktop/login fallback. Opening a second graphical session for the same user is not a transparent shortcut: the user manager and session bus have shared-state constraints. [systemd desktop/session model](https://systemd.io/DESKTOP_ENVIRONMENTS/).

A fresh login can establish reduced startup; reboot is not inherently required by Linux. Show a restart/session-switch optimization label only after that path exists and has been measured. Leaving the current session must account for running games, saves and downloads. A warm extension toggle remains available without implying that it establishes the minimal login's resource footprint.

## Measurement and acceptance gate

Compare separate configurations: ordinary desktop, warm Xbox presentation, per-game optimizations, selected deferred login and future minimal session. Keep resolution/game settings, power source/profile, thermal state, game scene and shader-cache conditions comparable; alternate A/B order and repeat at least 3–5 times. Separate first-run compilation from warmed runs.

| Question | Evidence |
| --- | --- |
| Does startup improve? | Sign-in to usable library, launch to first game frame, accumulated CPU time during the first 30/60 seconds |
| Is there less resident work? | Process-tree PSS where readable, system `MemAvailable`, swap and memory pressure; report unreadable processes instead of treating them as zero |
| Is gameplay smoother? | Real game frametime median/p95/p99, stutter/missed-frame counts and average FPS from a validated instrumentation path such as the existing MangoHud integration |
| Is contention reduced? | Game and background CPU time, IO activity/pressure, download state and CPU/GPU utilization |
| Is power behavior acceptable? | Energy/power where supported, temperature, fan/thermal throttling and sustained performance |
| Does ownership restore correctly? | Launch failure, handoff, normal exit, Stop, app crash, user profile change, concurrent clients, canceled restart, duplicate/stale startup claims, helper failure, Desktop entry and user-edited override conflicts |

Summed Electron RSS double-counts shared mappings; PSS/system availability and repeatable conditions are needed before claiming memory savings. The Guide's system counters cannot prove FPS or frametime improvement. Report measurements and regressions per configuration, including a neutral or negative result. Do not use a process-count reduction, a green status badge or a reboot alone as proof of better gaming performance.
