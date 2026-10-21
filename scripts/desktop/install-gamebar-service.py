#!/usr/bin/env python3
"""Install an opt-in, session-scoped XBOKS Game Bar user service.

Does not start or enable the unit unless explicitly requested. This helper never
uses sudo, enables lingering, imports desktop environment variables, or edits an
account/profile. The application owns its resident/single-instance lifecycle.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

UNIT_NAME = "xboks-gamebar.service"
MARKER = "# X-Xboks-GameBar-Service=1"
LAUNCHER_HEADER = "# Xboks-Launcher: "
MAX_UNIT_BYTES = 16384


def absolute_path(value: str | Path) -> Path:
    value = os.fspath(value)
    if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Paths must not contain control characters.")
    result = Path(value)
    if not result.is_absolute() or ".." in result.parts:
        raise ValueError("An absolute path without parent traversal is required.")
    return result


def exec_path(value: str | Path) -> str:
    """systemd.syntax quoting; ':' below disables all $ expansion.

    A doubled dollar in the executable path is NOT interchangeable with a
    literal dollar. Percent specifiers are still expanded with the ':' prefix.
    """
    value = str(absolute_path(value))
    # systemd's config_parse_exec/string_is_safe rejects these in the executable
    # name even if syntactically quoted. Fail before publishing an unusable unit.
    if any(char in value for char in "\\\"'*?[]"):
        raise ValueError("systemd executable paths cannot contain quotes, backslashes or glob characters.")
    value.encode("utf-8", errors="strict")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def render_unit(launcher: str | Path) -> str:
    launcher = str(absolute_path(launcher))
    return f"""{MARKER}
{LAUNCHER_HEADER}{json.dumps(launcher, ensure_ascii=True)}
[Unit]
Description=XBOKS Game Bar
PartOf=graphical-session.target
After=graphical-session-pre.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
ExecStart=:{exec_path(launcher)} --gamebar-service
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=graphical-session.target
"""


def validate_launcher(value: str | Path) -> Path:
    launcher = absolute_path(value)
    st = launcher.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid not in (0, os.geteuid()):
        raise ValueError("Launcher must be a regular executable owned by you or root.")
    if st.st_mode & 0o022 or not os.access(launcher, os.X_OK):
        raise ValueError("Launcher must be executable and not writable by other users.")
    return launcher


def default_config_root() -> Path:
    return absolute_path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))


@contextmanager
def unit_directory(config_root: str | Path, create: bool):
    """Walk with directory FDs so no symlink component is followed.

    Existing system ancestors (e.g. /home or /tmp) are only traversed. The
    chosen config root and descendants must be private to the current user.
    """
    root = absolute_path(config_root)
    parts = root.parts[1:] + ("systemd", "user")
    if not root.parts[1:]:
        raise ValueError("The filesystem root is not a user configuration directory.")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for index, part in enumerate(parts):
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            if index >= len(root.parts[1:]) - 1:
                st = os.fstat(fd)
                if st.st_uid != os.geteuid() or st.st_mode & 0o022:
                    raise ValueError("Configuration directories must be owned by you and not writable by other users.")
        yield fd
    finally:
        os.close(fd)


def read_owned_unit(directory_fd: int):
    try:
        fd = os.open(UNIT_NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except FileNotFoundError:
        return None
    try:
        st = os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid()
                or st.st_mode & 0o022 or st.st_nlink != 1 or st.st_size > MAX_UNIT_BYTES):
            raise ValueError("Refusing an unsafe existing Game Bar unit.")
        raw = os.read(fd, MAX_UNIT_BYTES + 1)
        text = raw.decode("utf-8")
        lines = text.splitlines()
        if len(lines) < 2 or lines[0] != MARKER or not lines[1].startswith(LAUNCHER_HEADER):
            raise ValueError("Refusing to replace or remove a foreign Game Bar unit.")
        launcher = json.loads(lines[1][len(LAUNCHER_HEADER):])
        if not isinstance(launcher, str) or text != render_unit(launcher):
            raise ValueError("The existing Game Bar unit was modified; preserve it and review it manually.")
        return st, raw
    finally:
        os.close(fd)


@contextmanager
def installer_lock(directory_fd: int):
    fd = os.open(".xboks-gamebar.install.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
                 0o600, dir_fd=directory_fd)
    try:
        st = os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid()
                or st.st_mode & 0o077 or st.st_nlink != 1):
            raise ValueError("Refusing an unsafe Game Bar installer lock.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def same_unit(before, after) -> bool:
    return (before is None and after is None) or (
        before is not None and after is not None
        and (before[0].st_dev, before[0].st_ino, before[1]) == (after[0].st_dev, after[0].st_ino, after[1]))


def validate_wants_link(directory_fd: int, target: Path):
    """Do not let enable/disable replace a different unit's startup link."""
    try:
        fd = os.open("graphical-session.target.wants", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                     dir_fd=directory_fd)
    except FileNotFoundError:
        return
    try:
        st = os.fstat(fd)
        if st.st_uid != os.geteuid() or st.st_mode & 0o022:
            raise ValueError("Refusing an unsafe graphical-session startup directory.")
        try:
            st = os.stat(UNIT_NAME, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if not stat.S_ISLNK(st.st_mode):
            raise ValueError("Refusing a foreign graphical-session Game Bar startup entry.")
        destination = os.readlink(UNIT_NAME, dir_fd=fd)
        resolved = os.path.normpath(os.path.join(str(target.parent / "graphical-session.target.wants"), destination))
        if resolved != str(target):
            raise ValueError("Refusing a foreign graphical-session Game Bar startup link.")
    finally:
        os.close(fd)


def write_unit(directory_fd: int, contents: bytes, previous):
    if previous is not None and previous[1] == contents:
        return
    temporary = ".xboks-gamebar." + uuid.uuid4().hex + ".tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        if not same_unit(previous, read_owned_unit(directory_fd)):
            raise ValueError("The Game Bar unit changed during installation.")
        if previous is None:
            # Exclusive publication never overwrites a concurrently created file.
            os.link(temporary, UNIT_NAME, src_dir_fd=directory_fd, dst_dir_fd=directory_fd, follow_symlinks=False)
        else:
            os.replace(temporary, UNIT_NAME, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        os.fsync(directory_fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass


def run_systemctl(arguments: list[str], config_root: Path):
    # Shell-free, user manager only. The graphical session supplies its own
    # DISPLAY/WAYLAND_DISPLAY/session bus environment; no hardcoded import.
    subprocess.run(["systemctl", "--user", "--no-ask-password", *arguments], check=True,
                   timeout=20, env={**os.environ, "XDG_CONFIG_HOME": str(config_root)})


def install(config_root: str | Path, launcher: str | Path | None = None, *, enable=False,
            start=False, uninstall=False, runner=run_systemctl) -> Path:
    if os.geteuid() == 0:
        raise ValueError("Run this helper as your desktop user, without sudo.")
    config_root = absolute_path(config_root)
    target = config_root / "systemd" / "user" / UNIT_NAME
    if uninstall and (enable or start or launcher is not None):
        raise ValueError("--uninstall cannot be combined with installation options.")
    desired = None if uninstall else render_unit(validate_launcher(launcher or "")).encode("utf-8")
    with ExitStack() as stack:
        try:
            directory_fd = stack.enter_context(unit_directory(config_root, not uninstall))
        except FileNotFoundError:
            if uninstall:
                return target
            raise
        stack.enter_context(installer_lock(directory_fd))
        previous = read_owned_unit(directory_fd)
        if uninstall:
            if previous is None:
                return target
            validate_wants_link(directory_fd, target)
            runner(["stop", UNIT_NAME], config_root)
            runner(["disable", UNIT_NAME], config_root)
            if not same_unit(previous, read_owned_unit(directory_fd)):
                raise ValueError("The Game Bar unit changed during removal.")
            os.unlink(UNIT_NAME, dir_fd=directory_fd)
            os.fsync(directory_fd)
            runner(["daemon-reload"], config_root)
        else:
            if enable:
                validate_wants_link(directory_fd, target)
            write_unit(directory_fd, desired, previous)
            runner(["daemon-reload"], config_root)
            if enable:
                runner(["enable", UNIT_NAME], config_root)
            if start:
                runner(["start", UNIT_NAME], config_root)
    return target


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launcher", help="Absolute installed XBOKS executable/AppImage wrapper (no symlink).")
    parser.add_argument("--config-root", type=Path, default=default_config_root(),
                        help="XDG config root used by your user manager; default XDG_CONFIG_HOME or ~/.config.")
    parser.add_argument("--enable", action="store_true", help="Explicitly enable startup in future graphical sessions.")
    parser.add_argument("--start", action="store_true", help="Explicitly start now; does not imply --enable.")
    parser.add_argument("--uninstall", action="store_true", help="Stop, disable and remove only an exact owned unit.")
    args = parser.parse_args(argv)
    if not args.uninstall and not args.launcher:
        parser.error("--launcher is required for installation")
    try:
        target = install(args.config_root, args.launcher, enable=args.enable, start=args.start, uninstall=args.uninstall)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Game Bar service setup failed: {error}", file=sys.stderr)
        return 1
    print(("Removed: " if args.uninstall else "Installed: ") + str(target))
    if not args.uninstall:
        print(f"Enabled for future graphical sessions: {'yes' if args.enable else 'not requested'}; "
              f"start now: {'requested' if args.start else 'not requested'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
