#!/usr/bin/env python3
"""Synthetic event bytes, pipes and temporary sysfs only; never open host input."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True  # Keep generated pyc files out of packaged desktop helpers.
HELPER = Path(__file__).resolve().parents[2] / "assets/desktop/gamebar-controller.py"
SPEC = importlib.util.spec_from_file_location("controller_helper", HELPER)
controller = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = controller
SPEC.loader.exec_module(controller)
KEYS = (1 << controller.BTN_MODE) | (1 << controller.BTN_GAMEPAD)
EVENTS = (1 << controller.EV_KEY) | (1 << controller.EV_ABS)


def event(kind, code, value):
    return controller.EVENT.pack(0, 0, kind, code, value)


def mode(value):
    return event(controller.EV_KEY, controller.BTN_MODE, value)


def sys_bitmap(value):
    words = []
    while value:
        words.append(format(value & ((1 << 64) - 1), "x"))
        value >>= 64
    return " ".join(reversed(words)) or "0"


class DecoderTest(unittest.TestCase):
    def setUp(self):
        self.events, self.now = [], 1.0
        self.decoder = controller.ModeDecoder(False, lambda: False, lambda: self.events.append("guide"), lambda: self.now)

    def test_only_released_to_pressed_guide_transition_emits(self):
        self.decoder.feed(mode(1) + mode(1) + mode(2))
        self.assertEqual(self.events, ["guide"])
        self.now += 1
        self.decoder.feed(mode(0) + mode(1))
        self.assertEqual(self.events, ["guide", "guide"])

    def test_initially_held_button_must_be_released(self):
        decoder = controller.ModeDecoder(True, lambda: True, lambda: self.events.append("guide"), lambda: self.now)
        decoder.feed(mode(1) + mode(2))
        self.assertEqual(self.events, [])
        decoder.feed(mode(0) + mode(1))
        self.assertEqual(self.events, ["guide"])

    def test_repeat_invalid_values_and_other_controls_are_discarded(self):
        self.decoder.feed(mode(2) + mode(-1) + mode(3) + event(controller.EV_KEY, 30, 1) +
                          event(controller.EV_KEY, controller.BTN_GAMEPAD, 1) + event(controller.EV_ABS, 0, 200))
        self.assertEqual(self.events, [])
        self.decoder.feed(mode(1))
        self.assertEqual(self.events, ["guide"])

    def test_contact_bounce_is_debounced(self):
        self.decoder.feed(mode(1) + mode(0))
        self.now += 0.1
        self.decoder.feed(mode(1))
        self.assertEqual(self.events, ["guide"])

    def test_fragmented_binary_events_preserve_alignment(self):
        data = mode(1)
        self.decoder.feed(data[:7])
        self.assertEqual(self.events, [])
        self.decoder.feed(data[7:])
        self.assertEqual(self.events, ["guide"])
        self.assertEqual(self.decoder.partial, b"")

    def test_dropped_sync_requires_current_state_then_release(self):
        refresh = []
        self.decoder.refresh = lambda: (refresh.append(True) or True)
        self.decoder.feed(event(controller.EV_SYN, controller.SYN_DROPPED, 0) + mode(1) + mode(0))
        self.assertEqual(self.events, [])
        self.decoder.feed(event(controller.EV_SYN, controller.SYN_REPORT, 0) + mode(1))
        self.assertEqual(refresh, [True])
        self.assertEqual(self.events, [])
        self.decoder.feed(mode(0) + mode(1))
        self.assertEqual(self.events, ["guide"])

    def test_input_batch_is_bounded(self):
        with self.assertRaisesRegex(ValueError, "oversized"):
            self.decoder.feed(b"x" * (controller.EVENT.size * 256 + 1))


class CapabilityTest(unittest.TestCase):
    def test_real_xpad_sysfs_bitmap_word_order(self):
        # Read-only observed capabilities, without name/serial or input events.
        keys = controller.bitmap("7cdb000000000000 0 0 0 0")
        self.assertTrue(keys & (1 << controller.BTN_MODE))
        self.assertTrue(controller.is_gamepad(keys, controller.bitmap("3003f"), 0, EVENTS))
        self.assertEqual(controller.bitmap("1 0", 32), 1 << 32)

    def test_joystick_and_gamepad_require_guide_and_xy_axes(self):
        self.assertTrue(controller.is_gamepad(KEYS, 3, 0, EVENTS))
        self.assertTrue(controller.is_gamepad((1 << controller.BTN_JOYSTICK) | (1 << controller.BTN_MODE), 3, 0, EVENTS))
        self.assertFalse(controller.is_gamepad(1 << controller.BTN_GAMEPAD, 3, 0, EVENTS))
        self.assertFalse(controller.is_gamepad(KEYS, 1, 0, EVENTS))
        self.assertFalse(controller.is_gamepad(KEYS, 3, 0, 1 << controller.EV_KEY))

    def test_keyboard_mouse_and_hybrid_nodes_are_refused(self):
        for keys, absolute, relative, events in [
            (KEYS | (1 << 30), 3, 0, EVENTS), (KEYS | (1 << 0x110), 3, 0, EVENTS),
            (KEYS, 3, 1, EVENTS), (KEYS, 3, 0, EVENTS | (1 << controller.EV_REL)),
            ((1 << 30) | (1 << 28), 3, 0, EVENTS),
        ]:
            with self.subTest(keys=keys, relative=relative):
                self.assertFalse(controller.is_gamepad(keys, absolute, relative, events))

    def test_xbox_share_capability_is_allowed_but_arbitrary_keys_are_not(self):
        self.assertTrue(controller.is_gamepad(KEYS | (1 << 167), 3, 0, EVENTS))
        self.assertFalse(controller.is_gamepad(KEYS | (1 << 139), 3, 0, EVENTS))
        self.assertFalse(controller.is_gamepad(KEYS | (1 << 900), 3, 0, EVENTS))

    def test_malformed_and_oversized_bitmaps_are_rejected(self):
        for text in ["", "-1", "0x10", "g123", "a" * 17, " ".join(["0"] * 17)]:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    controller.bitmap(text)

    def test_read_ioctl_uses_only_read_direction_and_bounded_bit_buffer(self):
        with patch.object(controller.fcntl, "ioctl") as ioctl:
            data = controller.read_ioctl(99, 0x18, controller.KEY_BYTES)
            self.assertEqual(len(data), 96)
            _, number, buffer, mutate = ioctl.call_args.args
            self.assertEqual(number >> 30, 2)
            self.assertEqual((number >> 8) & 255, ord("E"))
            self.assertEqual(number & 255, 0x18)
            self.assertTrue(mutate)
            self.assertEqual(len(buffer), 96)


class NavigationTest(unittest.TestCase):
    def setUp(self):
        self.actions, self.now, self.keys = [], 1.0, 0
        self.axes = {0: (0, -32768, 32767, 128), 1: (0, -32768, 32767, 128),
                     16: (0, -1, 1, 0), 17: (0, -1, 1, 0)}
        self.snapshots = 0
        def snapshot():
            self.snapshots += 1
            return self.keys, self.axes.copy()
        self.nav = controller.NavigationDecoder(snapshot, self.actions.append, lambda: self.now)

    def frame(self, *values):
        for kind, code, value in values:
            self.nav.feed(kind, code, value)
        self.nav.feed(controller.EV_SYN, controller.SYN_REPORT, 0)

    def key(self, code, value):
        self.frame((controller.EV_KEY, code, value))

    def test_default_background_scope_emits_no_navigation_and_reads_no_snapshot(self):
        self.key(0x130, 1)
        self.frame((controller.EV_ABS, 0, -32768))
        self.nav.tick()
        self.assertEqual(self.actions, [])
        self.assertEqual(self.snapshots, 0)

    def test_only_fixed_buttons_and_switcher_only_x_are_exposed(self):
        self.nav.set_surface("guide")
        for code in [0x130, 0x131, 0x136, 0x137, 0x133, 30, 0x13C]:
            self.key(code, 1)
        self.assertEqual(self.actions, ["accept", "back", "previous", "next"])
        self.nav.set_surface("switcher")
        self.key(0x133, 1)
        self.assertEqual(self.actions[-1], "close-window")

    def test_held_buttons_require_release_and_repeats_never_accept(self):
        self.keys = 1 << 0x130
        self.nav.set_surface("switcher")
        self.key(0x130, 1)
        self.key(0x130, 2)
        self.assertEqual(self.actions, [])
        self.key(0x130, 0)
        self.key(0x130, 1)
        self.key(0x130, 1)
        self.assertEqual(self.actions, ["accept"])

    def test_left_stick_deadzone_hysteresis_and_neutral_release(self):
        self.nav.set_surface("guide")
        self.frame((controller.EV_ABS, 0, 15000))  # below enter threshold
        self.assertEqual(self.actions, [])
        self.frame((controller.EV_ABS, 0, 23000))
        self.assertEqual(self.actions, ["right"])
        self.frame((controller.EV_ABS, 0, 14000))  # still held above exit threshold
        self.assertEqual(self.actions, ["right"])
        self.frame((controller.EV_ABS, 0, 0))
        self.assertIsNone(self.nav.direction)
        self.frame((controller.EV_ABS, 1, -30000))
        self.assertEqual(self.actions[-1], "up")

    def test_initially_held_axis_requires_neutral_after_new_scope(self):
        self.axes[0] = (32767, -32768, 32767, 0)
        self.nav.set_surface("switcher")
        self.frame((controller.EV_ABS, 0, 32767))
        self.assertEqual(self.actions, [])
        self.frame((controller.EV_ABS, 0, 0))
        self.frame((controller.EV_ABS, 0, 32767))
        self.assertEqual(self.actions, ["right"])

    def test_stick_jump_across_center_stops_old_direction_before_opposite_threshold(self):
        self.nav.set_surface("guide")
        self.frame((controller.EV_ABS, 0, -30000))
        self.frame((controller.EV_ABS, 0, 14000))
        self.assertIsNone(self.nav.direction)
        self.now += 1
        self.nav.tick()
        self.assertEqual(self.actions, ["left"])
        self.frame((controller.EV_ABS, 0, 24000))
        self.assertEqual(self.actions, ["left", "right"])

    def test_hat_and_dpad_buttons_emit_once_per_sync_and_do_not_double_stick(self):
        self.nav.set_surface("guide")
        self.frame((controller.EV_ABS, 16, -1), (controller.EV_ABS, 0, -30000), (controller.EV_KEY, 0x222, 1))
        self.assertEqual(self.actions, ["left"])
        self.frame((controller.EV_ABS, 16, 0), (controller.EV_ABS, 0, 0), (controller.EV_KEY, 0x222, 0))
        self.key(0x221, 1)
        self.assertEqual(self.actions[-1], "down")

    def test_direction_repeat_has_delay_and_no_catchup_burst(self):
        self.nav.set_surface("guide")
        self.key(0x223, 1)
        self.now += 0.39
        self.nav.tick()
        self.assertEqual(self.actions, ["right"])
        self.now += 0.02
        self.nav.tick()
        self.assertEqual(self.actions, ["right", "right"])
        self.now += 30
        self.nav.tick()
        self.nav.tick()
        self.assertEqual(self.actions, ["right", "right", "right"])
        self.key(0x223, 0)
        self.now += 1
        self.nav.tick()
        self.assertEqual(len(self.actions), 3)

    def test_scope_none_and_drop_stop_repeat_and_actions(self):
        self.nav.set_surface("guide")
        self.key(0x223, 1)
        self.nav.drop()
        self.now += 1
        self.nav.tick()
        self.key(0x130, 1)
        self.assertEqual(self.actions, ["right"])
        self.nav.resync()
        self.nav.set_surface("none")
        self.key(0x130, 1)
        self.assertEqual(self.actions, ["right"])

    def test_syn_dropped_resync_seeds_held_accept_before_rearming(self):
        self.nav.set_surface("switcher")
        decoder = controller.ModeDecoder(False, lambda: False, lambda: None, navigation=self.nav)
        decoder.feed(event(controller.EV_SYN, controller.SYN_DROPPED, 0) + event(controller.EV_KEY, 0x130, 1))
        self.keys = 1 << 0x130
        decoder.feed(event(controller.EV_SYN, controller.SYN_REPORT, 0) + event(controller.EV_KEY, 0x130, 1))
        self.assertEqual(self.actions, [])
        decoder.feed(event(controller.EV_KEY, 0x130, 0) + event(controller.EV_KEY, 0x130, 1))
        self.assertEqual(self.actions, ["accept"])

    def test_kernel_axis_snapshot_uses_only_read_ioctl_and_selected_axes(self):
        calls = []
        def ioctl(fd, number, size):
            calls.append((number, size))
            return (0).to_bytes(size, "little") if number == 0x18 else controller.ABS_INFO.pack(0, -32768, 32767, 0, 128, 0)
        with patch.object(controller, "read_ioctl", side_effect=ioctl):
            keys, axes = controller.navigation_snapshot(99, 3)
        self.assertEqual(keys, 0)
        self.assertEqual(set(axes), {0, 1})
        self.assertEqual(calls, [(0x18, 96), (0x40, 24), (0x41, 24)])


class Selector:
    def __init__(self):
        self.fds, self.closed = {}, False
    def register(self, fd, flags, name):
        self.fds[fd] = name
    def unregister(self, fd):
        self.fds.pop(fd)
    def close(self):
        self.closed = True


class MonitorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.messages, self.opens, self.writers = [], [], []
        self.selector = Selector()
        def opener(entry, dev_root, emit):
            self.opens.append(entry.name)
            read, write = os.pipe()
            os.set_blocking(read, False)
            self.writers.append(write)
            return controller.Device(read, controller.ModeDecoder(False, lambda: False, emit), (13, int(entry.name[5:]) + 64))
        self.monitor = controller.Monitor(self.messages.append, self.selector, self.root, self.root / "fake-dev", opener)
        self.addCleanup(self.cleanup_monitor)

    def cleanup_monitor(self):
        self.monitor.close()
        for writer in self.writers:
            try:
                os.close(writer)
            except OSError:
                pass

    def entry(self, number, keys=KEYS, relative=0):
        entry = self.root / f"event{number}"
        caps = entry / "device/capabilities"
        caps.mkdir(parents=True)
        for name, bits in [("key", keys), ("abs", 3), ("rel", relative), ("ev", EVENTS)]:
            (caps / name).write_text(sys_bitmap(bits))
        (entry / "dev").write_text(f"13:{number + 64}\n")
        return entry

    def test_filters_sysfs_before_opening_only_gamepad_nodes(self):
        self.entry(0, (1 << 30) | (1 << 28))
        self.entry(1)
        self.entry(2, KEYS | (1 << 30))
        self.entry(3, relative=1)
        self.monitor.resume()
        self.assertEqual(self.opens, ["event1"])
        self.assertEqual(self.messages[-1], {"schema": 1, "event": "status", "status": "listening", "devices": 1})

    def test_hotplug_and_disconnect_close_owned_descriptors(self):
        entry = self.entry(1)
        self.monitor.resume()
        fd = self.monitor.devices["event1"].fd
        self.monitor.scan()
        self.assertEqual(self.opens, ["event1"])
        shutil.rmtree(entry)
        self.monitor.scan()
        with self.assertRaises(OSError):
            os.fstat(fd)
        self.assertEqual(self.messages[-1]["reason"], "no-controller")
        self.entry(2)
        self.monitor.scan()
        self.assertEqual(self.opens, ["event1", "event2"])

    def test_pause_closes_all_nodes_and_resume_reopens_cleanly(self):
        self.entry(1)
        self.monitor.resume()
        fd = self.monitor.devices["event1"].fd
        self.monitor.pause()
        with self.assertRaises(OSError):
            os.fstat(fd)
        self.assertEqual(self.messages[-1]["reason"], "session-blocked")
        self.monitor.scan()
        self.assertEqual(len(self.opens), 1)
        self.monitor.resume()
        self.assertEqual(len(self.opens), 2)

    def test_permission_denial_is_fixed_code_without_names_or_raw_errors(self):
        self.entry(1)
        def denied(*_):
            raise PermissionError("private raw device identity")
        self.monitor.opener = denied
        self.monitor.resume()
        self.assertEqual(self.messages[-1], {"schema": 1, "event": "status", "status": "unavailable", "devices": 0, "reason": "permission-denied"})
        self.assertNotIn("private", json.dumps(self.messages))

    def test_maximum_device_count_is_enforced(self):
        for number in range(20):
            self.entry(number)
        self.monitor.resume()
        self.assertEqual(len(self.opens), controller.MAX_DEVICES)
        self.assertEqual(len(self.selector.fds), controller.MAX_DEVICES)

    def test_synthetic_pipe_input_exposes_only_guide_event(self):
        self.entry(1)
        self.monitor.resume()
        os.write(self.writers[0], event(controller.EV_KEY, 30, 1) + event(controller.EV_ABS, 0, 123) + mode(1))
        self.monitor.read_device("event1")
        self.assertEqual(self.messages[-1], {"schema": 1, "event": "guide"})
        self.assertEqual(set(self.messages[-1]), {"schema", "event"})

    def test_eof_closes_device_and_marks_unavailable(self):
        self.entry(1)
        self.monitor.resume()
        os.close(self.writers[0])
        self.monitor.read_device("event1")
        self.assertFalse(self.monitor.devices)
        self.assertEqual(self.messages[-1]["reason"], "device-error")

    def test_device_identity_change_closes_old_fd_before_reopen(self):
        entry = self.entry(1)
        self.monitor.resume()
        (entry / "dev").write_text("13:99\n")
        # A disappearing/replaced node is revalidated by the real opener.
        self.monitor.opener = lambda *_: (_ for _ in ()).throw(ValueError("identity changed"))
        self.monitor.scan()
        self.assertFalse(self.monitor.devices)

    def test_missing_sysfs_and_unsupported_architecture_are_truthful(self):
        self.monitor.sys_root = self.root / "missing"
        self.monitor.resume()
        self.assertEqual(self.messages[-1]["reason"], "scan-unavailable")
        with patch.object(controller, "supported_architecture", return_value=False):
            self.monitor.scan()
        self.assertEqual(self.messages[-1]["reason"], "unsupported-architecture")

    def test_surface_change_reopens_subscription_to_discard_queued_gameplay(self):
        self.entry(1)
        self.monitor.resume()
        old_fd = self.monitor.devices["event1"].fd
        old_inode = os.fstat(old_fd).st_ino
        os.write(self.writers[0], event(controller.EV_KEY, 0x130, 1))
        self.monitor.set_surface("switcher", 1)
        self.assertEqual(self.opens, ["event1", "event1"])
        self.assertEqual(self.monitor.surface_epoch, 1)
        self.assertNotEqual(os.fstat(self.monitor.devices["event1"].fd).st_ino, old_inode)
        self.assertFalse(any(item["event"] == "input" for item in self.messages))

    def test_invalid_or_stale_surface_protocol_is_bounded(self):
        for surface, epoch in [("keyboard", 1), ("guide", -1), ("guide", True), ("guide", 2 ** 53)]:
            with self.assertRaises(ValueError):
                self.monitor.set_surface(surface, epoch)

    def test_real_open_flags_and_fd_identity_checks_without_any_host_device(self):
        entry = self.entry(1)
        read, write = os.pipe()
        self.addCleanup(os.close, write)
        fake_stat = type("Stat", (), {"st_mode": stat.S_IFCHR | 0o400, "st_rdev": os.makedev(13, 65)})()
        def ioctl(fd, number, size):
            values = {0x20: EVENTS, 0x21: KEYS, 0x23: 3, 0x22: 0, 0x18: 1 << controller.BTN_MODE}
            return values[number].to_bytes(size, "little")
        with patch.object(controller.os, "open", return_value=read) as opened, patch.object(controller.os, "fstat", return_value=fake_stat), patch.object(controller, "read_ioctl", side_effect=ioctl):
            device = controller.open_device(entry, self.root, lambda: None)
            self.assertEqual(opened.call_args.args[1], os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | os.O_NOFOLLOW)
            self.assertTrue(device.decoder.held)
            self.assertFalse(device.decoder.armed)
        os.close(device.fd)

    def test_real_open_rejects_noncharacter_or_changed_capabilities_and_closes_fd(self):
        entry = self.entry(1)
        for fake_stat in [type("Stat", (), {"st_mode": stat.S_IFREG, "st_rdev": 0})(),
                          type("Stat", (), {"st_mode": stat.S_IFCHR, "st_rdev": os.makedev(13, 99)})()]:
            read, write = os.pipe()
            self.addCleanup(os.close, write)
            with patch.object(controller.os, "open", return_value=read), patch.object(controller.os, "fstat", return_value=fake_stat):
                with self.assertRaises(ValueError):
                    controller.open_device(entry, self.root, lambda: None)
            with self.assertRaises(OSError):
                os.fstat(read)


class HelperLifetimeTest(unittest.TestCase):
    def test_actual_helper_eof_exits_while_paused_without_input_node_access(self):
        # No resume command: the real helper never scans/opens any event node.
        result = subprocess.run([sys.executable, str(HELPER)], input="", text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout.strip()), {"schema": 1, "event": "status", "status": "unavailable", "devices": 0, "reason": "session-blocked"})

    def test_actual_helper_rejects_unknown_commands_while_paused(self):
        result = subprocess.run([sys.executable, str(HELPER)], input='{"command":"read-keyboard"}\n', text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout.strip())["reason"], "session-blocked")
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
