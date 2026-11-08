#!/usr/bin/env python3
"""Exercise only the private D-Bus fixture; never launches Wine or a desktop app."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import dbus

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('private_harness', BASE / 'run-private-fixture.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def main():
    os.umask(0o077)
    output = Path(tempfile.mkdtemp(prefix='fixture-smoke-', dir=BASE))
    bus_directory = tempfile.TemporaryDirectory(prefix='xboks-native1-fixture-')
    socket = Path(bus_directory.name) / 'bus'
    config = output / 'bus.conf'
    config.write_text('<busconfig><type>session</type><listen>unix:path=' + str(socket) + '</listen>'
                      '<auth>EXTERNAL</auth><policy context="default"><allow user="' + str(os.geteuid()) + '"/>'
                      '<allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/>'
                      '</policy></busconfig>')
    daemon = service = first = second = controller = None
    checks = 0
    def check(value):
        nonlocal checks
        checks += 1
        if not value:
            raise AssertionError('Fixture smoke check ' + str(checks))
    def interface(bus, name):
        return dbus.Interface(bus.get_object(harness.NAME, harness.OBJECT), name)
    with (output / 'fixture-private.log').open('wb') as log:
        try:
            daemon = subprocess.Popen(['/usr/bin/dbus-daemon', '--nofork', '--print-address=1', '--config-file=' + str(config)],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log)
            address = harness.bounded_line(daemon, 5)
            (output / 'private-bus-address.txt').write_text(address + '\n')
            service = subprocess.Popen([sys.executable, str(BASE / 'private-native1-fixture.py'), '--address', address,
                                        '--directory', str(output)], stdout=subprocess.PIPE, stderr=log)
            check(harness.bounded_line(service, 5) == 'FIXTURE_READY')
            controller = dbus.bus.BusConnection(address)
            first = dbus.bus.BusConnection(address)
            second = dbus.bus.BusConnection(address)
            native = interface(first, 'org.slaveitgr.Xboks.Experience.Native1')
            other = interface(second, 'org.slaveitgr.Xboks.Experience.Native1')
            control = interface(controller, harness.CONTROL)
            state = native.GetState(timeout=2)
            check(tuple(map(int, state)) == (1, 10, 1, 0, 1, 0))
            check(tuple(map(int, native.SetMode(True, state[1], timeout=2))) == (11, 1, 1))
            state = other.GetState(timeout=2)
            check(tuple(map(int, state)) == (1, 11, 1, 1, 0, 0))
            for method, arguments, suffix in [(other.SetMode, (False, state[1]), '.Busy'),
                                               (native.SetMode, (False, dbus.UInt64(10)), '.StaleEpoch')]:
                try:
                    method(*arguments, timeout=2)
                except dbus.DBusException as error:
                    check(error.get_dbus_name().endswith(suffix))
                else:
                    check(False)
            first.close()
            first = None
            until = time.monotonic() + 3
            while other.GetState(timeout=2)[3] and time.monotonic() < until:
                time.sleep(0.03)
            state = other.GetState(timeout=2)
            check(not state[3] and state[4])
            control.SetFlags(True, False, timeout=2)
            check(not other.GetState(timeout=2)[4])
            try:
                other.SetMode(True, other.GetState(timeout=2)[1], timeout=2)
            except dbus.DBusException as error:
                check(error.get_dbus_name() == 'org.freedesktop.DBus.Error.AccessDenied')
            else:
                check(False)
            control.SetFlags(False, False, timeout=2)
            state = other.GetState(timeout=2)
            check(not state[2] and not state[3] and not state[4] and not state[5])
            result = {'checks': checks, 'failures': 0, 'wineExecuted': False,
                      'desktopBusUsed': False, 'shellActionsPerformed': False}
            (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps({'directory': str(output), **result}))
        finally:
            for connection in (first, second, controller):
                if connection:
                    connection.close()
            harness.stop(service)
            harness.stop(daemon)
            bus_directory.cleanup()


if __name__ == '__main__':
    main()
