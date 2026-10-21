# Game Bar user service

`scripts/desktop/install-gamebar-service.py` installs an opt-in user service for the app's resident `--gamebar-service` mode. Its unit is `~/.config/systemd/user/xboks-gamebar.service`, or the equivalent under `XDG_CONFIG_HOME`. It uses the normal xboks profile and single-instance mechanism. It does not create a second account/profile, run as root, or enable user lingering.

On Ubuntu/Debian with the native DEB installed, use the stable root-owned launcher:

```sh
python3 scripts/desktop/install-gamebar-service.py \
  --launcher /opt/xboks/xboks --enable
```

`--enable` opts into future graphical logins. This command does **not** start the app immediately. Add `--start` only when immediate startup is intended. The `--launcher` argument must be an absolute regular executable. On distributions supporting an AppImage's Chromium sandbox, the installed AppImage itself is also supported; do not pass the `~/.local/bin/xboks` symlink. Ubuntu AppImage startup restrictions and migration are described in [Ubuntu startup](../linux-sandbox-installation.md). `--config-root` is the XDG configuration root used by the user manager, not an application profile. Install without `--enable` to write/review the unit without enabling future logins. No graphical session is created by this helper.

The unit has `WantedBy` and `PartOf` set to `graphical-session.target`, uses `After=graphical-session-pre.target`, and restarts on process failure with a bounded start rate. `KillMode=mixed` first sends SIGTERM to the main process so the app can quit gracefully; remaining processes are forcibly terminated only after the 20-second stop deadline. Stopping the service or choosing the app's explicit Quit closes the current app and games through normal shutdown. Installing or enabling the unit does not stop an already running app. It relies on the graphical session's existing user-manager environment. No `DISPLAY`, Wayland socket, session-bus address or environment-import command is hardcoded. The `:` executable prefix disables dollar-variable expansion; percent characters are escaped as `%%`, and spaces are quoted. Paths containing quote, backslash or glob characters are rejected because systemd rejects them in executable names. These rules follow [systemd.service command-line semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [systemd.syntax](https://www.freedesktop.org/software/systemd/man/latest/systemd.syntax.html) and the [graphical-session target contract](https://www.freedesktop.org/software/systemd/man/latest/systemd.special.html#graphical-session.target).

The app's resident mode starts without the main window. Closing the main window hides its UI and keeps the resident process available; `--game-bar` requests the Guide, and a normal launch can open the main UI. Explicit Quit exits until another explicit launch or the next login. When an existing app process already owns the profile, a service invocation hands off to that process and exits successfully: systemd does not thereby supervise the original process. At the next graphical login, the service can become the primary process. This handoff limitation must not be reported as uninterrupted systemd crash supervision of a previously launched instance.

To reverse the installation:

```sh
python3 scripts/desktop/install-gamebar-service.py --uninstall
```

Removal stops and disables only a validated, exact installer-owned unit, then removes it and reloads the user manager. Foreign/modified units, symlink units, unsafe owners/permissions and startup links pointing elsewhere are preserved with an error. Account data, library state, the launcher and global keyboard bindings are unaffected. Installing this service does not configure Win+G; the existing app shortcut or desktop integration still owns the binding.

Validation uses 26 isolated fixture tests with a fake `systemctl`; no test enables, starts or stops the host's service. A separate read-only `systemd-analyze verify` run with an isolated unit search path accepted a real temporary launcher path containing spaces, `$HOME` and `%n`. This verifies unit parsing, not a live desktop login, external-game overlay behavior, compositor stacking or audible/media operation. A permanent process is separate from implementing a compositor-native Game Bar overlay on Wayland.
