"""Synthetic safety/evidence tests; no downloaded package or Windows code runs."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('build-xbox-function-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)

SOURCE = '''
DEFINE_OPCODE_0(Unreachable)
DEFINE_OPCODE_2(LoadConstString, Reg8, UInt16)
OPERAND_STRING_ID(LoadConstString, 2)
DEFINE_OPCODE_3(CreateRegExp, Reg8, UInt16, UInt16)
OPERAND_STRING_ID(CreateRegExp, 2)
OPERAND_STRING_ID(CreateRegExp, 3)
DEFINE_OPCODE_3(CreateClosure, Reg8, Reg8, UInt16)
OPERAND_FUNCTION_ID(CreateClosure, 3)
DEFINE_OPCODE_3(CreateGenerator, Reg8, Reg8, UInt16)
OPERAND_FUNCTION_ID(CreateGenerator, 3)
DEFINE_OPCODE_3(CallDirect, Reg8, UInt8, UInt16)
OPERAND_FUNCTION_ID(CallDirect, 3)
DEFINE_OPCODE_3(Call1, Reg8, Reg8, Reg8)
DEFINE_OPCODE_4(Call2, Reg8, Reg8, Reg8, Reg8)
DEFINE_OPCODE_6(Call4, Reg8, Reg8, Reg8, Reg8, Reg8, Reg8)
DEFINE_OPCODE_2(Mov, Reg8, Reg8)
DEFINE_OPCODE_1(Ret, Reg8)
DEFINE_JUMP_1(Jmp)
DEFINE_OPCODE_1(Catch, Reg8)
DEFINE_OPCODE_2(LoadConstUInt8, Reg8, UInt8)
DEFINE_OPCODE_4(NewArrayWithBuffer, Reg8, UInt16, UInt16, UInt16)
DEFINE_OPCODE_5(NewObjectWithBuffer, Reg8, UInt16, UInt16, UInt16, UInt16)
DEFINE_OPCODE_4(GetById, Reg8, Reg8, UInt8, UInt16)
OPERAND_STRING_ID(GetById, 4)
DEFINE_OPCODE_4(PutById, Reg8, Reg8, UInt8, UInt16)
OPERAND_STRING_ID(PutById, 4)
DEFINE_OPCODE_1(GetGlobalObject, Reg8)
DEFINE_OPCODE_2(LoadParam, Reg8, UInt8)
DEFINE_OPCODE_3(GetByVal, Reg8, Reg8, Reg8)
DEFINE_OPCODE_5(SwitchImm, Reg8, UInt32, Addr32, UInt32, UInt32)
'''
OPS, REFS = evidence.opcode_tables(SOURCE)


def assemble(*instructions):
    data = bytearray()
    for name, *operands in instructions:
        opcode = next(i for i, (candidate, _) in enumerate(OPS) if candidate == name)
        types = OPS[opcode][1]
        data += bytes([opcode]) + struct.pack('<' + ''.join(evidence.opcode_reader.FORMATS[t] for t in types), *operands)
    return bytes(data)


def decode(data, strings=('one', 'two', '__d'), function_count=3):
    function = {'id': 0, 'name': 'fixture', 'offset': 0, 'bytes': len(data)}
    rows = evidence.decode_function(data, function, OPS, REFS, len(strings), function_count)
    return function, rows, evidence.analyze_function(function, rows, strings)


class Evidence(unittest.TestCase):
    def test_both_regex_string_operands_are_recorded_and_validated(self):
        _, rows, report = decode(assemble(('CreateRegExp', 0, 0, 1)))
        self.assertEqual(rows[0]['string_refs'], [{'operand': 2, 'id': 0}, {'operand': 3, 'id': 1}])
        self.assertEqual([site['string_id'] for site in report['string_sites']], [0, 1])
        with self.assertRaisesRegex(ValueError, 'Invalid string'):
            decode(assemble(('CreateRegExp', 0, 0, 7)))

    def test_invalid_function_reference_and_truncated_instruction_fail(self):
        with self.assertRaisesRegex(ValueError, 'Invalid function'):
            decode(assemble(('CreateClosure', 0, 0, 7)))
        with self.assertRaisesRegex(ValueError, 'crosses function boundary'):
            decode(assemble(('LoadConstString', 0, 1))[:-1])

    def test_relative_branch_uses_opcode_start_and_requires_boundary(self):
        _, _, valid = decode(assemble(('Jmp', 2), ('Ret', 0)))
        self.assertEqual(valid['jump_edges'], [{'offset': 0, 'target': 2, 'valid': True}])
        _, _, invalid = decode(assemble(('Jmp', 3), ('Ret', 0)))
        self.assertEqual(invalid['jump_errors'][0]['target'], 3)
        _, _, backward = decode(assemble(('Mov', 0, 0), ('Jmp', -3)))
        self.assertTrue(backward['jump_edges'][0]['valid'])

    def test_closure_creation_generator_and_direct_call_are_distinct(self):
        _, _, report = decode(assemble(('CreateClosure', 1, 0, 1), ('CreateGenerator', 2, 0, 2), ('CallDirect', 0, 0, 1)))
        self.assertEqual([r['kind'] for r in report['function_relations']], ['closure', 'generator_body', 'direct_call'])

    def test_call_resolves_only_live_local_closure_and_mov_alias(self):
        _, _, report = decode(assemble(('CreateClosure', 1, 0, 1), ('Mov', 2, 1), ('Call1', 0, 2, 0)))
        self.assertIn({'offset': 8, 'target': 1, 'kind': 'local_closure_call', 'opcode': 'Call1'}, report['function_relations'])
        _, _, report = decode(assemble(('CreateClosure', 1, 0, 1), ('LoadConstUInt8', 1, 2), ('Call1', 0, 1, 0)))
        self.assertNotIn('local_closure_call', [r['kind'] for r in report['function_relations']])

    def test_branch_and_exception_entry_discard_register_provenance(self):
        _, _, branch = decode(assemble(('CreateClosure', 1, 0, 1), ('Jmp', 2), ('Call1', 0, 1, 0)))
        self.assertEqual(branch['calls'][0]['provenance']['kind'], 'unknown')
        _, _, catch = decode(assemble(('CreateClosure', 1, 0, 1), ('Catch', 0), ('Call1', 0, 1, 0)))
        self.assertEqual(catch['calls'][0]['provenance']['kind'], 'unknown')

    def test_property_assigned_closure_is_binding_not_call(self):
        _, _, report = decode(assemble(('CreateClosure', 1, 0, 1), ('PutById', 0, 1, 0, 0)))
        self.assertEqual(report['closure_bindings'], [{'offset': 5, 'property_string_id': 0, 'target': 1, 'kind': 'property_closure_assignment'}])
        self.assertEqual(report['calls'], [])

    def test_literal_types_and_signed_integer(self):
        buffer = b'\x01\x11\x21\x31' + struct.pack('<d', 3.5) + b'\x41' + struct.pack('<I', 2) + b'\x51' + struct.pack('<H', 1) + b'\x61\x00\x71' + struct.pack('<i', -9)
        values = evidence.decode_literals(buffer, 0, 8, 3)
        self.assertEqual([v.get('value', v.get('id')) for v in values], [None, True, False, 3.5, 2, 1, 0, -9])

    def test_long_literal_tag_and_shared_prefix(self):
        self.assertEqual(len(evidence.decode_literals(b'\x90\x10', 0, 16, 0)), 16)
        self.assertEqual(len(evidence.decode_literals(b'\x1f', 0, 2, 0)), 2)

    def test_literal_bounds_and_reference_validation(self):
        for buffer, count, message in [(b'', 1, 'Truncated'), (b'\x80', 1, 'Truncated'), (b'\x00', 1, 'Zero-length'), (b'\x41\x00', 1, 'crosses buffer'), (b'\x61\x09', 1, 'Invalid literal string')]:
            with self.subTest(buffer=buffer):
                with self.assertRaisesRegex(ValueError, message):
                    evidence.decode_literals(buffer, 0, count, 3)

    def test_literal_sites_are_attached_to_instruction_and_buffer(self):
        function, rows, _ = decode(assemble(('NewObjectWithBuffer', 0, 1, 1, 0, 0)))
        sections = {'object-key': {'data': b'\x61\x00'}, 'object-value': {'data': b'\x61\x01'}}
        evidence.attach_literals(rows, sections, 3)
        report = evidence.analyze_function(function, rows, ('one', 'two', '__d'))
        self.assertEqual([(s['source'], s['string_id'], s['offset'], s['buffer_offset']) for s in report['string_sites']], [('object-key', 0, 0, 1), ('object-value', 1, 0, 1)])

    def test_module_registration_requires_constant_closure_id_and_dependencies(self):
        data = assemble(('GetGlobalObject', 0), ('GetById', 1, 0, 0, 2), ('CreateClosure', 2, 0, 1), ('LoadConstUInt8', 3, 7), ('NewArrayWithBuffer', 4, 1, 1, 0), ('Call4', 5, 1, 0, 2, 3, 4))
        function, rows, _ = decode(data)
        evidence.attach_literals(rows, {'array': {'data': b'\x71' + struct.pack('<i', 8)}}, 3)
        report = evidence.analyze_function(function, rows, ('one', 'two', '__d'))
        reg = report['module_registration_patterns'][0]
        self.assertEqual((reg['module_id'], reg['factory_function_id'], reg['dependencies'][0]['value']), (7, 1, 8))
        self.assertEqual(reg['confidence'], 'constant_call4_pattern')

    def test_indexed_parameter_pattern_does_not_invent_import_identity(self):
        _, _, report = decode(assemble(('LoadParam', 1, 7), ('LoadConstUInt8', 0, 3), ('GetByVal', 2, 1, 0), ('LoadParam', 1, 2), ('Call2', 0, 1, 0, 2)))
        self.assertEqual(report['calls'][0]['arguments'][1], {'kind': 'indexed_parameter', 'parameter_index': 7, 'index': 3})
        self.assertNotIn('target', report['calls'][0])

    def test_switch_case_entry_clears_alias_created_only_on_another_case(self):
        body = assemble(('SwitchImm', 0, 32, 30, 0, 1), ('CreateClosure', 1, 0, 1), ('Mov', 2, 1), ('Call1', 0, 2, 0), ('Ret', 0))
        self.assertEqual(len(body), 32)
        data = body + struct.pack('<ii', 18, 26) + bytes(20)
        function = {'id': 0, 'name': 'fixture', 'offset': 0, 'bytes': len(body)}
        rows = evidence.decode_function(data, function, OPS, REFS, 3, 2)
        legacy = evidence.analyze_function(function, rows, ('one', 'two', '__d'), extra_leaders=set())
        self.assertEqual(legacy['calls'][0]['provenance']['kind'], 'function')
        leaders = evidence.switch_case_leaders(data, function, rows, 40)
        self.assertEqual(leaders, {18, 26})
        fixed = evidence.analyze_function(function, rows, ('one', 'two', '__d'), leaders)
        self.assertEqual(fixed['calls'][0]['provenance']['kind'], 'unknown')
        conservative = evidence.analyze_function(function, rows, ('one', 'two', '__d'))
        self.assertEqual(conservative['calls'][0]['provenance']['kind'], 'unknown')

    def test_switch_case_resolver_rejects_payload_and_boundary_errors(self):
        body = assemble(('SwitchImm', 0, 20, 18, 0, 0), ('Ret', 0))
        data = body + struct.pack('<i', 19) + bytes(20)
        function = {'id': 0, 'name': 'fixture', 'offset': 0, 'bytes': len(body)}
        rows = evidence.decode_function(data, function, OPS, REFS, 3, 1)
        with self.assertRaisesRegex(ValueError, 'function payload'):
            evidence.switch_case_leaders(data, function, rows, 20)
        with self.assertRaisesRegex(ValueError, 'instruction boundary'):
            evidence.switch_case_leaders(data, function, rows, 24)

    def test_complete_index_keeps_declared_dependencies_separate_from_factory_calls(self):
        literals = b'\x71' + struct.pack('<i', 8)
        global_code = assemble(('GetGlobalObject', 0), ('GetById', 1, 0, 0, 2), ('CreateClosure', 2, 0, 1), ('LoadConstUInt8', 3, 7), ('NewArrayWithBuffer', 4, 1, 1, 0), ('Call4', 5, 1, 0, 2, 3, 4))
        factory_code = assemble(('LoadParam', 1, 7), ('LoadConstUInt8', 0, 0), ('GetByVal', 2, 1, 0), ('LoadParam', 1, 2), ('Call2', 0, 1, 0, 2))
        metadata = {'strings': ['one', 'two', '__d'], 'sections': {'string_storage': {'offset': 0, 'bytes': 0}},
                    'header': {'arrayBufferSize': len(literals), 'objKeyBufferSize': 0, 'objValueBufferSize': 0},
                    'functions': [{'id': 0, 'name': 'global', 'offset': 8, 'bytes': len(global_code)},
                                  {'id': 1, 'name': 'factory', 'offset': 8 + len(global_code), 'bytes': len(factory_code)}]}
        data = literals + bytes(3) + global_code + factory_code + bytes(20)
        with tempfile.TemporaryDirectory() as directory:
            result = evidence.index_bundle(data, metadata, SOURCE, Path(directory))
            raw = (Path(directory) / 'function-evidence.jsonl').read_bytes()
            self.assertEqual(result['function_evidence_jsonl_sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(result['function_evidence_jsonl_bytes'], len(raw))
            self.assertEqual(result['function_evidence_jsonl_rows'], len(raw.splitlines()))
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['counts']['functions'], 2)
        self.assertEqual(len(result['declared_module_dependency_edges']), 1)
        self.assertFalse(result['declared_module_dependency_edges'][0]['target_registered'])
        self.assertEqual(result['factory_dependency_call_patterns'][0]['declared_target_module'], 8)
        self.assertEqual(result['factory_dependency_call_patterns'][0]['parameter_role'], 'require')


if __name__ == '__main__':
    unittest.main()
