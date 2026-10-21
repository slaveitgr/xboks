import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('signatures',Path(__file__).with_name('inspect-winmd-signatures.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Signatures(unittest.TestCase):
 def test_instance_method_return_and_parameters(self):
  r=m.Reader(bytes.fromhex('200201080e'));value=r.method();r.done()
  self.assertTrue(value['has_this']);self.assertEqual(value['return']['name'],'void')
  self.assertEqual([v['name'] for v in value['parameters']],['int32','string'])
 def test_generic_async_result(self):
  r=m.Reader(bytes.fromhex('2000151205011209'));value=r.method();r.done()
  self.assertEqual(value['return']['kind'],'genericinst')
  self.assertEqual(value['return']['base']['coded_index'],5)
  self.assertEqual(value['return']['arguments'][0]['type']['coded_index'],9)
 def test_byref_array_and_parameter_kind(self):
  r=m.Reader(bytes.fromhex('101d08'));value=r.type();r.done()
  self.assertEqual(value['kind'],'byref');self.assertEqual(value['element']['kind'],'szarray')
 def test_generic_parameter_not_concrete_type(self):
  r=m.Reader(bytes.fromhex('1e02'));self.assertEqual(r.type(),{'kind':'method_parameter','index':2});r.done()
 def test_required_modifier_retained(self):
  r=m.Reader(bytes.fromhex('1f0508'));value=r.type();r.done()
  self.assertEqual(value['kind'],'required_modifier');self.assertEqual(value['element']['name'],'int32')
 def test_signed_array_lower_bound(self):
  r=m.Reader(bytes.fromhex('1408020105017b'));value=r.type();r.done()
  self.assertEqual(value['rank'],2);self.assertEqual(value['sizes'],[5]);self.assertEqual(value['lower_bounds'],[-3])
 def test_zero_rank_array_rejected(self):
  with self.assertRaisesRegex(ValueError,'rank'):m.Reader(bytes.fromhex('1408000000')).type()
 def test_compressed_uint_widths(self):
  for data,value in [(b'\x7f',127),(b'\x80\x80',128),(b'\xc0\x00\x40\x00',16384)]:
   r=m.Reader(data);self.assertEqual(r.uint(),value);r.done()
 def test_invalid_compressed_integer_rejected(self):
  with self.assertRaisesRegex(ValueError,'prefix'):m.Reader(b'\xff').uint()
 def test_truncated_operand_rejected(self):
  with self.assertRaisesRegex(ValueError,'Truncated'):m.Reader(b'\xc0').uint()
 def test_trailing_bytes_rejected(self):
  r=m.Reader(b'\x08\x08');r.type()
  with self.assertRaisesRegex(ValueError,'Trailing'):r.done()
 def test_unsupported_element_rejected(self):
  with self.assertRaisesRegex(ValueError,'Unsupported'):m.Reader(b'\x7f').type()
 def test_constants_preserve_signedness_and_utf16(self):
  self.assertEqual(m.decode_constant(8,b'\xff\xff\xff\xff'),-1)
  self.assertEqual(m.decode_constant(9,b'\xff\xff\xff\xff'),4294967295)
  self.assertEqual(m.decode_constant(14,'γειά'.encode('utf-16-le')),'γειά')
 def test_invalid_constant_width_rejected(self):
  with self.assertRaisesRegex(ValueError,'width'):m.decode_constant(8,b'\0')

if __name__=='__main__':unittest.main()
