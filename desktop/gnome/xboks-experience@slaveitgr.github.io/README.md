# Linux Gaming Mode (Fullscreen Experience)

A GNOME extension for a controller-oriented gaming desktop with a selectable
home application, a native running-app switcher and reversible fullscreen window
policy. The display name is independent of XBOKS; the existing extension UUID
`xboks-experience@slaveitgr.github.io` and application bridge names remain stable
so installed clients continue to connect after an update.

## Choose your gaming home

Open the extension's preferences from the GNOME Extensions application, or run:

```sh
gnome-extensions prefs xboks-experience@slaveitgr.github.io
```

Choose **Gaming home app**:

| Home | Required installation | Requested interface |
| --- | --- | --- |
| None | No application | Keep the ordinary desktop; no home starts at sign-in. |
| Steam Big Picture | Native Steam or Flatpak Steam with its desktop launcher | Steam's controller interface through `steam://open/bigpicture`. |
| XBOKS Fullscreen | XBOKS with the `--fullscreen-experience` launch adapter | XBOKS Fullscreen Experience and the integrated desktop mode. |
| Original Xbox (Xbox mode) | The original client, a prepared experimental Wine-UWP runtime and an enrolled launcher | The original client's own Xbox mode with the Native1 bridge. |

Preferences show which desktop launchers are installed and allow refreshing the
list after installing an application. A matching desktop entry establishes only
that an app can be requested; it does not prove runtime compatibility. In
particular, Original Xbox requires the separately prepared Wine bridge and an
enrolled client. The extension does not include or download Microsoft binaries,
Windows, Wine, Steam, XBOKS, account credentials or games.

**Enter now** requests the selected home. **Desktop** restores the desktop without
closing the applications. **Enter gaming mode at sign-in** starts the selected
home after a fresh sign-in; turn it off to enter only on request. Its default is
on, but the home defaults to **None**, so installation alone does not start an
application or hide the desktop. Selecting a home configures future starts;
opening preferences does not itself launch it.

During a home launch the Shell owns a temporary black cover on each monitor
before waiting for the application. The startup deadline is five minutes to
accommodate a cold experimental Wine client. Entry requires the home to become
ready; a launch failure, timeout, cancellation, session lock or extension disable
removes the cover and restores the desktop. **Ctrl+Super+Escape** is available
before any desktop chrome is hidden. Selecting None prevents automatic home
startup. A new GNOME login is required to verify startup behavior after updating
an already loaded extension.

The extension stores only its own home selection and startup preference in
`org.gnome.shell.extensions.linux-gaming-mode`. The preferences window writes
these values at the user's request; Shell chrome, other extensions and global
keyboard shortcuts are still restored through the existing in-memory lease.

Version 8 provides this home selection and launch coordination. Automated
source/fixture checks are separate from physical desktop acceptance. Steam
startup and the original client's pre-active launch path require their own
observed runs; a successful original-client mode entry through its menu does
not establish that every sign-in startup path works.

## Desktop behavior and supported versions

This extension targets **GNOME Shell 51 only**. The installed GNOME Shell 51.0
JavaScript resources and Ubuntu Dock source were inspected on 2026-10-21. Other
major versions have not been ported or accepted. This is a reversible desktop
chrome mode, not a separate gaming session, desktop replacement or memory-saving
claim. Existing applications, compositor, lock screen and desktop services keep
running.

Without a configured home the extension starts inactive. A configured home
launch or an explicit request from the focused XBOKS application can temporarily
hide the panel, built-in dash, observed Ubuntu Dock
actors, overview entry and hot-corner activation. Existing hot-corner barrier sizes are left unchanged, including previously disabled barriers. It leases object visibility and
methods in memory; it does not rewrite desktop settings, disable other extensions, kill
processes, log out or restart GNOME. Later third-party method overrides are not
overwritten during restoration. Unobserved docks/other extensions can conflict
and require separate acceptance.

Version 3 adds an owned native fullscreen window policy, Alt+Tab dispatch and
measured window proportions to the
GNOME-native switcher introduced in version 2. While the owned Fullscreen
Experience lease is active, bare Super and the existing switch-applications /
switch-windows shortcuts open its fullscreen surface with
actual running-window icons, live Mutter window clones, neighboring previews
and Xbox/Desktop controls. LB/RB or left/right selects a window; A/Enter activates
that existing window, B/Escape dismisses, and explicit X asks the selected app to
close normally. Up/down selects the bottom controls. Desktop releases the lease;
Xbox focuses the existing xboks application window. Alt+Tab advances from the
foreground window, repeated Tab advances again, Alt+Shift+Tab moves backward, and
releasing the primary shortcut modifier activates the selected window. Bare Super
keeps the switcher open until an explicit selection or dismissal. It never terminates a
process or starts a replacement desktop. English/Greek labels follow Shell's
language. The Windows screenshots guide placement; no Windows Shell is executed.

Package version 4 follows the GNOME desktop's live
`org.gnome.desktop.interface color-scheme` preference. `prefer-dark` uses a
near-black radial gradient, dark cards, white text and a light cyan selected-card
border/active-mode underline. `default` and `prefer-light` keep the existing
light palette and geometry. No hour, wallpaper or Shell stylesheet is used to
guess the desktop preference. Shell51's `St.Settings.color_scheme` native enum
is a fallback when the desktop schema cannot be read; the separate Shell color
override does not replace an available desktop preference. Changes update the
open root's style classes without recreating previews, changing selection or
acquiring another modal grab. Settings observers exist only while the switcher
is visible and disconnect on dismissal, failed entry and extension cleanup.
The extension only reads these settings. The D-Bus capability remains version 3
because this color change adds no protocol methods or window policy.

Bare Super temporarily leases Shell51's active `overlay-key` signal handlers.
Only currently unblocked handlers are blocked, by their exact connection IDs;
handlers already blocked by another extension keep their existing block count.
The bounded scan admits at most 64 active handlers and undoes acquired blocks
if entry fails. Our mode-only handler opens the switcher and stops emission to
handlers registered later. Restoration disconnects only our own handler and
releases one owned block from each still-connected original ID, preserving
external disconnections and additional blocks. No other extension's function,
registration or setting is replaced. Sticky Keys follows the same live read of
`org.gnome.desktop.a11y.keyboard stickykeys-enable` as Shell51's original
handler. The existing overview `toggle` method lease also covers other Shell
entry points. Keyboard switching leases `AppSwitcherPopup.prototype.show` and
`WindowSwitcherPopup.prototype.show` for the four existing applications/windows
forward/backward bindings. Shell51's existing WM handler builds the stock popup,
then destroys it after our dispatcher returns false. The unused popup has never
acquired a modal grab. This preserves the existing WM callbacks and every global
shortcut setting. Original own/inherited methods are restored exactly; later
third-party replacements are preserved. A third-party switcher with its own
popup implementation may bypass these observed stock entry points. Super+G and the emergency
exit are not consumed by the switcher's keyboard controller. Monitor changes,
system modals, a revoked modal grab or lease loss close the switcher and remove
its chrome, signal subscriptions and timers. Inventory is bounded to 32 native
application windows. Preview availability depends on the compositor's real
window actor. Selected cards retain the native window's aspect ratio: at
1920×1080 the reference preview height is 510 pixels inside a 591-pixel card,
yielding about 927 pixels width for a 16:9 window and 815 pixels for a 795:510
window. The selected card stays centered; neighboring previews use the measured
257-pixel gap. Top app icons are native 32-pixel textures in 72-pixel slots.
Bottom modes use the actual xboks app icon when available and native theme icons;
the active Xbox mode has a blue underline. The clock reads the local time. No
network/audio status, running applications, Windows app icons or private source
screenshots are fabricated or bundled. These measurements guide the native
implementation; pixel parity requires a real Shell rendering acceptance run.

**Emergency exit: Ctrl+Super+Escape.** Entry fails if Shell cannot grab this key.
Normal exit, helper connection loss, extension disable and screen locking restore
the saved Shell state and release the key. Unlock does not automatically reenter.
During the active owned lease, the extension snapshots each ordinary native app
window's fullscreen, independent maximize axes and minimized state. It asks
Mutter to fullscreen those windows, undoes minimize/exit-fullscreen requests,
and applies the same policy to later mapped app windows. Entry retains the
original focused window. Mutter's fullscreen operation raises windows, so later
inventory re-raises the current focused window after a background state change;
it never activates a newly discovered unfocused app.
Guide, taskbar-skipped, transient/attached/dialog/modal/system windows are
excluded. Auxiliary dialogs keep their ordinary behavior. No process is killed
and no window is moved between workspaces or monitors.

GNOME51 exposes `make_fullscreen()` but no `can_fullscreen()` capability query.
The policy checks the actual resulting state. If Mutter refuses fullscreen, a
resizable app uses its available native maximize state; a fixed-size app may
remain windowed. Refusal is logged and is not represented as fullscreen success.
Native state and display behavior still require live Shell acceptance. On
Desktop/lock/owner loss/disable, notifications disconnect before the saved
fullscreen/maximize/minimize states restore; closed windows are ignored and one
restoration error cannot prevent attempts for the remaining windows. The final
surviving focused window is re-raised after restoration without activation. xboks
controls its own initial fullscreen before Enter and its own final window state
after Leave; the Shell policy preserves the state it observed at lease entry.

## Interface and ownership

- Session-bus name/interface: `org.slaveitgr.Xboks.Experience`
- Object: `/org/slaveitgr/Xboks/Experience`
- `GetState() → (b active, b owned)`: `owned` is relative to the calling bus sender.
- `Enter() → ()`, `Leave() → ()`; `StateChanged(b active)` signal.
- `GetCapabilities() → (u version)`: version 2 provides the bridge below; version 3
  also owns the native fullscreen/no-minimize window policy; version 4 adds the
  separate switcher-control capability below.
- `GetForegroundApp() → (s json)`: ephemeral, bounded actual
  `{desktopId,name,title}`; no account data, persistence or arbitrary window ID.
- `FocusGuide() → ()`: activates only the authenticated xboks main process's
  native window titled `xboks Game Bar`.
- `Switch(s action) → (b visible)`; `SwitcherChanged(b visible)` signal. Fixed
  actions are `toggle`, `open`, `next`, `previous`, `left`, `right`, `up`, `down`,
  `accept`, `cancel`, `desktop`, `xbox` and `close-window`.

Entry checks the caller's bus-reported process ID against the focused xboks
window's PID or its direct child, plus the xboks window/application identity and
an unlocked user session. The persistent helper is a child of Electron's main
process. The active lease belongs to its unique bus connection; another caller
cannot take over or leave that lease. Disconnecting that connection restores
the desktop even if the helper is killed. This prevents accidental cross-app or
cross-profile control; it is not a security boundary against malicious code
already running as the same desktop user.

Foreground/Guide calls also work outside an active Fullscreen Experience lease.
They require the actual same-user helper's direct parent to be the fixed,
root-owned installed `/opt/xboks/xboks.bin`, or an already observed native xboks
window's owning process. Guide focus accepts no client-supplied PID or window
title. Both calls refuse locked/greeter sessions. Switcher actions additionally
require the active lease's unique bus sender. This keeps background focus
support distinct from ownership of desktop mode.

`assets/desktop/experience-client.js` is the app's persistent GJS transport. It
accepts bounded JSONL state/enter/leave and versioned bridge commands on stdin and emits
`{id,ok,active,owned,error?}` replies, plus `state`/`unavailable` events. EOF and
SIGTERM close the owned connection. The helper never installs/enables the
extension and does not call Enter at startup. Ephemeral `gdbus` is suitable for
GetState discovery, because Enter's ownership must outlive the method call.

## Optional original-client Native1 bridge

Package version 6 adds a separate interface on the same session-bus name:
`org.slaveitgr.Xboks.Experience.Native1`, object
`/org/slaveitgr/Xboks/Experience/Native1`. The existing XBOKS API and its entry
authorization are unchanged.

- `GetState() → (u version, t epoch, b supported, b active, b canSet, b owned)`.
- `SetMode(b active, t expectedEpoch) → (t epoch, b active, b owned)`.
- `StateChanged(t epoch, b active)`.

Read-only support and global active state are available to a caller whose
kernel-reported session-bus UID matches this desktop user. These queries do not
enter mode, create a lease or change desktop state. Permission and ownership
are checked separately; sign-in, a window title and a Wine class do not imply
either. Changes require a matching epoch, preventing a stale request from
reentering after exit, lock or ownership loss. Clients must also reject replies
from a replaced bus-service owner.

Original-client entry is explicitly enrolled by its launcher through
`/run/user/UID/xboks/original-clients/PID.json`. The runtime/xboks/enrollment
directories must be owned by the user with mode 0700; the regular record must
be owned by the user with mode 0600. Its schema is exactly:

```json
{
  "schema": 1,
  "pid": 12345,
  "startTime": "123456789",
  "executable": "/canonical/private/runtime/wine-preloader",
  "pePath": "/canonical/original/XboxPcAppCE.exe",
  "peSHA256": "dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89",
  "desktopId": "original-xbox-ce-wineuwp.desktop"
}
```

The PID and UID come from DBus credentials, then the record is bound to Linux
`/proc/PID/stat` start-time ticks, the actual canonical process executable and
selected PE command line. A fresh asynchronous SHA256 verifies the pinned
original CE bytes; caching is keyed to stable file/process metadata. Symlinks,
broader enrollment permissions, process reuse and changed identity are rejected.
The PID is never accepted from a DBus method argument.

Entry additionally requires the enrolled process's focused window or a
transient owned by it, an unlocked user session, a closed overview and an
available lease. The existing owner may exit after focus moves elsewhere.
Enrollment revocation, bus-owner loss, lock, emergency escape and extension
disable restore the desktop. Switcher Home returns to the enrolled CE process.
Errors use typed `Native1.Error.AccessDenied`, `Busy`, `StaleEpoch`,
`NotSupported`, `Unavailable`, `OverviewOpen`, `EmergencyUnavailable` or
`ShellError` names; descriptions contain no account or enrollment data.

This interface reuses the existing reversible shell policy. Its source tests
do not establish that a live Wine client can enter Xbox mode; that requires
separate desktop acceptance. It does not stop background services or establish
an FPS/memory benefit. No enrollment is created and no mode is entered merely
by installing or enabling the extension.

## Resident controller service and original-client mode

Package version 7 adds controller access to the native switcher while the
original client owns Xbox mode. The mode lease continues to belong to that
client's persistent Wine connection. The resident XBOKS helper reports
`owned=false`; switcher permission does not make its own Fullscreen Experience
active or grant the ability to acquire another client's lease.

The existing interface has two additive capability-version-4 methods:

- `GetSwitcherControl() → (t epoch, b active, b owned, b visible, b canControl)`
  returns one atomic snapshot. `owned` remains relative to the calling sender;
  `canControl` is a separate delegated permission.
- `ControlSwitcher(s action, t expectedEpoch) → (b visible)` accepts the fixed
  existing switcher action list. Delegation requires the real same-user helper
  parent to be the installed, root-owned `/opt/xboks/xboks.bin`, a current
  enrolled original-client owner, an active lease and an unlocked user session.

The control revision advances on lease and switcher-visibility changes. A
queued action cannot select or close a window in a reopened switcher or after a
mode-owner transition. This revision is separate from Native1's mode revision.
Old `Enter`, `Leave` and `Switch` ownership checks remain unchanged. The
controller helper cannot take the Native lease, and its disappearance does not
release that lease. Selecting Desktop through the delegated switcher remains
an explicit user action that restores the desktop.

The GJS transport prefers this atomic snapshot and falls back to the original
owned-only protocol when the new method is absent. Delegated JSONL switcher
commands carry the captured `controlEpoch`; the helper never substitutes a
newer token or upgrades an owner-only command after a role change. Its state,
reply and switcher events keep ownership, delegated permission and visibility
separate. The main process assigns the controller surface only while visibility
and control are both acknowledged. Opening Guide awaits switcher cancellation
before handing input to Guide.

Source and isolated-bus tests cover these paths. They do not establish physical
controller behavior in the user's live GNOME session; that needs separate
acceptance after loading the updated extension and resident helper.

## Home preferences interface

The additive interface `org.slaveitgr.Xboks.Experience.Home1` uses object
`/org/slaveitgr/Xboks/Experience/Home1` on the existing session bus name.
`LaunchHome()` requests the configured home, `LeaveMode()` restores the desktop,
and `GetState()` returns bounded JSON describing the selected home and actual
active/loading state. Preferences communicate with this interface rather than
running arbitrary shell commands. It does not replace the existing XBOKS or
Native1 lease contracts.

## Stage, package, then explicitly install

Staging requires Python 3 and `glib-compile-schemas` (on Ubuntu, supplied by
`libglib2.0-bin`). The script compiles the copied schema with `--strict`; it never
ships a stale source-tree `gschemas.compiled` file.

From the repository root, stage outside the live extension directory:

```sh
python3 scripts/desktop/stage-gnome-experience.py --output work/gnome-experience/staged
```

The output must be new. The script records source and compiled-schema SHA-256
hashes. It does not install or enable anything by default. To prepare an
installable GitHub release artifact, use another new output directory:

```sh
python3 scripts/desktop/stage-gnome-experience.py \
  --output work/linux-gaming-mode/release-stage \
  --archive work/linux-gaming-mode/xboks-experience@slaveitgr.github.io.shell-extension.zip
```

The archive contains the verified extension files at its root, including
preferences and its compiled schema. Packaging refuses a changed staged file,
an output inside the bundle or an existing archive. No private research files,
game data, account state or original-client runtime are added.

Install that archive using GNOME Extensions, or:

```sh
gnome-extensions install work/linux-gaming-mode/xboks-experience@slaveitgr.github.io.shell-extension.zip
```

An alternative user-run source installation is:

```sh
python3 scripts/desktop/stage-gnome-experience.py \
  --output work/gnome-experience/install-stage --install
```

Installation checks Shell major 51, refuses an existing destination and copies
into the user's extension directory. It still does not enable the extension.
GNOME Shell51 imports extension modules once. A newly installed local UUID needs
a fresh user-chosen login session for discovery; updating an already imported
UUID also needs a fresh Shell session to load new JavaScript. `ReloadExtension`
is explicitly unsupported by Shell51. Disabling/enabling the UUID in the same
session does not load a new version. Leave the current session alone: no script
forces logout or compositor restart. After the user chooses a fresh login,
enable and inspect it with:

```sh
gnome-extensions enable xboks-experience@slaveitgr.github.io
gnome-extensions info xboks-experience@slaveitgr.github.io
```

A fresh isolated development session can be used for acceptance instead:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

Disabling restores the desktop:

```sh
gnome-extensions disable xboks-experience@slaveitgr.github.io
```

## Verification scope

Automated checks cover the pure ownership/restoration state, staging boundaries,
syntax, actual extension/switcher code with native-interface fixtures, native
Clutter/Shell51 typelib signatures without creating actors, and the real GJS
helper against a fake service on an isolated D-Bus. Shell51's installed
`switcherPopup.js` confirms KeyController/key-press and key/state tuple handling;
`main.js` confirms modal ownership; `windowManager.js` confirms popup
construction/show/false-return destruction; `layout.js` confirms top chrome and
system-modal signaling. Shell51 uses `Clutter.Grab.is_revoked()` and the `revoked`
property, rather than the removed `get_seat_state`/`GrabState` API.
The native typelib probe also checks modifier-change, translated ISO_Left_Tab,
window state methods/properties, map/unmanaged/tracker signals and GNOME51
maximize signatures, St color-scheme values, style-class methods and the radial
gradient enum. An isolated real GJS fixture uses Gio/St settings with a private
session bus, no display access and the in-memory GSettings backend. It exercises
dark/light/default changes, native enum propagation, observer removal, reopen,
private preference restoration and native stylesheet parsing. Switcher fixtures
also verify that theme changes retain the same live previews, selected window
and modal, and that failed modal creation leaves no settings observers.
Shell51's installed `main.js` confirms that the Shell color override and its
default style variant are separate from the observed desktop preference.
Official Mutter51.0 `window.c` and
`meta-window-config.c` also confirm that maximize flag setters process geometry
configs, add/remove independent axes, and fullscreen raises windows. Policy fixtures exercise state restoration, exclusions,
late mapping, closed-window races, minimize/fullscreen enforcement and refused
fullscreen fallback. Native theme parsing was checked without creating actors. A separate GNOME51
headless boot with private session/system D-Bus, private XDG directories and
keyfile GSettings loaded this extension and returned capability 3; it did not
enter the owned lease or test switcher rendering/window enforcement.
These tests do not load the extension into the live host Shell or prove panel,
dock, gestures, multi-monitor, physical keyboard, lock/unlock or game behavior.
These need a separately observed nested or user-approved desktop acceptance run.
No original Windows Shell component is being executed.

Primary references:

- [GNOME extension creation and nested testing](https://gjs.guide/extensions/development/creating.html)
- [GNOME Shell 51 extension changes](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)
- [GNOME extension JavaScript reload limitations](https://gjs.guide/extensions/development/debugging.html)
- [GNOME session-mode lifecycle](https://gjs.guide/extensions/topics/session-modes.html)
- [GJS D-Bus service/client guide](https://gjs.guide/guides/gio/dbus.html)
- [Mutter51 native implementation](https://gitlab.gnome.org/GNOME/mutter/-/blob/51.0/src/core/window.c)
- [Mutter51 native window API](https://gnome.pages.gitlab.gnome.org/mutter/meta/class.Window.html)
- [Gio caller identity](https://docs.gtk.org/gio/method.DBusMethodInvocation.get_sender.html)
- [Gio bus-owner watch](https://docs.gtk.org/gio/func.bus_watch_name_on_connection.html)

Local resource fingerprints are saved only in ignored
`work/gnome-experience/source-51/manifest.json`; GNOME source itself is not copied
into the product extension.
