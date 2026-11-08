#!/usr/bin/env python3
"""Run the raw ABI probe on an isolated bus and an explicitly disposable prefix.

Never installs a module, opens a client, or connects to the desktop session bus.
Requires an already prepared prefix beneath this probes directory and an owner-only
.native1-probe-only marker containing that prefix's canonical absolute path.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat
import subprocess
import sys
import tempfile
import time
from xml.sax.saxutils import escape

import dbus

PROBES = Path(__file__).resolve().parent
NAME = 'org.slaveitgr.Xboks.Experience'
OBJECT = '/org/slaveitgr/Xboks/Experience/Native1'
CONTROL = 'org.slaveitgr.Xboks.Experience.Test1'


def prefix_processes(prefix):
    expected = b'WINEPREFIX=' + os.fsencode(prefix)
    found = []
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if expected in (process / 'environ').read_bytes().split(b'\0'):
                found.append(int(process.name))
        except OSError:
            pass
    return found


def bounded_line(process, seconds):
    ready, _, _ = select.select([process.stdout], [], [], seconds)
    if not ready:
        raise RuntimeError('Private fixture startup deadline exceeded.')
    line = process.stdout.readline()
    if not line:
        raise RuntimeError('Private fixture exited during startup.')
    return line.decode('utf-8').strip()


def stop(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=4)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wine', required=True, type=Path)
    parser.add_argument('--prefix', required=True, type=Path)
    parser.add_argument('--probe', type=Path, default=PROBES / 'gaming-experience-tests.exe')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--mode', choices=['disabled', 'unavailable', 'fixture'], required=True)
    args = parser.parse_args()
    os.umask(0o077)
    prefix = args.prefix.resolve(strict=True)
    marker = prefix / '.native1-probe-only'
    if not prefix.is_relative_to(PROBES) or prefix == PROBES or not marker.is_file():
        raise RuntimeError('Only an explicitly disposable probe prefix is permitted.')
    for path in (prefix, marker):
        info = path.stat()
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise RuntimeError('Disposable prefix and marker must be owner-only.')
    if marker.read_text().strip() != str(prefix) or prefix_processes(prefix):
        raise RuntimeError('Disposable prefix identity mismatch or existing runtime process.')
    wine = args.wine.absolute()
    probe = args.probe.resolve(strict=True)
    wineserver = wine.parent / 'wineserver'
    if not wine.is_file() or not wineserver.is_file() or probe.parent != PROBES:
        raise RuntimeError('Explicit runtime/probe paths are invalid.')
    output = args.output.absolute()
    if not output.is_relative_to(PROBES) or output == PROBES:
        raise RuntimeError('Fixture output must be a new private probes subdirectory.')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    output = output.resolve(strict=True)
    daemon = service = command = None
    control_bus = None
    logs = []
    result = {'mode': args.mode, 'prefix': str(prefix), 'desktopBusUsed': False,
              'shellActionsPerformed': False, 'probeSHA256': hashlib.sha256(probe.read_bytes()).hexdigest(),
              'controlActions': [], 'exitCode': 1}
    bus_directory = tempfile.TemporaryDirectory(prefix='xboks-native1-fixture-')
    socket = Path(bus_directory.name) / 'bus'
    daemon_log = (output / 'bus-private.log').open('wb')
    logs.append(daemon_log)
    service_log = (output / 'fixture-private.log').open('ab')
    logs.append(service_log)
    stderr_log = (output / 'probe-stderr-private.log').open('wb')
    logs.append(stderr_log)
    stdout_log = (output / 'probe-stdout-private.log').open('wb')
    logs.append(stdout_log)
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('WINE', 'UWP_', 'PROTON_', 'STEAM_COMPAT_', 'DBUS_'))}
    for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY'):
        env.pop(key, None)
    env.update(WINEPREFIX=str(prefix), WINEDEBUG='-all,err+all')
    if args.mode != 'disabled':
        env['WINE_UWP_GAMING_EXPERIENCE_BRIDGE'] = '1'

    def start_service(address):
        process = subprocess.Popen([sys.executable, str(PROBES / 'private-native1-fixture.py'),
                                    '--address', address, '--directory', str(output)],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=service_log,
                                   env=env, start_new_session=True)
        if bounded_line(process, 5) != 'FIXTURE_READY':
            stop(process)
            raise RuntimeError('Private Native1 fixture failed readiness.')
        return process

    try:
        config = output / 'bus.conf'
        config.write_text('<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"\n'
                          '"http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">\n'
                          '<busconfig><type>session</type><listen>unix:path=' + escape(str(socket)) + '</listen>'
                          '<auth>EXTERNAL</auth><policy context="default"><allow user="' + str(os.geteuid()) + '"/>'
                          '<allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/>'
                          '</policy></busconfig>\n')
        daemon = subprocess.Popen(['/usr/bin/dbus-daemon', '--nofork', '--print-address=1', '--config-file=' + str(config)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=daemon_log,
                                  env=env, start_new_session=True)
        address = bounded_line(daemon, 5)
        if not address.startswith('unix:path=' + str(socket)):
            raise RuntimeError('Unexpected private bus address.')
        (output / 'private-bus-address.txt').write_text(address + '\n')
        env['DBUS_SESSION_BUS_ADDRESS'] = address
        if args.mode == 'fixture':
            service = start_service(address)
            control_bus = dbus.bus.BusConnection(address)

        def control():
            return dbus.Interface(control_bus.get_object(NAME, OBJECT), CONTROL)

        delay_armed = False

        def action(name):
            nonlocal service, delay_armed
            result['controlActions'].append(name)
            if name == 'force-other-active':
                control().ForceState(True, True, timeout=3)
            elif name == 'emergency-exit':
                if delay_armed:
                    deadline = time.monotonic() + 2
                    while not control().PendingAcknowledgment(timeout=2):
                        if time.monotonic() > deadline:
                            raise RuntimeError('Delayed enter was not pending; race prerequisite absent.')
                        time.sleep(0.02)
                    delay_armed = False
                control().ForceState(False, False, timeout=3)
            elif name == 'deny':
                control().SetFlags(True, False, timeout=3)
            elif name == 'allow':
                control().SetFlags(True, True, timeout=3)
            elif name == 'delay-next-set':
                control().DelayNextSet(dbus.UInt32(600), timeout=3)
                delay_armed = True
            elif name == 'service-restart':
                stop(service)
                service = None
                time.sleep(0.3)
                service = start_service(address)
            elif name == 'service-stop':
                stop(service)
                service = None
            else:
                raise RuntimeError('Unexpected fixture request.')

        command = subprocess.Popen([str(wine), str(probe), args.mode], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=stderr_log, env=env, start_new_session=True)
        deadline = time.monotonic() + 110
        # Binary unbuffered line reading prevents TextIO read-ahead from hiding
        # subsequent handshakes from select(). Probe writes each protocol line atomically.
        buffer = b''
        while True:
            if time.monotonic() > deadline:
                raise RuntimeError('Raw ABI probe exceeded its bounded test deadline.')
            ready, _, _ = select.select([command.stdout], [], [], 0.2)
            if ready:
                chunk = os.read(command.stdout.fileno(), 16384)
                if not chunk:
                    break
                stdout_log.write(chunk)
                stdout_log.flush()
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    line = line.rstrip(b'\r')
                    if line.startswith(b'FIXTURE_REQUEST '):
                        if args.mode != 'fixture':
                            raise RuntimeError('Unexpected request outside fixture mode.')
                        action(line[len(b'FIXTURE_REQUEST '):].decode('ascii'))
                        command.stdin.write(b'OK\n')
                        command.stdin.flush()
                    elif line.startswith(b'GAMING_EXPERIENCE_TESTS '):
                        result['probeSummary'] = line.decode('ascii')
            if command.poll() is not None and not ready:
                # stdout remains readable through EOF, including any final summary.
                continue
        result['exitCode'] = command.wait(timeout=5)
        if 'probeSummary' not in result:
            raise RuntimeError('Probe did not report completed checks.')
    except Exception as error:
        result['error'] = type(error).__name__ + ': ' + str(error)
        result['exitCode'] = 1
    finally:
        if command and command.poll() is None:
            try:
                os.killpg(command.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            stop(command)
        # This prefix was checked idle and is under the private probe-only marker.
        # No global/name-based Wine termination is used.
        result['cleanup'] = []
        for option in ('-k', '-w'):
            try:
                clean = subprocess.run([str(wineserver), option], env=env, capture_output=True, timeout=10)
                result['cleanup'].append({'option': option, 'exitCode': clean.returncode})
            except Exception as error:
                result['cleanup'].append({'option': option, 'error': type(error).__name__})
                result['exitCode'] = 1
        if control_bus:
            control_bus.close()
        stop(service)
        stop(daemon)
        bus_directory.cleanup()
        for stream in logs:
            stream.close()
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    return result['exitCode']


if __name__ == '__main__':
    raise SystemExit(main())
