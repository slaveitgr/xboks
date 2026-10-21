#!/usr/bin/env python3
"""Bounded, static XBF 2.0/2.1 metadata and object-writer stream inspection.

Format evidence: microsoft/microsoft-ui-xaml at FORMAT_COMMIT, especially
XbfParser/WidgetSpinner and the native XamlBinaryFormatSubReader2. This reader
does not instantiate XAML objects, run code-behind or evaluate resources/bindings.
Decoded strings/nodes stay in private output; no original markup is published.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
import math
from pathlib import Path
import struct
import zipfile

FORMAT_COMMIT = 'a5d85af03fa5c3597856fc5d17efb167d68a076b'
TABLE_HASHES = {
    'StableXbfTypeIndexes.g.csv': '0330801752bb899f89fc0b868b6e6ac768e3ab197870da565c9f969cc2379321',
    'StableXbfPropertyIndexes.g.csv': '572d97f35a125c0c6381dec13a06e568bc5b3775e8dd0f4144460e9ff1c45127',
}
NODE_NAMES = dict(enumerate([
    'None', 'PushScope', 'PopScope', 'AddNamespace', 'PushConstant', 'PushResolvedType',
    'PushResolvedProperty', 'SetValue', 'AddToCollection', 'AddToDictionary',
    'AddToDictionaryWithKey', 'CheckPeerType', 'SetConnectionId', 'SetName',
    'GetResourcePropertyBag', 'SetCustomRuntimeData', 'SetResourceDictionaryItems',
    'SetDeferredProperty', 'PushScopeAddNamespace', 'PushScopeGetValue',
    'PushScopeCreateTypeBeginInit', 'PushScopeCreateTypeWithConstantBeginInit',
    'PushScopeCreateTypeWithTypeConvertedConstantBeginInit', 'CreateTypeBeginInit',
    'CreateTypeWithConstantBeginInit', 'CreateTypeWithTypeConvertedConstantBeginInit',
    'SetValueConstant', 'SetValueTypeConvertedConstant', 'SetValueTypeConvertedResolvedProperty',
    'SetValueTypeConvertedResolvedType', 'SetValueFromStaticResource',
    'SetValueFromTemplateBinding', 'SetValueFromMarkupExtension', 'EndInitPopScope',
    'ProvideStaticResourceValue', 'ProvideThemeResourceValue', 'SetValueFromThemeResource',
    'EndOfStream', 'BeginConditionalScope', 'EndConditionalScope', 'EndInitProvideValuePopScope']))
NODE_NAMES[139] = 'ProvideValue'
CUSTOM_NAMES = {1:'VisualStateGroupCollection_v2', 2:'Style_v1', 3:'VisualStateGroupCollection_v3',
    4:'VisualStateGroupCollection_v4', 5:'VisualStateGroupCollection_v5', 6:'DeferredElement_v2',
    7:'ResourceDictionary_v2', 8:'Style_v2', 9:'DeferredElement_v3', 10:'ResourceDictionary_v3',
    11:'Style_v3', 12:'ResourceDictionary_v4', 745:'DeferredElement_v1',
    371:'ResourceDictionary_v1', 420:'VisualStateGroupCollection_v1'}
MAX_FILE = 32 * 1024 * 1024
MAX_ITEMS = 1000000


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Reader:
    def __init__(self, data, start=0, end=None):
        self.data, self.pos, self.end = data, start, len(data) if end is None else end
        if not 0 <= start <= self.end <= len(data):
            raise ValueError('Invalid bounded reader region')

    def take(self, size):
        if size < 0 or self.pos + size > self.end:
            raise ValueError(f'Truncated XBF data at offset {self.pos}: need {size}')
        result = self.data[self.pos:self.pos+size]
        self.pos += size
        return result

    def number(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))[0]

    def u8(self): return self.number('B')
    def u16(self): return self.number('H')
    def u32(self): return self.number('I')
    def i32(self): return self.number('i')
    def u64(self): return self.number('Q')

    def f32(self):
        value = self.number('f')
        return value if math.isfinite(value) else {'nonfinite_float':str(value)}

    def varuint(self):
        value = 0
        for shift in range(0, 35, 7):
            byte = self.u8()
            if shift == 28 and byte > 15:
                raise ValueError('XBF 7-bit integer exceeds uint32')
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError('Unterminated XBF 7-bit integer')

    def vector(self, read, variable=False):
        count = self.varuint() if variable else self.u32()
        if count > MAX_ITEMS or count > self.end - self.pos:
            raise ValueError(f'Unbounded XBF vector count {count}')
        return [read() for _ in range(count)]

    def text(self):
        return self.take(self.u32() * 2).decode('utf-16-le', errors='surrogatepass')


def load_stable_tables(directory):
    result = {}
    for filename, expected in TABLE_HASHES.items():
        data = (directory / filename).read_bytes()
        if digest(data) != expected:
            raise ValueError(f'Stable XBF table hash mismatch: {filename}')
        rows = list(csv.reader(data.decode('utf-8-sig').splitlines()))
        result['type' if 'Type' in filename else 'property'] = {int(r[2]):r[0] for r in rows}
    return result


def at(values, index, label):
    if not 0 <= index < len(values):
        raise ValueError(f'{label} index {index} outside table of {len(values)}')
    return values[index]


def metadata(reader):
    start = reader.pos
    version = [reader.u32(), reader.u32()]
    if version not in ([2, 0], [2, 1]):
        raise ValueError(f'Unsupported XBF version {version}')
    offsets = [reader.u64() for _ in range(6)]
    header_hash = reader.take(64).hex()
    if offsets[0] != 120 or offsets != sorted(offsets) or start + offsets[-1] > reader.end:
        raise ValueError('Invalid XBF metadata table offsets')
    strings = []
    assemblies, namespaces, types, properties, xmlns = [], [], [], [], []
    def position(index):
        if reader.pos != start + offsets[index]:
            raise ValueError(f'XBF metadata table {index} offset mismatch')
    def text():
        value = reader.text()
        if version == [2, 1] and reader.u16() != 0:
            raise ValueError('XBF metadata string lacks null terminator')
        return value
    def string(): return at(strings, reader.u32(), 'string')
    position(0); strings = reader.vector(text)
    position(1); assemblies = reader.vector(lambda: {'provider_kind':reader.u32(), 'name':string()})
    position(2); namespaces = reader.vector(lambda: {'assembly':reader.u32(), 'name':string()})
    position(3); types = reader.vector(lambda: {'flags':reader.u32(), 'namespace':reader.u32(), 'name':string()})
    position(4); properties = reader.vector(lambda: {'flags':reader.u32(), 'declaring_type':reader.u32(), 'name':string()})
    position(5); xmlns = reader.vector(string)
    if reader.pos != reader.end:
        raise ValueError('Unconsumed XBF metadata bytes')
    for namespace in namespaces:
        at(assemblies, namespace['assembly'], 'assembly')
    for typ in types:
        if typ['flags'] & ~3:
            raise ValueError('Unknown persisted type flags')
        namespace = at(xmlns, typ['namespace'], 'XML namespace') if typ['flags'] & 2 else at(namespaces, typ['namespace'], 'type namespace')['name']
        clean_namespace = namespace.split('?')[0]
        typ['qualified_name'] = ('{' + clean_namespace + '}' + typ['name'] if '://' in clean_namespace
            else clean_namespace.removeprefix('using:') + '.' + typ['name'])
    for prop in properties:
        if prop['flags'] & ~31:
            raise ValueError('Unknown persisted property flags')
        prop['qualified_name'] = 'x:' + prop['name'] if prop['flags'] & 2 else at(types, prop['declaring_type'], 'declaring type')['qualified_name'] + '.' + prop['name']
    return {'version':version, 'header_hash_uninterpreted':header_hash, 'table_offsets':offsets,
            'strings':strings, 'assemblies':assemblies, 'type_namespaces':namespaces,
            'types':types, 'properties':properties, 'xml_namespaces':xmlns}


class NodeReader:
    def __init__(self, reader, meta, tables):
        self.r, self.meta, self.tables = reader, meta, tables

    def ref(self, kind):
        value = self.r.u16(); index = value & 32767
        trusted = bool(value & 32768)
        if trusted:
            name = self.tables.get(kind, {}).get(index)
            if name is None:
                raise ValueError(f'Unknown pinned stable {kind} ID {index}')
        else:
            name = at(self.meta['types' if kind == 'type' else 'properties'], index, kind)['qualified_name']
        return {'id':index, 'trusted_stable':trusted, 'name':name}

    def shared(self):
        return at(self.meta['strings'], self.r.u16() & 32767, 'shared string')

    def constant(self):
        tag = self.r.u8()
        if tag in (1, 2): return {'kind':'bool', 'value':tag == 2}
        if tag == 3: return {'kind':'float', 'value':self.r.f32()}
        if tag == 4: return {'kind':'signed', 'value':self.r.i32()}
        if tag == 5: return {'kind':'shared_string', 'value':self.shared()}
        if tag == 6: return {'kind':'thickness', 'value':[self.r.f32() for _ in range(4)]}
        if tag == 7: return {'kind':'grid_length', 'unit':self.r.u32(), 'value':self.r.f32()}
        if tag == 8: return {'kind':'argb', 'value':f'#{self.r.u32():08X}'}
        if tag == 9: return {'kind':'unique_string', 'value':self.r.text()}
        if tag == 10: return {'kind':'null_string', 'value':None}
        if tag == 11:
            index = self.r.u16()
            return {'kind':'enum', 'type_id':index, 'type':self.tables.get('type',{}).get(index), 'value':self.r.u32()}
        raise ValueError(f'Unsupported XBF constant type {tag}')

    def vec(self, read): return self.r.vector(read, variable=True)
    def predicate(self): return {'type':self.ref('type'), 'arguments':self.shared()}
    def conditional(self):
        return self.vec(lambda: {'token':self.r.varuint(), 'predicates':self.vec(self.predicate)})

    def custom(self):
        tag = self.r.varuint()
        result = {'type_id':tag, 'type':CUSTOM_NAMES.get(tag)}
        if tag in (2,8,11):
            def setter():
                flags = self.r.varuint(); item = {'flags':flags}
                if flags > 255: raise ValueError('Unknown style setter flags')
                if not flags & 64:
                    item['property'] = self.ref('property') if flags & 16 else {'name':self.shared(), 'declaring_type':self.ref('type')}
                if flags & 4: item['value'] = self.shared()
                elif flags & 32: item['value'] = self.constant()
                elif flags & (1|2|8|64): item['token'] = self.r.varuint()
                return item
            result['setters'] = self.vec(setter)
            if tag == 11: result['conditional_objects'] = self.conditional()
        elif tag in (6,9,745):
            result['name'] = self.shared()
            if tag != 745:
                result['non_deferred_properties'] = self.vec(lambda: {'property':self.ref('property'), 'value':self.constant()})
                if tag == 9: result['realize'] = bool(self.r.u8())
        elif tag in (7,10,12,371):
            def keyed(): return {'key':self.shared(), 'token':self.r.varuint()}
            if tag == 12:
                result['unified_resources'] = self.vec(lambda: {'key':self.shared(), 'hash_and_key_type':self.r.u64(), 'token':self.r.varuint()})
            else:
                result['explicit_resources'] = self.vec(keyed)
            result['resources_with_names'] = self.vec(self.shared)
            if tag != 12: result['implicit_resources'] = self.vec(keyed)
            if tag == 371: result['legacy_implicit_templates'] = self.vec(self.shared)
            if tag in (371,7): result['legacy_implicit_styles'] = self.vec(self.shared)
            if tag == 10:
                for kind in ('explicit','implicit'):
                    result['conditional_'+kind] = self.vec(lambda: {'key':self.shared(), 'tokens':self.vec(self.r.varuint)})
            if tag == 12:
                result['conditional_resources'] = self.vec(lambda: {'key':self.shared(), 'hash_and_key_type':self.r.u64(), 'tokens':self.vec(self.r.varuint)})
            if tag in (10,12): result['conditional_objects'] = self.conditional()
        elif tag in (1,3,4,5,420):
            result['state_to_group'] = self.vec(self.r.varuint)
            def state():
                item = {'name':self.shared(), 'storyboard_token':self.r.varuint(), 'has_storyboard':bool(self.r.u8())}
                if tag != 420:
                    item['setter_tokens'] = self.vec(self.r.varuint)
                    item['state_trigger_values'] = self.vec(lambda: self.vec(self.r.varuint))
                    if tag != 1:
                        item['extensible_trigger_tokens'] = self.vec(self.r.varuint)
                        item['trigger_collection_tokens'] = self.vec(self.r.varuint)
                        if tag == 5: item['static_trigger_tokens'] = self.vec(self.r.varuint)
                return item
            result['states'] = self.vec(state)
            result['groups'] = self.vec(lambda: {'name':self.shared(), 'dynamic_timelines':bool(self.r.u8()), 'token':self.r.varuint()})
            result['transitions'] = self.vec(lambda: {'to':self.shared(), 'from':self.shared(), 'token':self.r.varuint()})
            result['unexpected_tokens'] = bool(self.r.u8())
            result['transition_lookup'] = self.vec(lambda: [self.r.varuint() for _ in range(3)])
            result['default_transition_map'] = self.vec(self.r.varuint)
            result['entire_collection_token'] = self.r.varuint()
            if tag in (4,5): result['seen_names'] = self.vec(self.shared)
        else:
            raise ValueError(f'Unsupported custom runtime data type {tag}')
        return result

    def node(self):
        offset = self.r.pos; code = self.r.u8()
        item = {'file_offset':offset, 'opcode':code, 'operation':NODE_NAMES.get(code)}
        if code in (1,2,8,9,33,39,40,139): pass
        elif code in (3,18):
            index = self.r.u16() & 32767
            item.update(namespace=at(self.meta['xml_namespaces'],index,'XML namespace'), prefix=self.r.text())
        elif code in (4,10,12,13,14,34,35): item['value'] = self.constant()
        elif code in (7,19,32): item['property'] = self.ref('property')
        elif code == 11: item['peer_type'] = self.r.text()
        elif code == 17:
            item.update(property=self.ref('property'), substream=self.r.varuint())
            static, theme = self.r.varuint(), self.r.varuint()
            if static + theme > MAX_ITEMS: raise ValueError('Too many deferred resource refs')
            item['static_resources'] = [self.shared() for _ in range(static)]
            item['theme_resources'] = [self.shared() for _ in range(theme)]
        elif code == 15:
            item['substream'] = self.r.varuint()
            count = self.r.varuint() + self.r.varuint()
            if count > MAX_ITEMS: raise ValueError('Too many legacy custom refs')
            item['legacy_preresolved_refs'] = [self.r.u16() for _ in range(count)]
            item['custom'] = self.custom()
        elif code in (20,23): item['type'] = self.ref('type')
        elif code in (21,22,24,25): item.update(type=self.ref('type'), value=self.constant())
        elif code in (26,27,30,36): item.update(property=self.ref('property'), value=self.constant())
        elif code == 29: item.update(property=self.ref('property'), value_type=self.ref('type'))
        elif code in (28,31): item.update(property=self.ref('property'), value_property=self.ref('property'))
        elif code == 38: item['predicate'] = self.predicate()
        else: raise ValueError(f'Unsupported node opcode {code} at {offset}')
        item['bytes'] = self.r.pos - offset
        return item


def inspect(data, tables=None):
    if len(data) > MAX_FILE: raise ValueError('XBF file exceeds inspection limit')
    reader = Reader(data)
    if reader.take(4) != b'XBF\0': raise ValueError('Missing XBF magic')
    metadata_bytes, node_bytes = reader.u32(), reader.u32()
    if 12 + metadata_bytes + node_bytes != len(data): raise ValueError('XBF section lengths do not match file')
    meta_end = 12 + metadata_bytes
    meta = metadata(Reader(data,12,meta_end))
    reader = Reader(data,meta_end)
    substreams = reader.vector(lambda: [reader.u32(),reader.u32()])
    if not substreams or substreams[0][0] != 0: raise ValueError('Missing/invalid XBF substream table')
    streams_start = reader.pos
    streams, errors, histogram = [], [], Counter()
    for index,(node_start,line_start) in enumerate(substreams):
        end = substreams[index+1][0] if index+1 < len(substreams) else len(data)-streams_start
        if not 0 <= node_start <= line_start <= end <= len(data)-streams_start: raise ValueError('Invalid substream offsets')
        node_reader = NodeReader(Reader(data,streams_start+node_start,streams_start+line_start), meta, tables or {})
        nodes = []
        while node_reader.r.pos < node_reader.r.end:
            offset = node_reader.r.pos
            try:
                node = node_reader.node(); node['stream_offset'] = offset - streams_start - node_start
                nodes.append(node); histogram[node['operation']] += 1
            except ValueError as error:
                errors.append({'stream':index,'file_offset':offset,'error':str(error)})
                break
        lines = Reader(data,streams_start+line_start,streams_start+end)
        line_entries = []
        while lines.pos < lines.end:
            line_entries.append([lines.varuint() for _ in range(3)])
        streams.append({'index':index,'node_start':streams_start+node_start,'node_bytes':line_start-node_start,
            'line_bytes':end-line_start,'nodes':nodes,'line_deltas_uninterpreted':line_entries,
            'complete':not any(e['stream']==index for e in errors)})
    resource_entries = []
    for stream in streams:
        for node in stream['nodes']:
            if 'substream' in node and node['substream'] >= len(streams): raise ValueError('Deferred/custom substream index outside table')
            custom = node.get('custom',{})
            if custom.get('type_id') in (7,10,12,371):
                target = streams[node['substream']]
                offsets = {n['stream_offset']:i for i,n in enumerate(target['nodes'])}
                for category in ('explicit_resources','implicit_resources','unified_resources'):
                    for entry in custom.get(category,[]):
                        if target['complete'] and entry['token'] not in offsets:
                            raise ValueError('Resource token is not a decoded node boundary')
                        resource_entries.append({'key':entry['key'],'category':category,
                            'owner_file_offset':node['file_offset'],'target_stream':node['substream'],
                            'target_offset':entry['token'],'target_node_index':offsets.get(entry['token']),
                            'target_file_offset':target['node_start']+entry['token']})
    return {'schema_version':1,'sha256':digest(data),'bytes':len(data),'metadata_bytes':metadata_bytes,
        'nodestream_bytes':node_bytes,'metadata':meta,'streams':streams,'node_counts':dict(histogram),
        'decoded_nodes':sum(histogram.values()),'resource_entries':resource_entries,
        'errors':errors,'complete_stream_decode':not errors,
        'scope':'Decoded persisted object-writer operations, not rendered UI or executed code-behind. Stable IDs are resolved using pinned official source; resource/binding evaluation and template application are not performed.'}


def inspect_package(package, output, format_source):
    tables = load_stable_tables(format_source)
    output.mkdir(parents=True,exist_ok=True)
    reports = []
    with zipfile.ZipFile(package) as archive:
        names = [entry.filename for entry in archive.infolist() if entry.filename.lower().endswith('.xbf')]
        if len(names) != len(set(names)): raise ValueError('Duplicate XBF archive members')
        for index,name in enumerate(names):
            entry = archive.getinfo(name)
            if entry.file_size > MAX_FILE: raise ValueError('XBF archive member exceeds inspection limit')
            report = inspect(archive.read(entry),tables); report['archive_member'] = name
            filename = f'{index:02d}-{Path(name).name}.json'
            report_bytes = (json.dumps(report,ensure_ascii=True,indent=2)+'\n').encode('utf-8')
            (output/filename).write_bytes(report_bytes)
            reports.append({'member':name,'report':filename,'sha256':report['sha256'],'bytes':report['bytes'],
                'report_sha256':digest(report_bytes),
                'version':report['metadata']['version'],'strings':len(report['metadata']['strings']),
                'types':len(report['metadata']['types']),'properties':len(report['metadata']['properties']),
                'substreams':len(report['streams']),'decoded_nodes':report['decoded_nodes'],
                'complete_stream_decode':report['complete_stream_decode'],'errors':report['errors']})
    with Path(package).open('rb') as stream:
        package_sha256 = hashlib.file_digest(stream,'sha256').hexdigest()
    summary = {'schema_version':1,'package_sha256':package_sha256,
        'format_repository':'https://github.com/microsoft/microsoft-ui-xaml','format_commit':FORMAT_COMMIT,
        'stable_table_hashes':TABLE_HASHES,'resources':reports,
        'scope':'Static XBF metadata and node decoding. No native runtime, render tree or complete application flow is recovered.'}
    (output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=Path)
    parser.add_argument('--format-source',type=Path,default=Path('work/reference/library/xbf/source'))
    parser.add_argument('--output',type=Path,default=Path('work/reference/library/xbf'))
    args = parser.parse_args()
    result = inspect_package(args.package,args.output,args.format_source)
    print(json.dumps({'resources':len(result['resources']), 'decoded_nodes':sum(v['decoded_nodes'] for v in result['resources']),
        'complete':all(v['complete_stream_decode'] for v in result['resources']), 'output':str(args.output)},indent=2))
    if any(v['errors'] for v in result['resources']): raise SystemExit(1)
