# Original Xbox mode: experimental bridge checkpoint

Date: 2026-11-08. Status: **real original-client Xbox mode entry and emergency
return to the desktop are verified.** The user also confirmed that Alt+Tab
already opens the switcher. Bare Super and physical controller acceptance
remain pending for the implemented version-7 update.

After the user chose to log out and back in, Shell reported version 6 enabled
without extension errors. Native1 returned version 1, supported=true,
active=false, canSet=false and
owned=false for the separate read-only observer. No mode entry is inferred
from that capability check.

The user confirmed the new original CE Home and menus. That is a distinct
milestone from the mode bridge. Streaming or gameplay results are not inferred
from the working frontend or mode transition.

After repairing the relocated framework graph and installing the new builtin
module into the existing prefix, the original CE process loaded `gamemode.dll`,
`gamemode.so` and libdbus. The installed GJS enrollment verifier accepted that
exact process and its current identity. The user then selected Xbox mode:
the native `SetGamingFullScreenExperience(1)` returned `S_OK` with acknowledged
active/owned true, the independent Shell query reported active=true with an
advanced epoch, and the owned window acquired `_NET_WM_STATE_FULLSCREEN`.
Private owned-window inspection showed the original horizontal Xbox-mode
navigation and larger library tiles. Account images are not published.

The user then confirmed that **Ctrl+Super+Escape restored the desktop, panel
and dock**. The independent Shell query returned active=false with another
advanced epoch, and the same client window was no longer fullscreen. This
verifies the emergency path; normal Desktop selection, lock and client-loss
restoration remain separate live acceptance items.

The user reported that Alt+Tab works, while bare Super did not open the Shell
switcher. The host's Tahoe menu extension blocks GNOME's normal overlay handler and handles
`overlay-key` directly; it bypasses the existing Overview.toggle interception.
Version 7 now implements a reversible signal lease inside the gaming
extension, preserving the other extension's previous handler state. Its files
are installed on disk, but the running Shell still has version 6 until another
user-chosen login. The correction has not yet passed physical Super acceptance;
Tahoe was neither edited nor disabled.

## Implemented source

The [Wine gaming-experience patch](patches/wine-uwp-gaming-experience.patch)
implements the six official gaming-experience functions in `gamemode.dll` and
maps `api-ms-win-gaming-experience-l1-1-0` to that provider. The Windows side
retains the public BOOL/HRESULT and callback ABI. A Unix-side transport talks to
the existing Linux desktop integration when explicitly enabled with
`WINE_UWP_GAMING_EXPERIENCE_BRIDGE=1`. The default is disabled.

The adapter queries real support/active/permission state. Entry and exit require
acknowledgment and a fresh state query; an error or a delayed historical reply
must not report a completed mode transition. The transport tracks service
ownership and monotonically ordered observations so a newer exit or lost
service takes precedence over an older enter acknowledgment. Subscription
handling includes reentrant queries, self-unregister and waiting for an
in-flight callback during external unregister.

The Native1 interface introduced in GNOME extension version 6 is retained in
version 7. It exports the separate session-bus interface
`org.slaveitgr.Xboks.Experience.Native1`, on name
`org.slaveitgr.Xboks.Experience`, object
`/org/slaveitgr/Xboks/Experience/Native1`:

| Member | Wire contract |
| --- | --- |
| GetState | `() → (u version, t epoch, b supported, b active, b canSet, b owned)` |
| SetMode | `(b active, t expectedEpoch) → (t epoch, b active, b owned)` |
| StateChanged | `(t epoch, b active)` |

A kernel-verified same-user caller can read global support and active state
before enrollment. Queries do not enter mode or acquire a lease. Permission,
ownership and mutations require the launcher-created, owner-only enrollment
bound to PID, process start time, canonical Wine executable, selected PE path
and the pinned original CE SHA256. Focus must belong to that process or a
transient owned by it for initial entry. The existing owner can leave after
focus changes. Titles, Wine classes and sign-in do not grant permission.

The Native1 interface reuses the existing exclusive lease, reversible shell
policy, window policy and switcher. Loss of ownership/enrollment, lock,
emergency escape or disable restores desktop state. Switcher Home targets the
verified original CE process. The existing XBOKS API authorization is unchanged.
See the [extension README](../../desktop/gnome/xboks-experience@slaveitgr.github.io/README.md)
for the exact enrollment schema and typed errors.

### Version 7: Super and delegated controller input

The Super lease uses the installed GJS seven-argument
`GObject.signal_handler_find` API with the exact `overlay-key` signal ID and
the `ID | UNBLOCKED` match. It blocks only the currently unblocked connection
IDs, with a 64-handler bound and partial-failure rollback. Its own active-mode
handler opens the switcher and stops later signal handlers from opening a
different surface. Existing blocked handlers retain their block counts.
Restoration disconnects only the new handler and releases one acquired block
from each still-connected original ID. External disconnections and additional
blocks are preserved. Sticky Keys follows the same live, read-only setting as
the original GNOME handler. No other extension's functions or settings are
replaced.

Controller delegation is also implemented, using capability version 4 on the
existing XBOKS interface:

| Member | Wire contract |
| --- | --- |
| GetSwitcherControl | `() → (t controlEpoch, b active, b owned, b visible, b canControl)` |
| ControlSwitcher | `(s action, t expectedControlEpoch) → (b visible)` |

The resident helper must be the real same-user child of the root-owned,
non-group/world-writable installed XBOKS executable. Delegation additionally
requires an active, currently enrolled original-client owner and an unlocked
session. It grants only the fixed switcher actions. Existing Enter, Leave and
Switch ownership checks remain unchanged; the helper continues reporting
`owned=false` while the original client owns the mode lease.

The control revision advances on lease and switcher-visibility changes, while
Native1's mode revision remains separate. The GJS transport and TypeScript
client preserve captured tokens, reject stale observations and queued actions,
and retain the older owned-only protocol when the new method is absent. The
resident service starts its read-only subscription without entering mode.
Controller input follows acknowledged control and visibility instead of the
resident app's own fullscreen status. Guide waits for switcher cancellation;
a rejected cancel does not open Guide over a still-visible switcher. Closing
the resident helper does not release the original client's lease.

## Candidate identity and executed gates

The candidate uses the existing Wine/overlay baseline documented in the
[reproduction guide](wine-uwp-client2612-reproduction.md). Source patch SHA256:
`bb388a7ab912aebba8908d3423667488fb99e9133519fed118924f4856001605`.

| Runtime artifact | SHA256 |
| --- | --- |
| Wine `gamemode.dll` | `4bc4364d7ad13c640b59b348051c65de42e19c28ed7bd241fc4df0092fc0835f` |
| Wine Unix `gamemode.so` | `1f42688e4a90e437ca41aeb3697554096647b6faec7c25be5f32a0107dd7b15d` |
| Wine `apisetschema.dll` | `6ebcef42573658d3aa17de3e00103c8723d0a6c61e24c10bb3d8bb23bc541298` |
| Raw ABI probe executable | `d84e153ae24123c48f7016af2b2ca6e940b90d6982488791e0da768fefdd94ec` |

The [raw C probe and private fixture sources](probes/gaming-experience/README.md)
are published without executables, prefixes or raw diagnostics. They resolve
all six named exports and measured Windows ordinals through the provider and
API set.

| Isolated runtime case | Checks | Failures | Evidence |
| --- | ---: | ---: | --- |
| Bridge disabled | 25 | 0 | `ev_03c62df88cb671ffb5ea2d0eb8733bcb5fc4294324c3df2cc747d0fee0ec8c3f` |
| Bridge enabled, service unavailable | 25 | 0 | `ev_5661d112d6b7595f712189c2c72b6df99fc75918ccf1065887374d6883407a5c` |
| Private Native1 fixture | 128 | 0 | `ev_06435dab173350a59a15e924137bebde25b286579ed24f864875c43ee9aa7f46` |

The fixture checks acknowledgment, permission denial, another sender's lease,
idempotency, callbacks, delayed stale acknowledgment after emergency exit,
service restart and service loss. It uses a newly created private session bus,
never the desktop bus. Its Test1 control interface is fixture-only; it does not
provide the production enrollment verifier or exercise real GNOME policy.
The disposable prefix cleanup returned zero for scoped `wineserver -k` / `-w`.

The version-7 source/mock-Shell and isolated GJS suites passed **79 tests with
zero failures**. They cover the actual extension logic, legacy compatibility,
native permissions, control epochs, races, restoration, staging and delegated
input. An installed-GJS test uses only its own synthetic GObject emitter to
verify the exact legacy signal APIs, preblocked state, later-handler suppression
and rollback; it does not touch Shell handlers. The GJS/Gio file-reader test
includes seven real I/O assertions for descriptor/path metadata, permissions,
symlink refusal, limits and chunked SHA256. The launcher enrollment suite
passed **11 tests with zero failures**.

The focused TypeScript client/controller suites passed **95 tests**, and
typechecking passed. The built XBOKS **0.3.29** resident application candidate
then passed **2,386 application tests** and its packaged helper and eleven
extension files were verified. Candidate Debian package SHA256:
`afaa76772f505c951a60f55bae601a3b739dd2c1053ceb3ea0b6523d20010884`.
The OS-authorized installation subsequently completed, and resident version
0.3.29 is active. Neither the application tests nor the installed extension
files establish physical Super/controller behavior or production release
readiness.

## Timing, rendering and staging limits

The transport's 1500 ms budget bounds Native1/GetNameOwner method reply waits
after acquiring its transport lock. Initial trusted local libdbus
authentication, `dbus_bus_register`/AddMatch setup and time queued for the mutex
are outside that budget. A strict end-to-end 1500 ms latency bound is not
claimed.

The visible CE frontend currently uses the experimental software
CapturePreview/PNG popup bridge on a 120 ms timer. That timer is not a
guaranteed frame rate, and this work provides no measured FPS, memory or input
latency improvement. Streaming/gameplay performance remains unaccepted.

The original staged CE file had mode 0775, which does not meet the enrollment
verifier's no-group/world-write requirement. The mode candidate therefore uses
an independent, byte-identical CE stage copy with mode 0755. Its pinned SHA256
is unchanged, and the original staged file was not modified.

## Installed files and remaining desktop acceptance

All eleven extension files were verified and published through atomic file
replacements in the user extension directory, with metadata last and a complete
backup retained. The
previous installed metadata reported version 4; the first update reported
version 6.
At file installation the previous imported modules remained active; read-only
legacy GetState returned inactive/unowned before and after that update. The
subsequent user-chosen login loaded version 6 successfully. No automatic logout
or mode transition was performed by the installer.

The subsequent version-7 update is also installed on disk, with its version-6
backup retained and inactive mode state unchanged before and after file
publication. The live Shell remains version 6 until a new login loads the new
JavaScript. The resident application update and extension must both be loaded
before testing delegated controller input; the resident update is active and
the remaining reload is the new GNOME login. The prior CE session exited with
code 0 and its experimental profile journal restored. This happened after the
emergency return to desktop and is not an active-owner-loss test. No successful
Shell reload or physical Super/controller result is inferred from installation.

The original CE desktop entry now uses the mode-aware helper. When Native1 is
absent or not usable, it falls back to the ordinary new-client experience.
After a fresh GNOME login it can select the prepared candidate runtime, prefix
and independent mode stage. This fallback and installed-file update do not
establish live mode acceptance.

The first relocated-stage launch failed before displaying a window because its
sibling framework directory was absent. The launcher discovers framework
manifests from that directory; without the Windows App Runtime manifest,
`Microsoft.Windows.AppLifecycle.AppInstance` cannot be resolved. The candidate
now supplies the existing verified four-package graph explicitly through
`WINE_UWP_PACKAGE_DEPENDENCIES` and `WINEPATH`, preserving the shorter original
framework paths. Original Microsoft binaries and framework files are unchanged.
Package-only dependency and search paths are loaded inside the PE launcher's
per-launch defaults, after its own initialization; registry/setup utilities
retain their ordinary DLL search environment.

The existing copied prefix also needed the newly built `gamemode.dll` physically
installed in System32. A fresh prefix bootstrap had installed it for the raw
probe, masking that migration requirement. Without that file, the real client
failed its API-set delay import. A disposable-prefix regression reproduced the
missing-provider failure, then passed all 25 disabled-bridge checks after
installing the exact candidate module; original bytes were restored afterward.
Evidence: `ev_9b4154b052af21926dad2e67f94a1b6c92cc988a7010c522c261c31ec5e16cc8`.
The mode launcher now checks that the installed prefix module matches the
passing runtime before starting the client.

Next acceptance requires the version-7 Shell code and updated resident helper:
verify bare Super, then controller movement/LB/RB/A/B/X, Guide handoff, normal
Desktop selection and restoration after client/owner loss or lock. Recheck the
already observed entry, Alt+Tab and emergency paths against the coordinated
update. Original-client controller navigation and Shell switcher controller
navigation remain separate items. Use a disposable test window for X/close
acceptance. Record exact candidates and native
observations; no production release readiness or full Windows-equivalent
behavior is claimed. No Microsoft payload, private account image, enrollment
record or raw authentication log is published here.
