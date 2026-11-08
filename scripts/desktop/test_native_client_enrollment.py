import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('native_client_enrollment', Path(__file__).with_name('native-client-enrollment.py'))
enrollment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrollment)


class EnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.prefix = self.root / 'prefix'
        (self.prefix / 'dosdevices').mkdir(parents=True)
        (self.prefix / 'dosdevices/z:').symlink_to('/')
        self.client = self.root / 'original/XboxPcAppCE.exe'
        self.client.parent.mkdir()
        self.client.write_bytes(b'Independent test PE fixture')
        self.runtime = self.root / 'runtime'
        self.loader = self.runtime / 'lib/wine/x86_64-unix/wine-preloader'
        self.loader.parent.mkdir(parents=True)
        self.loader.write_bytes(b'Independent loader fixture')
        self.user_runtime = self.root / 'user-runtime'
        self.user_runtime.mkdir(mode=0o700)
        self.proc = self.root / 'proc'
        self.proc.mkdir()
        self.pid = 4321
        process = self.proc / str(self.pid)
        process.mkdir()
        (process / 'exe').symlink_to(self.loader)
        self.write_start(100)
        self.set_command(self.client)
        (process / 'environ').write_bytes(b'WINEPREFIX=' + os.fsencode(self.prefix) + b'\0')
        self.worker = enrollment.NativeClientEnrollment(self.prefix, self.client, self.runtime,
            self.user_runtime, 90, expected_sha256=hashlib.sha256(self.client.read_bytes()).hexdigest(), proc_root=self.proc)

    def write_start(self, ticks):
        fields = ['0'] * 25
        fields[0] = 'S'
        fields[19] = str(ticks)
        (self.proc / str(self.pid) / 'stat').write_text(str(self.pid) + ' (XboxPcAppCE.exe) ' + ' '.join(fields))

    def set_command(self, path):
        (self.proc / str(self.pid) / 'cmdline').write_bytes(('Z:' + str(path).replace('/', '\\\\')).encode() + b'\0')

    def test_doubled_windows_separators_and_exact_identity(self):
        identity = self.worker.identify(self.pid)
        self.assertEqual(identity, {'pid': self.pid, 'startTime': '100', 'executable': str(self.loader)})

    def test_wrong_prefix_not_enrolled(self):
        (self.proc / str(self.pid) / 'environ').write_bytes(b'WINEPREFIX=/some/other/prefix\0')
        self.assertIsNone(self.worker.identify(self.pid))

    def test_wrong_client_not_enrolled(self):
        self.set_command(self.root / 'other/XboxPcAppCE.exe')
        self.assertIsNone(self.worker.identify(self.pid))

    def test_wrong_loader_not_enrolled(self):
        link = self.proc / str(self.pid) / 'exe'
        link.unlink()
        link.symlink_to(self.client)
        self.assertIsNone(self.worker.identify(self.pid))

    def test_process_predating_launch_not_enrolled(self):
        self.write_start(89)
        self.assertIsNone(self.worker.identify(self.pid))

    def test_changed_original_binary_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'identity differs'):
            enrollment.NativeClientEnrollment(self.prefix, self.client, self.runtime, self.user_runtime, 90, proc_root=self.proc)

    def test_publication_permissions_and_content_exclude_account_data(self):
        identity = self.worker.identify(self.pid)
        self.worker.publish(identity)
        self.addCleanup(self.worker.remove)
        record = self.worker.record
        self.assertEqual(record.stat().st_mode & 0o777, 0o600)
        data = json.loads(record.read_text())
        self.assertEqual(set(data), {'schema','pid','startTime','executable','pePath','peSHA256','desktopId'})
        self.assertEqual(data['desktopId'], enrollment.DESKTOP_ID)

    def test_existing_symlink_is_not_overwritten(self):
        target = self.root / 'untouched'
        target.write_text('unchanged')
        record = self.worker.directory / (str(self.pid) + '.json')
        record.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            self.worker.publish(self.worker.identify(self.pid))
        self.assertEqual(target.read_text(), 'unchanged')
        self.assertTrue(record.is_symlink())

    def test_identity_change_before_publish_rejected(self):
        identity = self.worker.identify(self.pid)
        self.write_start(101)
        with self.assertRaisesRegex(RuntimeError, 'changed before'):
            self.worker.publish(identity)
        self.assertFalse((self.worker.directory / (str(self.pid) + '.json')).exists())

    def test_pid_reuse_removes_own_record(self):
        self.worker.start()
        self.addCleanup(self.worker.stop)
        deadline = time.monotonic() + 3
        while self.worker.record is None and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertIsNotNone(self.worker.record)
        record = self.worker.record
        self.write_start(101)
        while record.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(record.exists())

    def test_unsafe_directory_mode_and_symlink_rejected(self):
        unsafe = self.root / 'unsafe'
        unsafe.mkdir(mode=0o755)
        with self.assertRaisesRegex(RuntimeError, 'owner-only'):
            enrollment.private_directory(unsafe)
        link = self.root / 'link'
        link.symlink_to(self.user_runtime)
        with self.assertRaisesRegex(RuntimeError, 'owner-only'):
            enrollment.private_directory(link)


if __name__ == '__main__':
    unittest.main()
