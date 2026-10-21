#!/usr/bin/env python3
"""Private JSON-line BTN_MODE listener for existing readable Linux gamepads.

Only opens capability-verified joystick/gamepad event nodes, read-only. No
EVIOCGRAB, key injection, device writes, rumble, keyboard/mouse hooks, privilege
changes, device names or raw input leave this helper. stdin EOF ends ownership.
Kernel contracts: input.h EVIOCGBIT/EVIOCGKEY and input/event-codes.html.
"""
from __future__ import annotations

from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import struct
import sys
import time

EV_SYN, EV_KEY, EV_REL, EV_ABS = 0, 1, 2, 3
SYN_REPORT, SYN_DROPPED = 0, 3
BTN_JOYSTICK, BTN_GAMEPAD, BTN_MODE = 0x120, 0x130, 0x13C
MAX_DEVICES, MAX_ENTRIES, SCAN_SECONDS = 16, 256, 2.0
EVENT = struct.Struct("@llHHi")
KEY_BYTES = 96  # Linux KEY_CNT=0x300, not a keyboard event subscription.
ALLOWED_KEYS = set(range(0x120, 0x140)) | set(range(0x220, 0x224)) | set(range(0x2C0, 0x2E8)) | {167}
# KEY_RECORD is the Xbox Share button on newer xpad devices. It is discarded,
# like every other non-Guide event. Full keyboard/mouse/hybrid nodes are refused.


def supported_architecture():
    return sys.byteorder == "little" and struct.calcsize("L") == 8 and EVENT.size == 24


def bitmap(text: str, word_bits=64) -> int:
    words = text.strip().split()
    if not words or len(words) > 16 or word_bits not in (32, 64):
        raise ValueError("invalid bitmap")
    result = 0
    for word in words:
        if not re.fullmatch(r"[0-9a-fA-F]{1," + str(word_bits // 4) + r"}", word):
            raise ValueError("invalid bitmap")
        result = (result << word_bits) | int(word, 16)
    return result


def is_gamepad(keys: int, absolute: int, relative: int, events: int) -> bool:
    if not (events & (1 << EV_KEY) and events & (1 << EV_ABS)) or relative or events & (1 << EV_REL):
        return False
    if not keys & (1 << BTN_MODE) or not keys & ((1 << BTN_GAMEPAD) | (1 << BTN_JOYSTICK)):
        return False
    if absolute & 3 != 3:  # ABS_X and ABS_Y; no keyboard-only Guide interfaces.
        return False
    return keys != 0 and keys >> (KEY_BYTES * 8) == 0 and all(not (keys & (1 << code)) or code in ALLOWED_KEYS for code in range(KEY_BYTES * 8))


def read_small(path: Path, maximum=4096) -> str:
    with path.open("rb") as stream:
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError("oversized capability")
    return value.decode("ascii", errors="strict")


def candidate(entry: Path) -> bool:
    if not re.fullmatch(r"event[0-9]{1,5}", entry.name):
        return False
    cap = entry / "device" / "capabilities"
    return is_gamepad(bitmap(read_small(cap / "key")), bitmap(read_small(cap / "abs")),
                      bitmap(read_small(cap / "rel")), bitmap(read_small(cap / "ev")))


def read_ioctl(fd: int, number: int, size: int) -> bytes:
    # asm-generic _IOC(_IOC_READ, 'E', number, size); supported little-endian
    # 64-bit Linux ABIs only. Every request is a kernel-to-user read.
    request = (2 << 30) | (size << 16) | (ord("E") << 8) | number
    buffer = bytearray(size)
    fcntl.ioctl(fd, request, buffer, True)
    return bytes(buffer)


def current_mode(fd: int) -> bool:
    return bool(int.from_bytes(read_ioctl(fd, 0x18, KEY_BYTES), "little") & (1 << BTN_MODE))


class ModeDecoder:
    """Discard all non-Guide input; rising edge after known release only."""
    def __init__(self, held: bool, refresh, emit, clock=time.monotonic):
        self.held, self.armed, self.refresh, self.emit, self.clock = held, not held, refresh, emit, clock
        self.partial, self.dropped, self.last_press = b"", False, -float("inf")

    def feed(self, data: bytes):
        self.partial += data
        if len(self.partial) > EVENT.size * 256:
            raise ValueError("oversized input batch")
        offset = 0
        while len(self.partial) - offset >= EVENT.size:
            _, _, kind, code, value = EVENT.unpack_from(self.partial, offset)
            offset += EVENT.size
            if kind == EV_SYN and code == SYN_DROPPED:
                self.dropped = True
                continue
            if self.dropped:
                if kind == EV_SYN and code == SYN_REPORT:
                    self.held = bool(self.refresh())
                    self.armed, self.dropped = not self.held, False
                continue
            if kind != EV_KEY or code != BTN_MODE:
                continue
            if value == 0:
                self.held, self.armed = False, True
            elif value == 1:
                previous = self.held
                self.held = True
                now = self.clock()
                if not previous and self.armed and now - self.last_press >= 0.35:
                    self.last_press = now
                    self.emit()
            # value=2 is auto-repeat, never an activation.
        self.partial = self.partial[offset:]


@dataclass
class Device:
    fd: int
    decoder: ModeDecoder
    identity: tuple[int, int]


def open_device(entry: Path, dev_root: Path, emit) -> Device:
    expected = read_small(entry / "dev", 64).strip()
    if not re.fullmatch(r"13:[0-9]{1,8}", expected):
        raise ValueError("not an input event node")
    identity = tuple(int(value) for value in expected.split(":"))
    fd = os.open(dev_root / entry.name, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISCHR(st.st_mode) or (os.major(st.st_rdev), os.minor(st.st_rdev)) != identity:
            raise ValueError("device identity changed")
        keys = int.from_bytes(read_ioctl(fd, 0x20 + EV_KEY, KEY_BYTES), "little")
        absolute = int.from_bytes(read_ioctl(fd, 0x20 + EV_ABS, 8), "little")
        relative = int.from_bytes(read_ioctl(fd, 0x20 + EV_REL, 8), "little")
        events = int.from_bytes(read_ioctl(fd, 0x20, 4), "little")
        if not is_gamepad(keys, absolute, relative, events):
            raise ValueError("not a joystick-only gamepad")
        return Device(fd, ModeDecoder(current_mode(fd), lambda: current_mode(fd), emit), identity)
    except BaseException:
        os.close(fd)
        raise


class Monitor:
    def __init__(self, emit, selector=None, sys_root=Path("/sys/class/input"), dev_root=Path("/dev/input"), opener=open_device):
        self.emit, self.selector = emit, selector or selectors.DefaultSelector()
        self.sys_root, self.dev_root, self.opener = sys_root, dev_root, opener
        self.devices: dict[str, Device] = {}
        self.paused, self.previous_status = True, None

    def status(self, reason=None):
        count = len(self.devices)
        value = {"schema": 1, "event": "status", "status": "listening" if count else "unavailable", "devices": count}
        if reason and not count:
            value["reason"] = reason
        if value != self.previous_status:
            self.previous_status = value
            self.emit(value)

    def close_device(self, name):
        device = self.devices.pop(name, None)
        if device:
            try:
                self.selector.unregister(device.fd)
            except (KeyError, ValueError):
                pass
            os.close(device.fd)

    def pause(self):
        self.paused = True
        for name in list(self.devices):
            self.close_device(name)
        self.status("session-blocked")

    def resume(self):
        self.paused = False
        self.scan()

    def scan(self):
        if self.paused:
            return
        if not supported_architecture():
            self.status("unsupported-architecture")
            return
        try:
            entries = []
            with os.scandir(self.sys_root) as stream:
                for index, entry in enumerate(stream):
                    if index >= MAX_ENTRIES:
                        break
                    if re.fullmatch(r"event[0-9]{1,5}", entry.name):
                        entries.append(self.sys_root / entry.name)
        except OSError:
            for name in list(self.devices):
                self.close_device(name)
            self.status("scan-unavailable")
            return
        names = {entry.name for entry in entries}
        for name, device in list(self.devices.items()):
            try:
                current = read_small(self.sys_root / name / "dev", 64).strip()
                if name not in names or current != ":".join(str(value) for value in device.identity):
                    self.close_device(name)
            except (OSError, ValueError):
                self.close_device(name)
        denied = False
        for entry in sorted(entries, key=lambda value: int(value.name[5:])):
            if entry.name in self.devices or len(self.devices) >= MAX_DEVICES:
                continue
            try:
                if not candidate(entry):
                    continue
                device = self.opener(entry, self.dev_root, lambda: self.emit({"schema": 1, "event": "guide"}))
                try:
                    self.selector.register(device.fd, selectors.EVENT_READ, entry.name)
                except BaseException:
                    os.close(device.fd)
                    raise
                self.devices[entry.name] = device
            except PermissionError:
                denied = True
            except (OSError, ValueError):
                continue
        self.status("permission-denied" if denied else "no-controller")

    def read_device(self, name):
        device = self.devices.get(name)
        if not device:
            return
        try:
            data = os.read(device.fd, EVENT.size * 64)
            if not data:
                self.close_device(name)
            else:
                device.decoder.feed(data)
        except BlockingIOError:
            return
        except (OSError, ValueError):
            self.close_device(name)
        self.status("device-error" if not self.devices else None)

    def close(self):
        for name in list(self.devices):
            self.close_device(name)
        self.selector.close()


def main():
    def emit(value):
        print(json.dumps(value, separators=(",", ":")), flush=True)
    monitor = Monitor(emit)
    stopped, partial, next_scan = False, b"", 0.0
    def stop(*_):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        os.set_blocking(sys.stdin.fileno(), False)
        monitor.selector.register(sys.stdin.fileno(), selectors.EVENT_READ, None)
        # The parent explicitly resumes after wiring its lock/lifetime guards.
        monitor.status("session-blocked")
        while not stopped:
            now = time.monotonic()
            if now >= next_scan:
                monitor.scan()
                next_scan = now + SCAN_SECONDS
            for key, _ in monitor.selector.select(min(0.5, max(0, next_scan - time.monotonic()))):
                if key.data is not None:
                    monitor.read_device(key.data)
                    continue
                data = os.read(sys.stdin.fileno(), 1024)
                if not data:
                    return 0
                partial += data
                if len(partial) > 4096:
                    return 1
                while b"\n" in partial:
                    line, partial = partial.split(b"\n", 1)
                    try:
                        command = json.loads(line)
                    except (ValueError, UnicodeError):
                        return 1
                    if command == {"command": "pause"}:
                        monitor.pause()
                    elif command == {"command": "resume"}:
                        monitor.resume()
                    else:
                        return 1
        return 0
    except BrokenPipeError:
        return 0
    finally:
        monitor.close()


if __name__ == "__main__":
    raise SystemExit(main())
