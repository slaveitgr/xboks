# Optional GNOME Fullscreen Experience and native switcher

This extension targets **GNOME Shell 51 only**. The installed GNOME Shell 51.0
JavaScript resources and Ubuntu Dock source were inspected on 2026-10-21. Other
major versions have not been ported or accepted. This is a reversible desktop
chrome mode, not a separate gaming session, desktop replacement or memory-saving
claim. Existing applications, compositor, lock screen and desktop services keep
running.

The extension starts inactive. An explicit request from the focused xboks
application can temporarily hide the panel, built-in dash, observed Ubuntu Dock
actors, overview entry and hot-corner activation. Existing hot-corner barrier sizes are left unchanged, including previously disabled barriers. It leases object visibility and
methods in memory; it does not write gsettings, disable other extensions, kill
processes, log out or restart GNOME. Later third-party method overrides are not
overwritten during restoration. Unobserved docks/other extensions can conflict
and require separate acceptance.

Version 3 adds an owned native fullscreen window policy, Alt+Tab dispatch and
measured window proportions to the
GNOME-native switcher introduced in version 2. While the owned Fullscreen
Experience lease is active, bare Super and the existing switch-applications /
switch-windows shortcuts open its light fullscreen surface with
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

Bare Super temporarily leases Shell51's overview `toggle` method. Keyboard
switching leases `AppSwitcherPopup.prototype.show` and
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
  also owns the native fullscreen/no-minimize window policy.
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

## Stage, then explicitly install

From the repository root, stage outside the live extension directory:

```sh
python3 scripts/desktop/stage-gnome-experience.py --output work/gnome-experience/staged
```

The output must be new. The script records copied-file SHA-256 hashes. It does
not install or enable anything by default. An explicit user-run installation is:

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
maximize signatures. Official Mutter51.0 `window.c` and
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
