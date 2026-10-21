#!/usr/bin/env python3
"""Synthetic safety/provenance tests; no Microsoft package or system mutation."""
import hashlib
import importlib.util
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('gamebar', Path(__file__).with_name('build-gamebar-reference.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class GamebarReferenceTests(unittest.TestCase):
    def test_embedded_resource_hash_and_exact_slice(self):
        payload = b'prefix' + b'XBF\0synthetic' + b'suffix'
        value = payload[6:19]
        self.assertEqual(g.embedded_bytes(payload, {'kind': 'embedded', 'value_file_offset': 6,
            'value_bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}), value)

    def test_embedded_resource_rejects_changed_bytes(self):
        with self.assertRaisesRegex(ValueError, 'digest'):
            g.embedded_bytes(b'changed', {'kind': 'embedded', 'value_file_offset': 0,
                'value_bytes': 7, 'sha256': '0' * 64})

    def test_embedded_resource_rejects_out_of_bounds_and_boolean(self):
        for offset, size in [(-1, 1), (4, 2), (0, -1), (True, 1), (0, g.MAX_ENTRY + 1)]:
            with self.subTest(offset=offset, size=size), self.assertRaises(ValueError):
                g.embedded_bytes(b'1234', {'kind': 'embedded', 'value_file_offset': offset,
                    'value_bytes': size, 'sha256': '0' * 64})

    def test_embedded_resource_rejects_path_type(self):
        with self.assertRaisesRegex(ValueError, 'declared'):
            g.embedded_bytes(b'1234', {'kind': 'path'})

    def test_archive_rejects_duplicate_names(self):
        value = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(value, 'w') as z:
                z.writestr('same', b'a'); z.writestr('same', b'b')
        with zipfile.ZipFile(io.BytesIO(value.getvalue())) as z, self.assertRaisesRegex(ValueError, 'Duplicate'):
            list(g.checked_members(z))

    def test_archive_paths_are_not_extracted(self):
        value = io.BytesIO()
        with zipfile.ZipFile(value, 'w') as z: z.writestr('../../synthetic-only', b'data')
        with zipfile.ZipFile(io.BytesIO(value.getvalue())) as z:
            entries = list(g.checked_members(z))
            self.assertEqual(z.read(entries[0]), b'data')
            self.assertEqual(entries[0].filename, '../../synthetic-only')

    def test_archive_crc_is_checked_on_read(self):
        value = io.BytesIO()
        with zipfile.ZipFile(value, 'w', compression=zipfile.ZIP_STORED) as z: z.writestr('value', b'correct-synthetic-data')
        raw = value.getvalue().replace(b'correct-synthetic-data', b'incorrectsyntheticdata')
        with zipfile.ZipFile(io.BytesIO(raw)) as z, self.assertRaises(zipfile.BadZipFile):
            z.read(next(g.checked_members(z)))

    def test_manifest_keeps_qualified_capability_and_widget_host(self):
        result = g.manifest_contract(b'''<Package xmlns="urn:main" xmlns:u="urn:uap"><Identity Name="Synthetic"/>
          <Capabilities><u:Capability Name="globalMediaControl"/></Capabilities><Applications>
          <Application Executable="Synthetic.exe"><Extensions><u:Extension Category="windows.appExtensionHost">
          <u:AppExtensionHost><u:Name>microsoft.gameBarUIExtension</u:Name></u:AppExtensionHost></u:Extension>
          <u:Protocol Name="synthetic"/></Extensions></Application></Applications></Package>''')
        self.assertEqual(result['identity']['Name'], 'Synthetic')
        self.assertEqual(result['capabilities'][0]['Name'], 'globalMediaControl')
        self.assertEqual(result['extensions'][1]['children'][0]['text'], 'microsoft.gameBarUIExtension')
        self.assertEqual(result['protocols'], [{'Name': 'synthetic'}])

    def test_manifest_entities_rejected(self):
        for value in [b'<!DOCTYPE X><X/>', b'<!ENTITY a "value"><X/>']:
            with self.assertRaises(ValueError): g.manifest_contract(value)

    def test_literal_offsets_preserve_distinct_encodings(self):
        raw = b'not-word\0\0\0\0' + 'Spotify'.encode('utf-16le') + b'\0\0'
        matches = list(g.literal_sites(raw))
        self.assertIn({'offset': 12, 'bytes': 14, 'encoding': 'utf-16-le', 'value': 'Spotify'}, matches)
        self.assertTrue(any(m['encoding'] == 'ascii' and m['offset'] == 0 for m in matches))

    def test_database_search_is_readonly_and_literal(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'index.sqlite3'
            with sqlite3.connect(db) as c:
                g.create_database(c)
                c.execute('INSERT INTO literals VALUES(?,?,?,?)', ('fake.exe', 10, 'ascii', 'literal_%'))
                c.execute('INSERT INTO literals VALUES(?,?,?,?)', ('fake.exe', 20, 'ascii', 'unrelated'))
            self.assertEqual(len(g.search(db, '_%', 10)['literals']), 1)
            self.assertEqual(g.search(db, "' OR 1=1 --", 10)['literals'], [])

    def test_search_bounds(self):
        for query, limit in [('', 1), ('x' * 201, 1), ('a', 0), ('a', 201)]:
            with self.assertRaises(ValueError): g.search(Path('not-opened'), query, limit)

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, 'never overwritten'):
            g.build(Path('not-read'), None, Path(directory), Path('not-read'))


if __name__ == '__main__': unittest.main()
