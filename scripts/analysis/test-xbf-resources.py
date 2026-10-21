"""Synthetic format checks; no Microsoft application or native UI is executed."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('xbf',Path(__file__).with_name('inspect-xbf-resources.py'))
xbf = importlib.util.module_from_spec(spec); spec.loader.exec_module(xbf)


def u32(value): return struct.pack('<I',value)
def u16(value): return struct.pack('<H',value)
def varuint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128); value >>= 7
    result.append(value)
    return bytes(result)
def vector(values): return u32(len(values)) + b''.join(values)
def text(value):
    encoded = value.encode('utf-16-le',errors='surrogatepass')
    return u32(len(encoded)//2) + encoded


def sample(nodes=b'\x01\x02',version=(2,1), strings=None, streams=None):
    strings = ['Assembly','Example','Widget','Width','urn:example'] if strings is None else strings
    tables = [vector([text(s)+(b'\0\0' if version==(2,1) else b'') for s in strings]),
        vector([u32(0)+u32(0)]),vector([u32(0)+u32(1)]),
        vector([u32(0)+u32(0)+u32(2)]),vector([u32(0)+u32(0)+u32(3)]),vector([u32(4)])]
    offsets = []; position = 120
    for table in tables:
        offsets.append(position); position += len(table)
    metadata = u32(version[0])+u32(version[1])+struct.pack('<6Q',*offsets)+bytes(64)+b''.join(tables)
    streams = [(nodes,b'')] if streams is None else streams
    offset = 0; substream_table = []
    for node_data,line_data in streams:
        substream_table.append(u32(offset)+u32(offset+len(node_data)))
        offset += len(node_data)+len(line_data)
    data = vector(substream_table)+b''.join(a+b for a,b in streams)
    return b'XBF\0'+u32(len(metadata))+u32(len(data))+metadata+data


TABLES = {'type':{20:'Grid'}, 'property':{10:'FrameworkElement_Width'}}


class XbfTests(unittest.TestCase):
    def test_metadata_and_v21_null_terminated_strings(self):
        report = xbf.inspect(sample())
        self.assertEqual(report['metadata']['version'],[2,1])
        self.assertEqual(report['metadata']['types'][0]['qualified_name'],'Example.Widget')
        self.assertEqual(report['metadata']['properties'][0]['qualified_name'],'Example.Widget.Width')
        self.assertEqual(report['decoded_nodes'],2)
        self.assertTrue(report['complete_stream_decode'])

    def test_v20_strings_have_no_terminator(self):
        self.assertEqual(xbf.inspect(sample(version=(2,0)))['metadata']['strings'][0],'Assembly')

    def test_supplementary_unicode_counts_code_units(self):
        strings = ['Assembly','Example','Widget','Width','urn:example','A\U0001f3aeB']
        self.assertEqual(xbf.inspect(sample(strings=strings))['metadata']['strings'][-1],strings[-1])

    def test_direct_property_and_typed_constant(self):
        nodes = b'\x14'+u16(32768|20)+b'\x1a'+u16(32768|10)+b'\x03'+struct.pack('<f',44)+b'\x21'
        result = xbf.inspect(sample(nodes),TABLES)['streams'][0]['nodes']
        self.assertEqual(result[0]['type']['name'],'Grid')
        self.assertEqual(result[1]['property']['name'],'FrameworkElement_Width')
        self.assertEqual(result[1]['value'],{'kind':'float','value':44.0})
        self.assertEqual(result[1]['stream_offset'],3)

    def test_shared_unique_and_enum_constant(self):
        nodes = (b'\x04\x05'+u16(2)+b'\x04\x09'+text('value')+
                 b'\x04\x0b'+u16(20)+u32(3))
        result = xbf.inspect(sample(nodes),TABLES)['streams'][0]['nodes']
        self.assertEqual([r['value']['value'] for r in result],['Widget','value',3])
        self.assertEqual(result[-1]['value']['type'],'Grid')

    def test_style_custom_setter(self):
        # node15, substream0, no legacy resources, Style_v2, one setter.
        nodes = b'\x0f\x00\x00\x00\x08\x01\x30'+u16(32768|10)+b'\x03'+struct.pack('<f',200)
        result = xbf.inspect(sample(nodes),TABLES)['streams'][0]['nodes'][0]
        self.assertEqual(result['custom']['setters'][0]['value']['value'],200)
        self.assertEqual(result['custom']['type'],'Style_v2')

    def test_visual_state_custom_block(self):
        state = u16(2)+b'\x00\x01\x01\x00'+bytes(4)
        group = u16(2)+b'\x01\x00'
        custom = b'\x05\x01\x00\x01'+state+b'\x01'+group+bytes(6)
        nodes = b'\x0f\x00\x00\x00'+custom
        report = xbf.inspect(sample(nodes))
        self.assertTrue(report['complete_stream_decode'])
        value = report['streams'][0]['nodes'][0]['custom']
        self.assertEqual(value['type'],'VisualStateGroupCollection_v5')
        self.assertEqual(value['states'][0]['name'],'Widget')
        self.assertEqual(value['states'][0]['setter_tokens'],[0])
        self.assertEqual(value['groups'][0]['name'],'Widget')

    def test_nonfinite_float_stays_explicit_json_data(self):
        report = xbf.inspect(sample(b'\x04\x03'+struct.pack('<f',float('nan'))))
        value = report['streams'][0]['nodes'][0]['value']['value']
        self.assertEqual(value,{'nonfinite_float':'nan'})

    def test_dictionary_resource_token_must_hit_node_boundary(self):
        # v3 dictionary with one explicit key -> stream1, node offset0.
        custom = b'\x0f\x01\x00\x00\x0a\x01'+u16(2)+b'\x00'+bytes(5)
        report = xbf.inspect(sample(streams=[(custom,b''),(b'\x01\x02',b'')]))
        self.assertTrue(report['complete_stream_decode'])
        self.assertEqual(report['resource_entries'][0]['key'],'Widget')
        self.assertEqual(report['resource_entries'][0]['target_node_index'],0)
        broken = custom[:8]+b'\x09'+custom[9:]
        with self.assertRaisesRegex(ValueError,'token'):
            xbf.inspect(sample(streams=[(broken,b''),(b'\x01\x02',b'')]))

    def test_line_stream_is_separate_and_bounded(self):
        report = xbf.inspect(sample(streams=[(b'\x01\x02',b'\x01\x02\x03')]))
        self.assertEqual(report['streams'][0]['line_deltas_uninterpreted'],[[1,2,3]])
        with self.assertRaisesRegex(ValueError,'Truncated'):
            xbf.inspect(sample(streams=[(b'\x01',b'\x80')]))

    def test_unknown_opcode_stops_instead_of_false_resynchronization(self):
        report = xbf.inspect(sample(b'\x01\xff\x02'))
        self.assertFalse(report['complete_stream_decode'])
        self.assertEqual(report['decoded_nodes'],1)
        self.assertIn('255',report['errors'][0]['error'])

    def test_unknown_stable_id_is_partial_not_invented_name(self):
        report = xbf.inspect(sample(b'\x14'+u16(32768|999)),TABLES)
        self.assertFalse(report['complete_stream_decode'])
        self.assertIn('999',report['errors'][0]['error'])

    def test_invalid_reference_is_not_accepted(self):
        report = xbf.inspect(sample(b'\x04\x05'+u16(999)))
        self.assertFalse(report['complete_stream_decode'])
        self.assertIn('outside table',report['errors'][0]['error'])

    def test_bad_magic_and_section_length(self):
        with self.assertRaisesRegex(ValueError,'magic'): xbf.inspect(b'NOPE'+sample()[4:])
        with self.assertRaisesRegex(ValueError,'section lengths'): xbf.inspect(sample()+b'\x00')

    def test_unsupported_version(self):
        data = bytearray(sample()); struct.pack_into('<I',data,16,2)
        with self.assertRaisesRegex(ValueError,'version'): xbf.inspect(data)

    def test_wrong_metadata_offsets(self):
        data = bytearray(sample()); struct.pack_into('<Q',data,20,119)
        with self.assertRaisesRegex(ValueError,'table offsets'): xbf.inspect(data)

    def test_wrong_string_terminator(self):
        data = bytearray(sample()); data[156] = 1
        with self.assertRaisesRegex(ValueError,'terminator'): xbf.inspect(data)

    def test_unbounded_vector_and_varint(self):
        with self.assertRaisesRegex(ValueError,'vector'): xbf.Reader(u32(1000001)).vector(lambda: 0)
        with self.assertRaisesRegex(ValueError,'uint32'): xbf.Reader(b'\xff'*5).varuint()

    def test_stable_tables_must_match_pinned_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in xbf.TABLE_HASHES: (root/name).write_text('wrong')
            with self.assertRaisesRegex(ValueError,'hash mismatch'): xbf.load_stable_tables(root)

    def test_package_summary_binds_exact_decoded_report_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); package = root/'example.msix'; output = root/'out'
            with zipfile.ZipFile(package,'w') as archive:
                archive.writestr('View.xbf',sample())
            with patch.object(xbf,'load_stable_tables',return_value={}):
                summary = xbf.inspect_package(package,output,root/'unused-source')
            entry = summary['resources'][0]; report = output/entry['report']
            self.assertEqual(entry['report_sha256'],xbf.digest(report.read_bytes()))
            self.assertNotEqual(entry['report_sha256'],entry['sha256'])
            report.write_bytes(report.read_bytes()+b' ')
            self.assertNotEqual(entry['report_sha256'],xbf.digest(report.read_bytes()))


if __name__ == '__main__': unittest.main()
