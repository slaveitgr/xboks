"""Exercise schema compilation and staging isolation without touching live GNOME."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from unittest import mock


SPEC = importlib.util.spec_from_file_location('stage_gnome_experience', Path(__file__).with_name('stage-gnome-experience.py'))
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


@unittest.skipUnless(shutil.which('glib-compile-schemas'), 'glib-compile-schemas is required for extension staging')
class StageSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='linux-gaming-mode-stage-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        for name in STAGE.FILES:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// fixture\n')
        self.metadata = {'uuid': STAGE.UUID, 'shell-version': ['51'], 'session-modes': ['user'], 'settings-schema': STAGE.SETTINGS_SCHEMA}
        (self.source / 'metadata.json').write_text(json.dumps(self.metadata))
        self.schema = self.source / 'schemas' / (STAGE.SETTINGS_SCHEMA + '.gschema.xml')
        self.schema.write_text('''<schemalist>
  <schema id="org.gnome.shell.extensions.linux-gaming-mode" path="/org/gnome/shell/extensions/linux-gaming-mode/">
    <key name="home-app" type="s"><default>'none'</default></key>
  </schema>
</schemalist>''')
        self.destination = self.root / 'staged'

    def tearDown(self):
        self.temporary.cleanup()

    def test_stages_nested_schema_and_compiles_only_the_copied_xml(self):
        (self.source / 'schemas/gschemas.compiled').write_bytes(b'not a trusted compiled schema')
        bundle = STAGE.stage(self.destination, self.source)
        manifest = json.loads((self.destination / 'stage-manifest.json').read_text())
        self.assertEqual(set(manifest['sha256']), set(STAGE.FILES) | {'schemas/gschemas.compiled'})
        for name, digest in manifest['sha256'].items():
            self.assertEqual(hashlib.sha256((bundle / name).read_bytes()).hexdigest(), digest)
        self.assertNotEqual((bundle / 'schemas/gschemas.compiled').read_bytes(), b'not a trusted compiled schema')
        query = subprocess.run(['gsettings', '--schemadir', str(bundle / 'schemas'), 'range', STAGE.SETTINGS_SCHEMA, 'home-app'],
                               check=True, capture_output=True, text=True)
        self.assertEqual(query.stdout.strip(), 'type s')

    def test_invalid_xml_fails_compilation_and_removes_the_partial_stage(self):
        self.schema.write_text('''<schemalist><schema id="org.gnome.shell.extensions.linux-gaming-mode" path="/org/gnome/shell/extensions/linux-gaming-mode/">
          <key name="home-app" type="s"><default>not-a-string</default></key>
        </schema></schemalist>''')
        with self.assertRaises(subprocess.CalledProcessError):
            STAGE.stage(self.destination, self.source)
        self.assertFalse(self.destination.exists())

    def test_schema_identity_must_match_metadata(self):
        self.schema.write_text('<schemalist><schema id="org.example.unrelated" path="/org/example/unrelated/"><key name="home-app" type="s"><default>\'none\'</default></key></schema></schemalist>')
        with self.assertRaisesRegex(ValueError, 'schema does not match'):
            STAGE.stage(self.destination, self.source)
        self.assertFalse(self.destination.exists())

    def test_refuses_symlink_source_and_preserves_existing_destination(self):
        outside = self.root / 'outside.js'
        outside.write_text('// external\n')
        (self.source / 'prefs.js').unlink()
        (self.source / 'prefs.js').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'unsafe extension source'):
            STAGE.stage(self.destination, self.source)
        self.assertFalse(self.destination.exists())
        self.destination.mkdir()
        sentinel = self.destination / 'existing'
        sentinel.write_bytes(b'preserved')
        with self.assertRaises(FileExistsError):
            STAGE.stage(self.destination, self.source)
        self.assertEqual(sentinel.read_bytes(), b'preserved')

    def test_unavailable_compiler_removes_stage_without_installing(self):
        with mock.patch.object(STAGE.subprocess, 'run', side_effect=FileNotFoundError('schema compiler missing')):
            with self.assertRaises(FileNotFoundError):
                STAGE.stage(self.destination, self.source)
        self.assertFalse(self.destination.exists())

    def test_archive_installs_from_its_root_and_never_replaces_an_existing_file(self):
        bundle = STAGE.stage(self.destination, self.source)
        archive = self.root / (STAGE.UUID + '.shell-extension.zip')
        self.assertEqual(STAGE.pack(bundle, archive), archive)
        with zipfile.ZipFile(archive) as zipped:
            self.assertEqual(set(zipped.namelist()), set(STAGE.FILES) | {'schemas/gschemas.compiled'})
            self.assertEqual(json.loads(zipped.read('metadata.json'))['uuid'], STAGE.UUID)
        before = archive.read_bytes()
        with self.assertRaises(FileExistsError):
            STAGE.pack(bundle, archive)
        self.assertEqual(archive.read_bytes(), before)

    def test_archive_rejects_modified_stage_and_nested_output(self):
        bundle = STAGE.stage(self.destination, self.source)
        with self.assertRaisesRegex(ValueError, 'outside'):
            STAGE.pack(bundle, bundle / 'bundle.zip')
        (bundle / 'prefs.js').write_text('// changed after staging\n')
        archive = self.root / 'changed.zip'
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            STAGE.pack(bundle, archive)
        self.assertFalse(archive.exists())


if __name__ == '__main__':
    unittest.main()
