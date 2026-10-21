"""Synthetic contract checks; no Microsoft package, app or Windows runtime runs."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'contract_validator', Path(__file__).with_name('validate-reference-contracts.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
reader = validator.function_reader()
SOURCE = 'DEFINE_OPCODE_2(LoadConstUInt8, Reg8, UInt8)\nDEFINE_OPCODE_1(Ret, Reg8)\n'


def bundle_fixture(bodies=(b'\x00\x00\x07\x01\x00',)):
    """One named string; selected function has boundaries 0 and 3."""
    name = b'test'
    string_offset = 128 + 16 * len(bodies) + 4 + 4 + 4
    body_offset = (string_offset + len(name) + 3) & ~3
    data = bytearray(body_offset + sum(len(body) for body in bodies))
    struct.pack_into('<QI', data, 0, 0x1F1903C103BC1FC6, 96)
    fields = dict.fromkeys(reader.metadata_reader.FIELDS, 0)
    fields.update(fileLength=len(data) + 20, functionCount=len(bodies),
                  stringKindCount=1, identifierCount=1, stringCount=1,
                  stringStorageSize=len(name), debugInfoOffset=len(data))
    struct.pack_into('<19I', data, 32, *[fields[k] for k in reader.metadata_reader.FIELDS])
    cursor = body_offset
    for fid, body in enumerate(bodies):
        struct.pack_into('<III', data, 128 + fid * 16, cursor, len(body), 0)
        data[cursor:cursor + len(body)] = body
        cursor += len(body)
    struct.pack_into('<I', data, string_offset - 4, len(name) << 24)
    data[string_offset:string_offset + len(name)] = name
    return bytes(data) + hashlib.sha1(data).digest()


def document_fixture():
    return {
        'schema_version': 1, 'reference': dict(validator.MENU_REFERENCE),
        'rules': [{
            'id': 'fixture.activation', 'classification': 'bounded_static_dataflow',
            'original_runtime_verified': False,
            'evidence': [{'function_id': 0, 'instruction_offsets': [0, 3],
                          'private_trace': '/untrusted/forged-trace.json'}],
        }],
        'counts': {'rules': 1, 'original_runtime_verified': 0},
    }


class MenuContractValidation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.contracts, self.reference = self.root/'contracts', self.root/'reference'
        self.contracts.mkdir()
        (self.reference/'hermes-format').mkdir(parents=True)
        self.data = bundle_fixture()
        self.bundle_hash = hashlib.sha256(self.data).hexdigest()
        self.opcode_hash = hashlib.sha256(SOURCE.encode()).hexdigest()
        (self.reference/'index.bundle').write_bytes(self.data)
        (self.reference/'hermes-format'/'BytecodeList.def').write_text(SOURCE)
        self.document = document_fixture()

    def validate(self, document=None, **overrides):
        (self.contracts/'menu-behavior-contracts.json').write_text(
            json.dumps(self.document if document is None else document))
        return validator.validate_menu_contracts(
            self.contracts, self.reference,
            expected_bundle_sha256=overrides.get('bundle_hash', self.bundle_hash),
            expected_opcodes_sha256=overrides.get('opcode_hash', self.opcode_hash))

    def test_valid_locators_use_fresh_bytes_and_ignore_cached_metadata(self):
        (self.reference/'hermes96-decoded.json').write_text('invalid cached metadata')
        (self.reference/'hermes96-code-index.json').write_text('invalid cached index')
        result = self.validate()
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['menu_functions_decoded'], 1)
        self.assertEqual(result['menu_instruction_locators'], 2)
        self.assertTrue(result['menu_source_binding']['fresh_metadata'])
        self.assertFalse(result['menu_source_binding']['private_trace_trusted'])

    def test_decodes_only_selected_unique_functions(self):
        # Function1's unknown opcode must not force a complete bundle disassembly.
        data = bundle_fixture((self.data[160:165], b'\xff'))
        (self.reference/'index.bundle').write_bytes(data)
        duplicate_source = copy.deepcopy(self.document['rules'][0])
        duplicate_source['id'] = 'fixture.other'
        self.document['rules'].append(duplicate_source)
        self.document['counts']['rules'] = 2
        with patch.object(reader, 'decode_function', wraps=reader.decode_function) as decode:
            with patch.object(validator, 'function_reader', return_value=reader):
                result = self.validate(bundle_hash=hashlib.sha256(data).hexdigest())
        self.assertEqual(result['issues'], [])
        self.assertEqual(decode.call_count, 1)
        self.assertEqual(result['menu_functions_decoded'], 1)

    def test_forged_private_trace_cannot_make_operand_or_end_offsets_valid(self):
        forged = self.root/'forged.json'
        forged.write_text(json.dumps({'annotated_instructions': [{'offset': 1}, {'offset': 5}]}))
        for offset in (1, 5, 999):
            with self.subTest(offset=offset):
                doc = copy.deepcopy(self.document)
                doc['rules'][0]['evidence'][0].update(
                    private_trace=str(forged), instruction_offsets=[offset])
                result = self.validate(doc)
                self.assertTrue(any('not an instruction boundary' in issue for issue in result['issues']))

    def test_invalid_and_out_of_range_function_ids_are_rejected(self):
        for fid in (True, -1, '0', 0.5, 1):
            with self.subTest(fid=fid):
                doc = copy.deepcopy(self.document)
                doc['rules'][0]['evidence'][0]['function_id'] = fid
                result = self.validate(doc)
                self.assertTrue(any('function ID' in issue or 'function table' in issue
                                    for issue in result['issues']))

    def test_malformed_or_duplicate_offsets_are_rejected(self):
        for offsets in ([], [True], [-1], ['0'], [0.5], [0, 0]):
            with self.subTest(offsets=offsets):
                doc = copy.deepcopy(self.document)
                doc['rules'][0]['evidence'][0]['instruction_offsets'] = offsets
                result = self.validate(doc)
                self.assertTrue(any('instruction offsets' in issue for issue in result['issues']))

    def test_unique_rule_ids_and_declared_counts_are_required(self):
        doc = copy.deepcopy(self.document)
        doc['rules'].append(copy.deepcopy(doc['rules'][0]))
        result = self.validate(doc)
        self.assertTrue(any('duplicate rule ID' in issue for issue in result['issues']))
        self.assertIn('Menu rule count mismatch', result['issues'])
        doc = copy.deepcopy(self.document)
        doc['rules'][0]['id'] = ''
        self.assertTrue(any('invalid rule ID' in issue for issue in self.validate(doc)['issues']))

    def test_runtime_verified_flags_cannot_be_promoted_without_evidence(self):
        for flag in (True, None, 0, 'false'):
            with self.subTest(flag=flag):
                doc = copy.deepcopy(self.document)
                doc['rules'][0]['original_runtime_verified'] = flag
                self.assertTrue(any('must be false' in issue for issue in self.validate(doc)['issues']))
        for count in (1, False, '0'):
            with self.subTest(count=count):
                doc = copy.deepcopy(self.document)
                doc['counts']['original_runtime_verified'] = count
                self.assertTrue(any('count must be zero' in issue for issue in self.validate(doc)['issues']))

    def test_build_schema_and_bounded_scope_are_checked(self):
        for field, value in (('schema_version', True), ('schema_version', 2),
                             ('reference', {**validator.MENU_REFERENCE, 'version': 'different'})):
            with self.subTest(field=field, value=value):
                doc = copy.deepcopy(self.document)
                doc[field] = value
                self.assertTrue(self.validate(doc)['issues'])
        doc = copy.deepcopy(self.document)
        doc['rules'][0]['classification'] = 'runtime-proven'
        self.assertTrue(any('bounded_static_dataflow' in issue for issue in self.validate(doc)['issues']))

    def test_changed_bundle_with_recomputed_footer_fails_pinned_hash(self):
        data = bytearray(self.data[:-20])
        data[162] = 8
        data += hashlib.sha1(data).digest()
        (self.reference/'index.bundle').write_bytes(data)
        result = self.validate()
        self.assertIn('Menu bundle SHA-256 differs from the pinned source', result['issues'])
        self.assertEqual(result['menu_functions_decoded'], 0)

    def test_changed_opcode_definition_fails_pinned_hash(self):
        (self.reference/'hermes-format'/'BytecodeList.def').write_text(SOURCE + '// changed\n')
        result = self.validate()
        self.assertTrue(any('opcode-definition SHA-256' in issue for issue in result['issues']))
        self.assertEqual(result['menu_functions_decoded'], 0)

    def test_matching_hash_does_not_bypass_bundle_integrity_reader(self):
        data = bytearray(self.data)
        data[162] ^= 1  # Footer deliberately not updated.
        (self.reference/'index.bundle').write_bytes(data)
        result = self.validate(bundle_hash=hashlib.sha256(data).hexdigest())
        self.assertTrue(any('footer SHA-1' in issue for issue in result['issues']))
        self.assertEqual(result['menu_functions_decoded'], 0)

    def test_selected_malformed_instruction_is_rejected(self):
        data = bundle_fixture((b'\xff',))
        (self.reference/'index.bundle').write_bytes(data)
        result = self.validate(bundle_hash=hashlib.sha256(data).hexdigest())
        self.assertTrue(any('cannot be decoded' in issue for issue in result['issues']))
        self.assertEqual(result['menu_functions_decoded'], 0)

    def test_empty_or_missing_evidence_does_not_silently_pass(self):
        for evidence in (None, [], [None], [{}]):
            with self.subTest(evidence=evidence):
                doc = copy.deepcopy(self.document)
                doc['rules'][0]['evidence'] = evidence
                self.assertTrue(self.validate(doc)['issues'])
        self.assertTrue(self.validate([])['issues'])
        self.assertTrue(self.validate({})['issues'])


if __name__ == '__main__':
    unittest.main()
