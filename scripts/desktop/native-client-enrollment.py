"""Enroll an observed original Xbox process for the optional GNOME bridge.

The record grants no mode by itself. Shell independently validates the process,
original PE identity and focused window before accepting a mode transition.
"""
import hashlib
import json
import os
from pathlib import Path
import posixpath
import stat
import threading

CLIENT_SHA256 = 'dc50e62227838178c6f8b1e42463cd2b4a7f4b4f55dfc4b0e672d71a8fed0d89'
DESKTOP_ID = 'original-xbox-ce-wineuwp.desktop'


def private_directory(path):
    path = Path(path)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Native enrollment requires an owner-only directory.')
    return path


def windows_z_path(value):
    value = value.decode('utf-8').replace('\\', '/')
    if not value.lower().startswith('z:/'):
        return None
    return Path(posixpath.normpath('/' + value[3:].lstrip('/'))).resolve()


def process_identity(pid, prefix, client, loader, minimum_start, proc_root=Path('/proc')):
    process = Path(proc_root) / str(pid)
    expected = b'WINEPREFIX=' + os.fsencode(prefix)
    def start():
        data = (process / 'stat').read_text()
        if len(data) > 8192:
            raise RuntimeError('Unexpected process stat size.')
        fields = data.rsplit(')', 1)[1].split()
        if fields[0] == 'Z' or not fields[19].isdigit():
            raise RuntimeError('Native process is not live.')
        return fields[19]
    first = start()
    if int(first) < minimum_start or process.stat().st_uid != os.getuid():
        return None
    if (process / 'exe').resolve(strict=True) != loader:
        return None
    command = (process / 'cmdline').read_bytes()
    if len(command) > 65536 or windows_z_path(command.split(b'\0')[0]) != client:
        return None
    environment = (process / 'environ').read_bytes()
    if len(environment) > 1048576 or expected not in environment.split(b'\0'):
        return None
    if start() != first or (process / 'exe').resolve(strict=True) != loader:
        return None
    return {'pid': int(pid), 'startTime': first, 'executable': str(loader)}


class NativeClientEnrollment:
    def __init__(self, prefix, client, runtime, runtime_directory, minimum_start,
                 expected_sha256=CLIENT_SHA256, proc_root=Path('/proc')):
        self.prefix = Path(prefix).resolve(strict=True)
        self.client = Path(client).resolve(strict=True)
        self.loader = (Path(runtime) / 'lib/wine/x86_64-unix/wine-preloader').resolve(strict=True)
        if hashlib.sha256(self.client.read_bytes()).hexdigest() != expected_sha256:
            raise RuntimeError('Original CE identity differs from the verified client.')
        if (self.prefix / 'dosdevices/z:').resolve(strict=True) != Path('/'):
            raise RuntimeError('Native enrollment requires the verified private-prefix Z: mapping.')
        root = private_directory(runtime_directory)
        self.directory = private_directory(private_directory(root / 'xboks') / 'original-clients')
        self.minimum_start = minimum_start
        self.sha256 = expected_sha256
        self.proc_root = proc_root
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.watch, daemon=True)
        self.identity = None
        self.record = None
        self.payload = None
        self.error = None

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise RuntimeError('Native enrollment worker did not stop.')
        self.remove()

    def identify(self, pid):
        return process_identity(pid, self.prefix, self.client, self.loader,
                                self.minimum_start, self.proc_root)

    def publish(self, identity):
        data = dict(identity, schema=1, pePath=str(self.client), peSHA256=self.sha256,
                    desktopId=DESKTOP_ID)
        self.payload = (json.dumps(data, sort_keys=True) + '\n').encode()
        destination = self.directory / (str(identity['pid']) + '.json')
        temporary = self.directory / ('.' + str(identity['pid']) + '-' + str(os.getpid()) + '.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(self.payload)
                stream.flush()
            if self.identify(identity['pid']) != identity:
                raise RuntimeError('Native process identity changed before enrollment.')
            if destination.exists() or destination.is_symlink():
                raise RuntimeError('A native enrollment already exists for this process.')
            # A hard-link publication does not replace an existing record.
            os.link(temporary, destination, follow_symlinks=False)
            self.record = destination
        finally:
            temporary.unlink(missing_ok=True)

    def remove(self):
        if self.record is None:
            return
        try:
            info = self.record.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and self.record.read_bytes() == self.payload:
                self.record.unlink()
        except FileNotFoundError:
            pass
        self.record = None

    def watch(self):
        try:
            while not self.stop_event.wait(0.2):
                if self.identity is not None:
                    try:
                        current = self.identify(self.identity['pid'])
                    except (OSError, ValueError, RuntimeError, UnicodeError):
                        current = None
                    if current != self.identity:
                        self.remove()
                        return
                    continue
                found = []
                for process in Path(self.proc_root).iterdir():
                    if not process.name.isdigit():
                        continue
                    try:
                        # Reject unrelated processes before reading environment data.
                        executable = (process / 'cmdline').read_bytes().split(b'\0')[0]
                        if not executable.replace(b'\\', b'/').lower().endswith(b'/xboxpcappce.exe'):
                            continue
                        identity = self.identify(int(process.name))
                        if identity:
                            found.append(identity)
                    except (OSError, ValueError, RuntimeError, UnicodeError):
                        continue
                if len(found) > 1:
                    raise RuntimeError('More than one original client appeared in the candidate prefix.')
                if found:
                    self.identity = found[0]
                    self.publish(self.identity)
        except Exception as error:
            self.error = type(error).__name__
            self.remove()
