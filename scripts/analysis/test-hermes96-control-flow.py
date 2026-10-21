"""Synthetic tests for bounded v96 control-flow structures; no package needed."""
import importlib.util
from pathlib import Path
import struct
import unittest


spec = importlib.util.spec_from_file_location('control', Path(__file__).with_name('audit-hermes96-control-flow.py'))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


def small_header(data, *, body=160, size=4, info=200, flags=8):
    struct.pack_into('<III', data, 128, body | (2 << 25), size | (1 << 15), info | (7 << 25))
    data[140:144] = bytes([3, 4, 5, flags])


def exception_fixture(entries=((0, 4, 4), (2, 6, 4))):
    data = bytearray(256)
    header = {'has_exception_handler': True, 'info_at': 201, 'bytes': 6}
    struct.pack_into('<I', data, 204, len(entries))
    for index, entry in enumerate(entries):
        struct.pack_into('<III', data, 208 + index * 12, *entry)
    return data, header, {0, 2, 4}, {0: 'Mov', 2: 'Ret', 4: 'Catch'}


class ControlFlow(unittest.TestCase):
    def test_small_header_decodes_flags_info_and_frame(self):
        data = bytearray(256); small_header(data)
        header = control.function_header(data, 0, len(data))
        self.assertEqual((header['offset'], header['bytes'], header['name_id'], header['parameters']), (160, 4, 1, 2))
        self.assertEqual((header['frame_size'], header['environment_size'], header['read_cache'], header['write_cache']), (7, 3, 4, 5))
        self.assertTrue(header['has_exception_handler'])
        self.assertEqual(header['info_at'], 200)

    def test_overflow_header_is_packed_31_bytes_before_aligned_info(self):
        data = bytearray(512); large_at = 240
        struct.pack_into('<III', data, 128, large_at & 0xffff, 0, (large_at >> 16))
        data[143] = 0x2e
        struct.pack_into('<7I3B', data, large_at, 160, 2, 4, 1, large_at, 300, 700, 6, 7, 0x0e)
        header = control.function_header(data, 0, len(data))
        self.assertEqual(control.LARGE_HEADER_SIZE, 31)
        self.assertEqual(header['info_at'], large_at + 31)
        self.assertEqual(control.align4(header['info_at']), 272)
        self.assertEqual((header['frame_size'], header['environment_size']), (300, 700))

    def test_overflow_header_bounds_and_flag_disagreement_are_rejected(self):
        data = bytearray(256)
        struct.pack_into('<III', data, 128, 240, 0, 0); data[143] = 0x28
        with self.assertRaisesRegex(ValueError, 'Large function header'):
            control.function_header(data, 0, len(data))
        data = bytearray(512)
        struct.pack_into('<III', data, 128, 240, 0, 0); data[143] = 0x28
        struct.pack_into('<7I3B', data, 240, 160, 1, 4, 0, 240, 1, 1, 0, 0, 0)
        with self.assertRaisesRegex(ValueError, 'flags disagree'):
            control.function_header(data, 0, len(data))

    def test_switch_aligns_absolute_address_and_uses_signed_relative_targets(self):
        data = bytearray(256)
        function = {'offset': 161, 'bytes': 24}
        instruction = {'offset': 3, 'operands': [0, 21, 7, 5, 6]}
        struct.pack_into('<ii', data, 188, -3, 17)
        result = control.audit_switch(data, function, instruction, {0, 3, 10, 20}, 196)
        self.assertEqual(result['table_file_offset'], 188)
        self.assertEqual(result['default_target'], 10)
        self.assertEqual([(c['value'], c['target']) for c in result['cases']], [(5, 0), (6, 20)])

    def test_switch_cannot_cross_into_next_function_payload(self):
        data = bytearray(256)
        with self.assertRaisesRegex(ValueError, 'bounded region'):
            control.audit_switch(data, {'offset': 161, 'bytes': 24}, {'offset': 3, 'operands': [0, 21, 7, 5, 6]}, {3, 10}, 192)

    def test_switch_table_must_follow_bytecode_and_range_must_be_ordered(self):
        data = bytearray(256); function = {'offset': 160, 'bytes': 24}
        with self.assertRaisesRegex(ValueError, 'after its function'):
            control.audit_switch(data, function, {'offset': 0, 'operands': [0, 0, 0, 0, 0]}, {0}, 256)
        with self.assertRaisesRegex(ValueError, 'maximum precedes'):
            control.audit_switch(data, function, {'offset': 0, 'operands': [0, 24, 0, 5, 4]}, {0}, 256)

    def test_switch_default_and_each_case_require_instruction_boundaries(self):
        data = bytearray(256); function = {'offset': 160, 'bytes': 24}
        struct.pack_into('<i', data, 184, 3)
        with self.assertRaisesRegex(ValueError, 'default'):
            control.audit_switch(data, function, {'offset': 0, 'operands': [0, 24, 1, 0, 0]}, {0, 3}, 188)
        with self.assertRaisesRegex(ValueError, 'case 0'):
            control.audit_switch(data, function, {'offset': 0, 'operands': [0, 24, 0, 0, 0]}, {0, 4}, 188)

    def test_exception_order_ranges_end_at_function_end_and_targets_are_retained(self):
        data, header, starts, opcodes = exception_fixture()
        result = control.audit_exceptions(data, header, starts, opcodes, 232)
        self.assertEqual(result['range_semantics'], '[start,end)')
        self.assertEqual([(e['start'], e['end'], e['target']) for e in result['entries']], [(0, 4, 4), (2, 6, 4)])
        self.assertEqual(result['entries'][0]['target_opcode'], 'Catch')

    def test_exception_table_count_cannot_read_following_info(self):
        data, header, starts, opcodes = exception_fixture()
        with self.assertRaisesRegex(ValueError, 'Exception table entries'):
            control.audit_exceptions(data, header, starts, opcodes, 231)

    def test_exception_range_and_target_errors_are_explicit(self):
        for entry, message in [((0, 0, 4), 'non-empty'), ((0, 7, 4), 'non-empty'), ((1, 4, 4), 'endpoint'), ((0, 3, 4), 'endpoint'), ((0, 4, 5), 'target')]:
            with self.subTest(entry=entry):
                data, header, starts, opcodes = exception_fixture((entry,))
                with self.assertRaisesRegex(ValueError, message):
                    control.audit_exceptions(data, header, starts, opcodes, 232)

    def test_unflagged_function_does_not_read_info_as_exception_table(self):
        self.assertIsNone(control.audit_exceptions(b'', {'has_exception_handler': False}, set(), {}, 0))

    def test_complete_audit_rechecks_headers_and_instruction_targets(self):
        # A two-instruction Catch/Ret body and one handler covering the body.
        source = 'DEFINE_OPCODE_1(Catch, Reg8)\nDEFINE_OPCODE_1(Ret, Reg8)'
        data = bytearray(276); small_header(data, info=200)
        data[160:164] = bytes([0, 0, 1, 0])
        struct.pack_into('<4I', data, 200, 1, 0, 4, 0)
        metadata = {'header': {'debugInfoOffset': 240}, 'strings': ['x', 'fixture'],
                    'functions': [{'id': 0, 'name': 'fixture', 'offset': 160, 'bytes': 4, 'parameters': 2}]}
        report = control.audit(data, metadata, source)
        self.assertEqual(report['errors'], [])
        self.assertEqual(report['counts']['exception_entries'], 1)
        metadata['functions'][0]['bytes'] = 3
        with self.assertRaisesRegex(ValueError, 'freshly parsed metadata'):
            control.audit(data, metadata, source)


if __name__ == '__main__':
    unittest.main()
