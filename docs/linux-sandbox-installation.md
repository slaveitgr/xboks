# Ubuntu sandbox startup and native packages

On Ubuntu 23.10 and later, AppArmor can restrict unprivileged user namespaces.
An Electron AppImage may then abort before application JavaScript starts with
`setuid_sandbox_host.cc` / “SUID sandbox helper … not configured correctly”. Its
helper lives inside the temporary read-only AppImage mount and is not an
installed root-owned SUID helper. Changing application settings cannot repair
that startup failure. [Ubuntu’s explanation](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces),
[Chromium’s sandbox guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).

Use the **native DEB** on affected Ubuntu systems. Build it with:

```sh
npm run dist:deb
```

Install the verified generated `.deb` through the system package manager, for
example `sudo apt install ./release/xboks-<version>-amd64.deb` (use its actual
filename). This final installation requires administrator authentication.
Building or inspecting a package does not install it.

The package installs into `/opt/xboks`, owned by root. Its post-install script
validates the fixed directory, native executable, wrapper and matching Chromium
helper, checks the build-generated SHA-256 pair, and configures only
`/opt/xboks/chrome-sandbox` as root:root with mode `4755`. The launcher wrapper
and native executable remain ordinary executables. It refuses symlinks,
user-writable paths, unexpected checksum paths and mismatched bytes. Updates
must use a verified native package so the system package manager retains these
ownership guarantees.

Do not copy a SUID helper into a user-writable installation, change ownership
inside `/tmp/.mount_*`, disable Ubuntu’s global namespace policy, or add
`--no-sandbox`. Electron explicitly limits that flag to testing because it
disables critical Chromium sandboxing. The DEB keeps the app’s sandboxed
renderers and isolated Remote Play view enabled.
[Electron documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox#disabling-chromiums-sandbox-testing-only).

After moving from the user AppImage installation:

- Point the resident Game Bar service at **`/opt/xboks/xboks`**, using the owned
  installer’s `--launcher` option. Enabling login startup and starting now are
  separate actions; do not restart an active game to migrate the unit.
- An old `~/.local/bin/xboks` symlink and a user `xboks.desktop` file can shadow
  the native package’s `/usr/bin/xboks` and system application-menu entry.
  Review and update only the old xboks entries. The root post-install script
  deliberately does not edit users’ home directories.
- AppImage in-place launcher updates do not update a DEB installation. Use a
  verified `.deb` upgrade; engine/runtime downloads remain separate.

The portable AppImage remains available for systems that provide a working
Chromium sandbox. A restricted host is not automatically made compatible by
an AppImage checksum or a successful build. Tests using `--no-sandbox` are
isolated application/IPC tests and do not prove production sandbox startup.
