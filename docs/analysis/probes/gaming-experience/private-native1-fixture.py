#!/usr/bin/env python3
"""Native1 transport fixture. Runs exclusively on a caller-supplied private bus.

This does not emulate GNOME, authorize an original client, change windows, or
establish kernel/user-session policy correctness. Test1 is fixture-only control.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import stat

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

NAME = 'org.slaveitgr.Xboks.Experience'
PATH = '/org/slaveitgr/Xboks/Experience/Native1'
NATIVE = 'org.slaveitgr.Xboks.Experience.Native1'
CONTROL = 'org.slaveitgr.Xboks.Experience.Test1'


class Fixture(dbus.service.Object):
    def __init__(self, bus, output):
        super().__init__(bus, PATH)
        self.bus = bus
        self.output = output
        self.epoch = 10
        self.supported = True
        self.authorized = True
        self.active = False
        self.owner = None
        self.delay_next = 0
        self.pending_ack = False
        self.events = []
        self.daemon = dbus.Interface(bus.get_object('org.freedesktop.DBus', '/org/freedesktop/DBus'),
                                     'org.freedesktop.DBus')
        bus.add_signal_receiver(self.owner_changed, signal_name='NameOwnerChanged',
                                dbus_interface='org.freedesktop.DBus', bus_name='org.freedesktop.DBus')

    def audit(self, method, sender):
        try:
            pid = int(self.daemon.GetConnectionUnixProcessID(sender, timeout=2))
            uid = int(self.daemon.GetConnectionUnixUser(sender, timeout=2))
        except dbus.DBusException:
            pid = uid = None
        self.events.append({'method': method, 'sender': str(sender), 'pid': pid, 'uid': uid,
                            'epoch': self.epoch, 'active': self.active})
        temporary = self.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.events, indent=2) + '\n')
        temporary.replace(self.output)

    def allowed(self, sender):
        return self.supported and self.authorized and (self.owner is None or self.owner == sender)

    def transition(self, active, owner, force_epoch=False):
        changed = self.active != active or self.owner != owner
        self.active, self.owner = bool(active), owner
        if changed or force_epoch:
            self.epoch += 1
            self.StateChanged(dbus.UInt64(self.epoch), dbus.Boolean(self.active))

    def owner_changed(self, name, old, new):
        if old and not new and str(name) == self.owner:
            self.transition(False, None)

    @dbus.service.method(NATIVE, in_signature='', out_signature='utbbbb', sender_keyword='sender')
    def GetState(self, sender=None):
        self.audit('GetState', sender)
        return (dbus.UInt32(1), dbus.UInt64(self.epoch), dbus.Boolean(self.supported),
                dbus.Boolean(self.active), dbus.Boolean(self.allowed(sender)),
                dbus.Boolean(self.owner == sender and self.active))

    @dbus.service.method(NATIVE, in_signature='bt', out_signature='tbb',
                         sender_keyword='sender', async_callbacks=('reply', 'error'))
    def SetMode(self, enabled, expected_epoch, reply, error, sender=None):
        self.audit('SetMode', sender)
        if not self.supported:
            error(dbus.DBusException('Fixture unsupported', name='org.freedesktop.DBus.Error.NotSupported'))
            return
        if not self.authorized:
            error(dbus.DBusException('Fixture denied', name='org.freedesktop.DBus.Error.AccessDenied'))
            return
        if int(expected_epoch) != self.epoch:
            error(dbus.DBusException('Fixture stale epoch', name=NAME + '.Error.StaleEpoch'))
            return
        if self.owner is not None and self.owner != sender:
            error(dbus.DBusException('Fixture owned elsewhere', name=NAME + '.Error.Busy'))
            return
        self.transition(bool(enabled), str(sender) if enabled else None)
        acknowledgment = (dbus.UInt64(self.epoch), dbus.Boolean(self.active),
                          dbus.Boolean(self.owner == sender and self.active))
        delay, self.delay_next = self.delay_next, 0
        if delay:
            self.pending_ack = True
            def finish():
                self.pending_ack = False
                reply(*acknowledgment)  # Deliberately retain the historical ack for race tests.
                return GLib.SOURCE_REMOVE
            GLib.timeout_add(delay, finish)
        else:
            reply(*acknowledgment)

    @dbus.service.signal(NATIVE, signature='tb')
    def StateChanged(self, epoch, active):
        pass

    @dbus.service.method(CONTROL, in_signature='bb', out_signature='')
    def SetFlags(self, supported, authorized):
        self.supported, self.authorized = bool(supported), bool(authorized)
        self.transition(self.active if self.supported else False,
                        self.owner if self.supported else None, force_epoch=True)

    @dbus.service.method(CONTROL, in_signature='bb', out_signature='')
    def ForceState(self, active, other_owner):
        if active and not other_owner:
            raise dbus.DBusException('Test entry must name the fixture as other owner',
                                    name='org.freedesktop.DBus.Error.InvalidArgs')
        self.transition(bool(active), self.bus.get_unique_name() if active else None)

    @dbus.service.method(CONTROL, in_signature='u', out_signature='')
    def DelayNextSet(self, milliseconds):
        if int(milliseconds) > 5000:
            raise dbus.DBusException('Fixture delay exceeds bound', name='org.freedesktop.DBus.Error.InvalidArgs')
        self.delay_next = int(milliseconds)

    @dbus.service.method(CONTROL, in_signature='', out_signature='b')
    def PendingAcknowledgment(self):
        return dbus.Boolean(self.pending_ack)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--address', required=True)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    directory = args.directory.resolve(strict=True)
    # The harness writes this marker when it creates its own bus socket/config.
    marker = directory / 'private-bus-address.txt'
    if not marker.is_file() or marker.read_text().strip() != args.address:
        raise RuntimeError('Fixture requires its harness-owned private bus marker.')
    if not args.address.startswith('unix:path=') or ';' in args.address:
        raise RuntimeError('Fixture refuses a desktop or unrelated bus address.')
    socket = Path(args.address[len('unix:path='):].split(',', 1)[0])
    parent = socket.parent
    info = parent.stat()
    if (socket.name != 'bus' or not parent.name.startswith('xboks-native1-fixture-')
            or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077
            or not stat.S_ISSOCK(socket.stat().st_mode)):
        raise RuntimeError('Fixture requires its owner-only short temporary bus socket.')
    DBusGMainLoop(set_as_default=True)
    bus = dbus.bus.BusConnection(args.address)
    name = dbus.service.BusName(NAME, bus=bus, do_not_queue=True)
    fixture = Fixture(bus, directory / 'fixture-events.json')
    loop = GLib.MainLoop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: loop.quit())
    print('FIXTURE_READY', flush=True)
    try:
        loop.run()
    finally:
        fixture.remove_from_connection()
        bus.release_name(NAME)
        bus.close()
        del name


if __name__ == '__main__':
    main()
