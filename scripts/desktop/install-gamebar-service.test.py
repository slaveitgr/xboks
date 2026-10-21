#!/usr/bin/env python3
"""Isolated fixtures only: never enable/start/stop the host user's service."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("install-gamebar-service.py")
SPEC = importlib.util.spec_from_file_location("gamebar_service_installer", SCRIPT)
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.config = self.base / "config"
        self.launcher = self.base / 'xboks $HOME %n client.AppImage'
        self.launcher.write_text("#!/bin/sh\nexit 91\n")
        self.launcher.chmod(0o755)
        self.calls = []
        self.runner = lambda args, root: self.calls.append((args, root))
        self.target = self.config / "systemd/user" / service.UNIT_NAME

    def install(self, **options):
        return service.install(self.config, self.launcher, runner=self.runner, **options)

    def create_unit_parent(self):
        for directory in [self.config, self.config / "systemd", self.target.parent]:
            directory.mkdir(mode=0o700)

    def test_install_writes_exact_scoped_unit_without_enable_or_start(self):
        self.assertEqual(self.install(), self.target)
        text = self.target.read_text()
        self.assertTrue(text.startswith("# X-Xboks-GameBar-Service=1\n"))
        self.assertIn("PartOf=graphical-session.target\n", text)
        self.assertIn("WantedBy=graphical-session.target\n", text)
        self.assertIn("After=graphical-session-pre.target\n", text)
        self.assertIn("Restart=on-failure\n", text)
        self.assertIn("KillMode=mixed\n", text)
        self.assertIn("TimeoutStopSec=20\n", text)
        self.assertIn(" --gamebar-service\n", text)
        self.assertNotIn("--xboks-profile", text)
        self.assertNotIn("User=", text)
        self.assertEqual(self.calls, [(["daemon-reload"], self.config)])
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_exec_path_preserves_literal_dollars_and_escapes_other_expansions(self):
        command = next(row for row in service.render_unit(self.launcher).splitlines() if row.startswith("ExecStart="))
        self.assertTrue(command.startswith('ExecStart=:"/'))
        self.assertIn("$HOME", command)
        self.assertNotIn("$$HOME", command)
        self.assertIn("%%n", command)
        self.assertNotIn("sh -c", command)

    def test_systemd_unsupported_executable_characters_fail_before_publication(self):
        for name in ['xboks "quote"', "xboks 'quote'", 'xboks \\ file', 'xboks [abc]', 'xboks *', 'xboks ?']:
            launcher = self.base / name
            launcher.write_text("#!/bin/sh\nexit 93\n")
            launcher.chmod(0o755)
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "systemd executable"):
                    service.install(self.config, launcher, runner=self.runner)
        self.assertFalse(self.target.exists())
        self.assertEqual(self.calls, [])

    def test_enable_is_explicit_and_does_not_start_now(self):
        self.install(enable=True)
        self.assertEqual([call[0] for call in self.calls], [["daemon-reload"], ["enable", service.UNIT_NAME]])

    def test_start_is_explicit_and_does_not_enable_future_logins(self):
        self.install(start=True)
        self.assertEqual([call[0] for call in self.calls], [["daemon-reload"], ["start", service.UNIT_NAME]])

    def test_enable_then_start_have_separate_ordered_actions(self):
        self.install(enable=True, start=True)
        self.assertEqual([call[0] for call in self.calls], [["daemon-reload"], ["enable", service.UNIT_NAME], ["start", service.UNIT_NAME]])

    def test_idempotent_install_does_not_replace_matching_file(self):
        self.install()
        inode = self.target.stat().st_ino
        self.install()
        self.assertEqual(inode, self.target.stat().st_ino)

    def test_owned_previous_launcher_can_be_updated(self):
        self.install()
        new_launcher = self.base / "xboks-current"
        new_launcher.write_text("#!/bin/sh\nexit 92\n")
        new_launcher.chmod(0o755)
        service.install(self.config, new_launcher, runner=self.runner)
        self.assertEqual(self.target.read_text(), service.render_unit(new_launcher))

    def test_foreign_unit_is_preserved_without_systemctl(self):
        self.create_unit_parent()
        self.target.write_text("[Service]\nExecStart=/usr/bin/foreign\n")
        self.target.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "foreign"):
            self.install(enable=True, start=True)
        self.assertIn("foreign", self.target.read_text())
        self.assertEqual(self.calls, [])

    def test_modified_unit_even_with_marker_is_preserved(self):
        self.install()
        self.calls.clear()
        self.target.write_text(self.target.read_text() + "Environment=INJECTED=true\n")
        with self.assertRaisesRegex(ValueError, "modified"):
            self.install()
        with self.assertRaisesRegex(ValueError, "modified"):
            service.install(self.config, uninstall=True, runner=self.runner)
        self.assertEqual(self.calls, [])

    def test_unit_symlink_and_hardlink_are_rejected(self):
        self.create_unit_parent()
        foreign = self.base / "foreign"
        foreign.write_text(service.render_unit(self.launcher))
        self.target.symlink_to(foreign)
        with self.assertRaises(OSError):
            self.install()
        self.target.unlink()
        os.link(foreign, self.target)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.install()
        self.assertEqual(self.calls, [])

    def test_fifo_is_rejected_without_blocking(self):
        self.create_unit_parent()
        os.mkfifo(self.target, 0o600)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.install()

    def test_unsafe_unit_permissions_or_owner_are_rejected(self):
        self.install()
        self.calls.clear()
        self.target.chmod(0o666)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.install()
        self.target.chmod(0o600)
        with service.unit_directory(self.config, False) as fd:
            with patch.object(service.os, "geteuid", return_value=os.geteuid() + 10):
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    service.read_owned_unit(fd)
        self.assertEqual(self.calls, [])

    def test_symlink_directory_and_unsafe_writable_config_are_rejected(self):
        actual = self.base / "actual"
        actual.mkdir()
        self.config.symlink_to(actual, target_is_directory=True)
        with self.assertRaises(OSError):
            self.install()
        self.assertEqual(list(actual.iterdir()), [])
        self.config.unlink()
        self.config.mkdir(mode=0o777)
        self.config.chmod(0o777)
        with self.assertRaisesRegex(ValueError, "Configuration directories"):
            self.install()
        self.assertEqual(self.calls, [])

    def test_symlink_lock_is_not_followed(self):
        self.create_unit_parent()
        other = self.base / "other"
        other.write_text("preserved")
        (self.target.parent / ".xboks-gamebar.install.lock").symlink_to(other)
        with self.assertRaises(OSError):
            self.install()
        self.assertEqual(other.read_text(), "preserved")
        self.assertEqual(self.calls, [])

    def test_invalid_launcher_paths_are_rejected_before_any_unit_write(self):
        link = self.base / "launcher-link"
        link.symlink_to(self.launcher)
        nonexec = self.base / "nonexec"
        nonexec.write_text("text")
        for candidate in ["relative", "/tmp/a\nExecStart=bad", link, self.base, nonexec]:
            with self.subTest(candidate=str(candidate)):
                with self.assertRaises((ValueError, OSError)):
                    service.install(self.config, candidate, runner=self.runner)
        self.launcher.chmod(0o777)
        with self.assertRaisesRegex(ValueError, "not writable"):
            self.install()
        self.assertFalse(self.target.exists())
        self.assertEqual(self.calls, [])

    def test_uninstall_stops_and_disables_only_exact_owned_unit(self):
        self.install()
        self.calls.clear()
        service.install(self.config, uninstall=True, runner=self.runner)
        self.assertEqual([call[0] for call in self.calls], [["stop", service.UNIT_NAME], ["disable", service.UNIT_NAME], ["daemon-reload"]])
        self.assertFalse(self.target.exists())
        service.install(self.config, uninstall=True, runner=self.runner)
        self.assertEqual(len(self.calls), 3)

    def test_uninstall_missing_config_does_not_create_anything(self):
        service.install(self.config, uninstall=True, runner=self.runner)
        self.assertFalse(self.config.exists())
        self.assertEqual(self.calls, [])

    def test_failed_stop_preserves_unit_and_does_not_disable(self):
        self.install()
        calls = []
        def fail(args, root):
            calls.append(args)
            raise subprocess.CalledProcessError(1, args)
        with self.assertRaises(subprocess.CalledProcessError):
            service.install(self.config, uninstall=True, runner=fail)
        self.assertTrue(self.target.exists())
        self.assertEqual(calls, [["stop", service.UNIT_NAME]])

    def test_failed_enable_is_reported_and_unit_remains_reviewable(self):
        def fail(args, root):
            if args[0] == "enable":
                raise subprocess.CalledProcessError(1, args)
        with self.assertRaises(subprocess.CalledProcessError):
            service.install(self.config, self.launcher, enable=True, runner=fail)
        self.assertEqual(self.target.read_text(), service.render_unit(self.launcher))

    def test_missing_systemctl_during_final_removal_reload_is_not_silently_successful(self):
        self.install()
        def fail(args, root):
            if args[0] == "daemon-reload":
                raise FileNotFoundError("fixture missing systemctl")
        with self.assertRaises(FileNotFoundError):
            service.install(self.config, uninstall=True, runner=fail)
        self.assertFalse(self.target.exists())

    def test_foreign_startup_link_is_preserved_before_enable_or_uninstall(self):
        self.install()
        self.calls.clear()
        wants = self.target.parent / "graphical-session.target.wants"
        wants.mkdir(mode=0o700)
        link = wants / service.UNIT_NAME
        link.symlink_to("/tmp/foreign-unit.service")
        for action in [lambda: self.install(enable=True),
                       lambda: service.install(self.config, uninstall=True, runner=self.runner)]:
            with self.assertRaisesRegex(ValueError, "foreign"):
                action()
        self.assertEqual(os.readlink(link), "/tmp/foreign-unit.service")
        self.assertTrue(self.target.exists())
        self.assertEqual(self.calls, [])

    def test_own_relative_startup_link_is_accepted(self):
        self.install()
        self.calls.clear()
        wants = self.target.parent / "graphical-session.target.wants"
        wants.mkdir(mode=0o700)
        (wants / service.UNIT_NAME).symlink_to("../" + service.UNIT_NAME)
        self.install(enable=True)
        self.assertEqual([call[0] for call in self.calls], [["daemon-reload"], ["enable", service.UNIT_NAME]])

    def test_symlink_startup_directory_is_rejected(self):
        self.install()
        self.calls.clear()
        (self.target.parent / "graphical-session.target.wants").symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(OSError):
            self.install(enable=True)
        self.assertEqual(self.calls, [])

    def test_explicit_uninstall_rejects_contradictory_options(self):
        with self.assertRaisesRegex(ValueError, "combined"):
            service.install(self.config, self.launcher, uninstall=True, runner=self.runner)
        with self.assertRaisesRegex(ValueError, "combined"):
            service.install(self.config, uninstall=True, enable=True, runner=self.runner)

    def test_cli_uses_fake_systemctl_shell_free_and_never_executes_launcher(self):
        fake_bin = self.base / "bin"
        fake_bin.mkdir()
        log = self.base / "calls.jsonl"
        fake = fake_bin / "systemctl"
        fake.write_text(f"#!{sys.executable}\nimport json,os,sys\nwith open(os.environ['FAKE_SYSTEMCTL_LOG'],'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n")
        fake.chmod(0o755)
        result = subprocess.run([sys.executable, str(SCRIPT), "--launcher", str(self.launcher),
                                 "--config-root", str(self.config), "--enable"], capture_output=True, text=True,
                                env={**os.environ, "PATH": str(fake_bin), "FAKE_SYSTEMCTL_LOG": str(log)}, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([json.loads(line) for line in log.read_text().splitlines()], [
            ["--user", "--no-ask-password", "daemon-reload"],
            ["--user", "--no-ask-password", "enable", service.UNIT_NAME]])
        self.assertNotIn("start now: requested", result.stdout)


if __name__ == "__main__":
    unittest.main()
