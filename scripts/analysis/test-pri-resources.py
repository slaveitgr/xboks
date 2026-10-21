"""Synthetic PRI fixtures; no Microsoft package or Windows runtime required."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('pri', Path(__file__).with_name('inspect-pri-resources.py'))
pri = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pri)


def wide(text):
    return (text + '\0').encode('utf-16-le')


def names_fixture():
    pool = b'Resources\0Label\0'
    nodes = [(0, 0, 0, 0, 0x10, 0, 0), (0, 9, ord('R'), 9, 0x30, 0, 1), (1, 15, ord('L'), 5, 0x20, 10, 0)]
    scopes = [(0, 1, 1, 0), (1, 1, 2, 0)]
    size = 28 + 12 * 3 + 8 * 2 + 2 + len(pool)
    return struct.pack('<HH6I', 15, 0, 3, 2, 1, 0, size, len(pool)) + b''.join(struct.pack('<HHHBBHH', *node) for node in nodes) + b''.join(struct.pack('<4H', *scope) for scope in scopes) + struct.pack('<H', 2) + pool


VERSION = (1, 0, 0, 123456, 2, 1)
UNIQUE = 'ms-appx://Example/'


def schema_fixture():
    unique, simple = wide(UNIQUE), wide('Example')
    result = struct.pack('<4H16s', 1, len(unique) // 2, len(simple) // 2, 0, b'[def_hnamesx]  \0') + struct.pack('<HH4I', *VERSION) + unique + simple
    result += bytes((-len(result)) % 4)
    return result + names_fixture()


def decisions_fixture(language='EL-GR'):
    # Decision0 empty; decision1 neutral; decision2 language-qualified.
    literals = wide('') + wide(language)
    header = struct.pack('<6H', 2, 2, 2, 3, 3, len(literals) // 2)
    decisions = [(0, 0), (1, 1), (2, 1)]
    sets = [(0, 0), (0, 1)]
    qualifiers = [(0, 0, 0, 0), (1, 700, 0, 0)]
    bases = [(0, 0, 0, 1, 0), (2, 0, 0, 10, 1)]
    return header + b''.join(struct.pack('<HH', *x) for x in decisions + sets) + b''.join(struct.pack('<4H', *x) for x in qualifiers) + b''.join(struct.pack('<4HI', *x) for x in bases) + struct.pack('<3H', 1, 0, 1) + literals


def map_fixture(reference=None, detail=0):
    ref = b''
    if reference is not None:
        ref = struct.pack('<HH4IHHii', *reference, len(wide(UNIQUE)) // 2, 0, 0, 0) + wide(UNIQUE)
        ref += bytes((-len(ref)) % 4)
    header = struct.pack('<HHhHh5H3I', 0, 0, 2, len(ref), 0, 1, 1, 1, 1, 0, 1, 0, 0)
    return header + ref + struct.pack('<ii', 4, 0) + struct.pack('<6H', 0, 0, 1, 0, 2, 0) + struct.pack('<BB3H', 1, 0, detail, 0, 4)


def fixture(text='Δοκιμή', language='EL-GR', reference=None, detail=0):
    raw = wide(text)
    data_items = struct.pack('<IHHIHH', 0, 1, 0, len(raw), 0, len(raw)) + raw
    descriptor = struct.pack('<Hh4Hh3H4h', 2, -1, 0, 1, 1, 1, 3, 0, 1, 0, 2, 0, 3, 4)
    sections = [('[mrm_decn_info]', decisions_fixture(language)), ('[mrm_pridescex]', descriptor),
                ('[mrm_hschemaex]', b'' if reference is not None else schema_fixture()),
                ('[mrm_res_map2_]', map_fixture(reference, detail)), ('[mrm_dataitem]', data_items)]
    base = 32 + 32 * len(sections)
    toc, payloads, offset = bytearray(), bytearray(), 0
    for typ, payload in sections:
        typ = typ.encode().ljust(16, b'\0')
        payload += bytes((-len(payload)) % 8)
        size = 32 + len(payload) + 8
        toc += struct.pack('<16sHHIII', typ, 0, 0, 0, offset, size)
        payloads += struct.pack('<16sIHHII', typ, 0, 0, 0, size, 0) + payload + struct.pack('<II', 0xdef5fade, size)
        offset += size
    total = base + len(payloads) + 16
    return struct.pack('<8sHHIIIhhI', b'mrm_pri2', 0, 1, total, 32, base, len(sections), -1, 0) + toc + payloads + struct.pack('<II8s', 0xdefffade, total, b'mrm_pri2')


class PriResources(unittest.TestCase):
    def test_container_validates_matching_toc_headers_and_trailers(self):
        result = pri.container(fixture())
        self.assertEqual(len(result['sections']), 5)
        self.assertEqual(result['sections'][3]['type'], '[mrm_res_map2_]')
        for offset, message in [(0, 'Unsupported'), (12, 'length'), (-16, 'trailer'), (32, 'mismatch')]:
            with self.subTest(offset=offset):
                data = bytearray(fixture()); data[offset] ^= 1
                with self.assertRaisesRegex(ValueError, message):
                    pri.container(data)

    def test_container_rejects_overlapping_or_out_of_bounds_sections(self):
        data = bytearray(fixture())
        struct.pack_into('<I', data, 32 + 24, len(data))
        with self.assertRaisesRegex(ValueError, 'section bounds'):
            pri.container(data)

    def test_hierarchical_names_resolve_item_paths_and_empty_root_pool(self):
        result = pri.hnames(names_fixture(), True)
        self.assertEqual(result['items'], ['Resources/Label'])
        self.assertEqual(result['num_scopes'], 2)

    def test_hierarchical_names_reject_corrupt_parent_payload_and_pool_bounds(self):
        for offset, value, message in [(28 + 12 * 2, 7, 'parent-node'), (28 + 12 * 2 + 10, 9, 'item/node'), (28 + 12 * 2 + 8, 100, 'owning buffer')]:
            with self.subTest(offset=offset):
                data = bytearray(names_fixture()); struct.pack_into('<H', data, offset, value)
                with self.assertRaisesRegex(ValueError, message):
                    pri.hnames(data, True)

    def test_large_hierarchical_node_format_is_explicitly_unsupported(self):
        data = bytearray(names_fixture()); struct.pack_into('<H', data, 2, 1)
        with self.assertRaises(pri.Unsupported):
            pri.hnames(data, True)

    def test_decision_qualifiers_preserve_language_case_and_raw_atoms(self):
        section = {'payload': decisions_fixture(), 'payload_offset': 0}
        result = pri.decisions(section)
        self.assertEqual(result['decisions'][2], [1])
        qualifier = result['sets'][1][0]
        self.assertEqual((qualifier['attribute'], qualifier['value'], qualifier['priority'], qualifier['fallback_score']), ('Language', 'EL-GR', 700, 0))
        self.assertEqual(qualifier['attribute_atom'], [2, 0])
        self.assertEqual(qualifier['operator_atom'], [0, 10])

    def test_decision_rejects_out_of_range_reference(self):
        data = bytearray(decisions_fixture())
        # Last decision points past the reference array.
        struct.pack_into('<HH', data, 12 + 2 * 4, 3, 1)
        with self.assertRaisesRegex(ValueError, 'Decision references'):
            pri.decisions({'payload': data, 'payload_offset': 0})

    def test_data_item_bounds_and_declared_encoding_are_checked(self):
        section = {'payload': struct.pack('<IHHIHH', 0, 1, 0, 2, 1, 2) + b'xx', 'payload_offset': 0}
        with self.assertRaisesRegex(ValueError, 'owning buffer'):
            pri.data_items(section)
        candidate = {'locator': 0, 'detail': 2, 'data1': 0, 'data2': 0, 'data3': 0, 'type_atom': [4, 0]}
        with self.assertRaisesRegex(ValueError, 'not terminated'):
            pri.candidate_value(candidate, {'internal': b'xx', 'internal_file_offset': 0}, {})

    def test_named_resource_candidate_is_bound_through_tables_to_greek_value(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.pri'; path.write_bytes(fixture())
            result = pri.inspect_inputs([path])[0]
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['unsupported'], [])
        resource = result['resources'][0]
        self.assertEqual(resource['key'], 'Resources/Label')
        self.assertEqual(resource['candidates'][0]['value'], 'Δοκιμή')
        self.assertEqual(resource['candidates'][0]['encoding'], 'utf-16-le')
        self.assertEqual(resource['candidates'][0]['qualifiers'][0]['value'], 'EL-GR')

    def test_external_schema_requires_exact_identity_version_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            main, pack = Path(directory) / 'main.pri', Path(directory) / 'pack.pri'
            main.write_bytes(fixture(text='Example', language='EN-US'))
            pack.write_bytes(fixture(reference=VERSION))
            result = pri.inspect_inputs([main, pack])
            self.assertEqual(result[1]['resources'][0]['key'], 'Resources/Label')
            self.assertEqual(result[1]['resource_maps'][0]['schema_sha256'], result[0]['sha256'])
            missing = pri.inspect_inputs([pack])[0]
            self.assertEqual(missing['resources'], [])
            self.assertIn('No supplied schema', missing['unsupported'][0]['reason'])
            bad_version = list(VERSION); bad_version[3] ^= 1
            pack.write_bytes(fixture(reference=bad_version))
            mismatch = pri.inspect_inputs([main, pack])[1]
            self.assertEqual(mismatch['resources'], [])
            self.assertIn('No supplied schema', mismatch['unsupported'][0]['reason'])

    def test_external_file_candidate_is_not_silently_resolved_locally(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.pri'; path.write_bytes(fixture(detail=1))
            result = pri.inspect_inputs([path])[0]
        self.assertEqual(result['resources'][0]['candidates'][0]['unsupported'], 'Candidate refers to an external file index')

    def test_jsonl_output_is_hash_bound_and_writer_does_not_mutate_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'test.pri'; path.write_bytes(fixture())
            reports = pri.inspect_inputs([path])
            result = pri.write_reports(reports, root / 'out')
            raw = (root / 'out' / 'resources.jsonl').read_bytes()
            self.assertEqual(result['resources_jsonl_sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(result['resources_jsonl_bytes'], len(raw))
            self.assertEqual(result['counts']['decoded_string'], 1)
            self.assertEqual(len(reports[0]['resources']), 1)
            second = pri.write_reports(reports, root / 'second')
            self.assertEqual(second['resources_jsonl_sha256'], result['resources_jsonl_sha256'])


if __name__ == '__main__':
    unittest.main()
