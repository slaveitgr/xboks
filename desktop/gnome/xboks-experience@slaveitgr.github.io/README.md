# Optional GNOME Fullscreen Experience prototype

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

**Emergency exit: Ctrl+Super+Escape.** Entry fails if Shell cannot grab this key.
Normal exit, helper connection loss, extension disable and screen locking restore
the saved Shell state and release the key. Unlock does not automatically reenter.
Native app fullscreen is controlled separately by xboks; the extension does not
change the application's window state.

## Interface and ownership

- Session-bus name/interface: `org.slaveitgr.Xboks.Experience`
- Object: `/org/slaveitgr/Xboks/Experience`
- `GetState() → (b active, b owned)`: `owned` is relative to the calling bus sender.
- `Enter() → ()`, `Leave() → ()`; `StateChanged(b active)` signal.

Entry checks the caller's bus-reported process ID against the focused xboks
window's PID or its direct child, plus the xboks window/application identity and
an unlocked user session. The persistent helper is a child of Electron's main
process. The active lease belongs to its unique bus connection; another caller
cannot take over or leave that lease. Disconnecting that connection restores
the desktop even if the helper is killed. This prevents accidental cross-app or
cross-profile control; it is not a security boundary against malicious code
already running as the same desktop user.

`assets/desktop/experience-client.js` is the app's persistent GJS transport. It
accepts bounded JSONL `{id, method:"state"|"enter"|"leave"}` on stdin and emits
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
Once the running Shell discovers it, the user can enable it with:

```sh
gnome-extensions enable xboks-experience@slaveitgr.github.io
```

If the running Shell has not discovered a newly installed extension, leave the
current session alone. Do not force a logout or compositor restart. A fresh
isolated development session is the safer acceptance environment:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

Disabling restores the desktop:

```sh
gnome-extensions disable xboks-experience@slaveitgr.github.io
```

## Verification scope

Automated checks cover the pure ownership/restoration state, staging boundaries,
syntax, and the real GJS helper against a fake service on an isolated D-Bus.
Those tests do not load the extension into the live host Shell or prove panel,
dock, gestures, multi-monitor, physical keyboard, lock/unlock or game behavior.
These need a separately observed nested or user-approved desktop acceptance run.
No original Windows Shell component is being executed.

Primary references:

- [GNOME extension creation and nested testing](https://gjs.guide/extensions/development/creating.html)
- [GNOME Shell 51 extension changes](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)
- [GNOME session-mode lifecycle](https://gjs.guide/extensions/topics/session-modes.html)
- [GJS D-Bus service/client guide](https://gjs.guide/guides/gio/dbus.html)
- [Gio caller identity](https://docs.gtk.org/gio/method.DBusMethodInvocation.get_sender.html)
- [Gio bus-owner watch](https://docs.gtk.org/gio/func.bus_watch_name_on_connection.html)

Local resource fingerprints are saved only in ignored
`work/gnome-experience/source-51/manifest.json`; GNOME source itself is not copied
into the product extension.
