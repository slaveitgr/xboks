"""Synthetic fixtures for static readers; no Microsoft package is required."""
import hashlib
import importlib.util
from pathlib import Path
import struct
import unittest


def load(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hermes = load('inspect-hermes96')
code = load('index-hermes96-code')
pe = load('inspect-pe-metadata')


def fixture():
    # One named function and one UTF-16 string, one instruction body.
    name = b'test'
    wide = 'γειά'.encode('utf-16-le')
    storage = name + wide
    body_offset = (128 + 16 + 4 + 4 + 8 + len(storage) + 3) & ~3
    data = bytearray(body_offset + 1)
    struct.pack_into('<QI', data, 0, 0x1F1903C103BC1FC6, 96)
    fields = dict.fromkeys(hermes.FIELDS, 0)
    fields.update(fileLength=len(data) + 20, functionCount=1, stringKindCount=1,
                  identifierCount=1, stringCount=2, stringStorageSize=len(storage), debugInfoOffset=len(data))
    struct.pack_into('<19I', data, 32, *[fields[k] for k in hermes.FIELDS])
    struct.pack_into('<III', data, 128, body_offset, 1, 0)
    struct.pack_into('<II', data, 152, len(name) << 24, 1 | len(name) << 1 | (len(wide) // 2) << 24)
    data[160:160 + len(storage)] = storage
    return bytes(data) + hashlib.sha1(data).digest()


class Inspection(unittest.TestCase):
    def test_valid_bounded_strings_and_function(self):
        result = hermes.inspect(fixture())
        self.assertEqual(result['strings'], ['test', 'γειά'])
        self.assertEqual(result['functions'][0]['name'], 'test')
        self.assertTrue(result['footer_sha1_matches'])

    def test_wrong_version_is_rejected(self):
        data = bytearray(fixture()); struct.pack_into('<I', data, 8, 97)
        with self.assertRaisesRegex(ValueError, 'v96'): hermes.inspect(data)

    def test_corruption_is_rejected(self):
        data = bytearray(fixture()); data[160] ^= 1
        with self.assertRaisesRegex(ValueError, 'SHA-1'): hermes.inspect(data)

    def test_bad_string_bounds_are_rejected_even_with_valid_checksum(self):
        data = bytearray(fixture()[:-20]); struct.pack_into('<I', data, 152, (255 << 1) | (5 << 24))
        data += hashlib.sha1(data).digest()
        with self.assertRaisesRegex(ValueError, 'outside storage'): hermes.inspect(data)

    def test_instruction_index_is_bounded(self):
        data = fixture(); meta = hermes.inspect(data)
        result = code.index_code(data, meta, 'DEFINE_OPCODE_0(Unreachable)')
        self.assertEqual(result['functions_indexed'], 1)
        self.assertEqual(result['instructions'], 1)
        self.assertFalse(result['errors'])

    def test_jump_expansion_order(self):
        ops, _, _ = code.read_opcodes('DEFINE_OPCODE_0(Unreachable)\nDEFINE_JUMP_2(JmpTrue)')
        self.assertEqual(ops[1:], [('JmpTrue', ['Addr8', 'Reg8']), ('JmpTrueLong', ['Addr32', 'Reg8'])])

    def test_truncated_instruction_reports_error(self):
        data = fixture(); meta = hermes.inspect(data)
        result = code.index_code(data, meta, 'DEFINE_OPCODE_1(InvalidForFixture, UInt32)')
        self.assertTrue(result['errors'])

    def test_non_pe_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'MZ'): pe.inspect(b'not a PE file')


if __name__ == '__main__': unittest.main()
