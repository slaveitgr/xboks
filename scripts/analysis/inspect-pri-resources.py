#!/usr/bin/env python3
"""Read supported Microsoft MRT Core PRI structures statically and bounded.

Format authority: WindowsAppSDK commit 0cf06784786e1e18d25099ca1d2e3dbeefce677e,
dev/MRTCore/mrt/mrm/{include/mrm/common/file,mrmmin}. No Windows/package code
is executed. This is not a printable-string scan or a Windows qualifier resolver.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import struct
import zipfile

SOURCE_COMMIT = '0cf06784786e1e18d25099ca1d2e3dbeefce677e'
SOURCE_ROOT = f'https://github.com/microsoft/WindowsAppSDK/tree/{SOURCE_COMMIT}/dev/MRTCore/mrt/mrm'
QUALIFIERS = ['Language', 'Contrast', 'Scale', 'HomeRegion', 'TargetSize', 'LayoutDirection', 'Theme', 'AlternateForm', 'DXFeatureLevel', 'Configuration', 'DeviceFamily', 'Custom']
VALUE_TYPES = {0: ('utf-16-le', 'string'), 1: ('utf-16-le', 'path'), 2: (None, 'embedded'),
               3: ('ascii', 'string'), 4: ('utf-8', 'string'), 5: ('ascii', 'path'), 6: ('utf-8', 'path')}


class Unsupported(ValueError):
    pass


class Reader:
    def __init__(self, data, base=0):
        self.data, self.base, self.position = data, base, 0

    def take(self, count):
        if count < 0 or self.position > len(self.data) or count > len(self.data) - self.position:
            raise ValueError(f'Read exceeds section bounds at {self.base + self.position}')
        start = self.position
        self.position += count
        return self.data[start:self.position]

    def read(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))

    def array(self, fmt, count):
        size = struct.calcsize('<' + fmt)
        raw = self.take(count * size)
        return list(struct.iter_unpack('<' + fmt, raw))

    def align(self, alignment=4):
        self.take((-self.position) % alignment)


def sliced(data, offset, size):
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ValueError('Referenced data exceeds its owning buffer')
    return data[offset:offset + size]


def terminated(data, offset, encoding, units=None):
    width = 2 if encoding == 'utf-16-le' else 1
    at = offset * width
    if units is not None:
        raw = sliced(data, at, (units + 1) * width)
        if raw[-width:] != bytes(width):
            raise ValueError('Referenced name lacks its declared terminator')
        return raw[:-width].decode(encoding, errors='strict')
    if at < 0 or at >= len(data):
        raise ValueError('Literal string offset exceeds its pool')
    end = at
    while end + width <= len(data):
        if data[end:end + width] == bytes(width):
            return data[at:end].decode(encoding, errors='strict')
        end += width
    raise ValueError('Referenced literal lacks a bounded terminator')


def fixed_utf16(reader, count):
    raw = reader.take(count * 2)
    if count < 1 or raw[-2:] != b'\0\0':
        raise ValueError('Schema identity lacks its declared UTF-16 terminator')
    value = raw[:-2].decode('utf-16-le', errors='strict')
    if '\0' in value:
        raise ValueError('Schema identity has an embedded terminator')
    return value


def container(data):
    reader = Reader(data)
    magic, major, minor, total, toc, base, count, descriptor, pad = reader.read('8sHHIIIhhI')
    if magic not in (b'mrm_pri0', b'mrm_pri1', b'mrm_pri2') or (major, minor) != (0, 1):
        raise Unsupported('Unsupported PRI magic or container version')
    if total != len(data) or pad or count < 0 or toc < 32 or base < toc + count * 32 or base > total - 16:
        raise ValueError('Invalid PRI length, TOC, data offset or reserved fields')
    marker, trailer_total, trailer_magic = struct.unpack('<II8s', sliced(data, total - 16, 16))
    if marker != 0xdefffade or trailer_total != total or trailer_magic != magic:
        raise ValueError('Invalid PRI file trailer')
    sections, spans = [], []
    for index in range(count):
        typ, flags, section_flags, qualifier, offset, size = struct.unpack('<16sHHIII', sliced(data, toc + index * 32, 32))
        at = base + offset
        if size < 40 or at < base or at + size > total - 16 or at % 8:
            raise ValueError('Invalid PRI section bounds/alignment')
        raw = sliced(data, at, size)
        actual_type, actual_q, actual_flags, actual_sflags, actual_size, reserved = struct.unpack_from('<16sIHHII', raw)
        if (typ, qualifier, flags, section_flags, size, 0) != (actual_type, actual_q, actual_flags, actual_sflags, actual_size, reserved):
            raise ValueError('Section TOC/header mismatch')
        end_marker, end_size = struct.unpack_from('<II', raw, size - 8)
        if end_marker != 0xdef5fade or end_size != size:
            raise ValueError('Invalid PRI section trailer')
        spans.append((at, at + size))
        sections.append({'index': index, 'type': typ.rstrip(b'\0 ').decode('ascii'), 'file_offset': at,
                         'bytes': size, 'qualifier': qualifier, 'flags': flags, 'section_flags': section_flags,
                         'payload_offset': at + 32, 'payload': raw[32:-8]})
    for previous, following in zip(sorted(spans), sorted(spans)[1:]):
        if previous[1] > following[0]:
            raise ValueError('Overlapping PRI sections')
    return {'magic': magic.decode(), 'major': major, 'minor': minor, 'bytes': total,
            'descriptor_index': descriptor, 'sections': sections}


def hnames(data, extended):
    reader = Reader(data)
    longest, flags, nodes_count, scopes_count, items_count, wide_count, total = reader.read('HH5I')
    ascii_count = reader.read('I')[0] if extended else 0
    if flags & 1:
        raise Unsupported('Large hierarchical-name nodes are not implemented')
    if total > len(data) or nodes_count < scopes_count + items_count:
        raise ValueError('Invalid hierarchical-name counts/size')
    nodes = reader.array('HHHBBHH', nodes_count)
    scopes = reader.array('4H', scopes_count)
    items = [x[0] for x in reader.array('H', items_count)]
    wide, ascii_pool = reader.take(wide_count * 2), reader.take(ascii_count)
    if reader.position > total:
        raise ValueError('Hierarchical names exceed their declared total size')
    if not nodes or nodes[0][0] != 0 or nodes[0][1] != 0:
        raise ValueError('Hierarchical names lack a valid logical root')
    names = []
    for node_index, (parent, length, initial, count, node_flags, low, payload) in enumerate(nodes):
        if parent >= nodes_count:
            raise ValueError('Invalid parent-node reference')
        offset = ((node_flags & 15) << 16) | low
        offset |= 0x100000 if node_flags & 0x40 else 0
        offset |= 0x200000 if node_flags & 0x80 else 0
        ascii_name = bool(node_flags & 0x20)
        # The logical root has no name and may reference an absent wide pool.
        name = '' if node_index == 0 and count == 0 and length == 0 else terminated(ascii_pool if ascii_name else wide, offset, 'ascii' if ascii_name else 'utf-16-le', count)
        names.append(name)
    paths = {}

    def path(index):
        chain, seen, current = [], set(), index
        while current not in paths:
            if current in seen:
                raise ValueError('Cycle in hierarchical resource names')
            seen.add(current); chain.append(current)
            if current == 0:
                paths[0] = ''
                break
            current = nodes[current][0]
        for node_index in reversed(chain):
            if node_index == 0:
                continue
            parent_path = paths[nodes[node_index][0]]
            paths[node_index] = (parent_path + '/' if parent_path else '') + names[node_index]
            if len(paths[node_index].encode('utf-16-le')) // 2 != nodes[node_index][1]:
                raise ValueError('Full resource path length differs from its node header')
        return paths[index]

    for index, scope in enumerate(scopes):
        node, children, first, _ = scope
        if node >= nodes_count or first + children > nodes_count or not nodes[node][4] & 0x10 or nodes[node][6] != index:
            raise ValueError('Invalid hierarchical scope/node references')
        if any(nodes[child][0] != node for child in range(first, first + children)):
            raise ValueError('Scope child range refers to another parent node')
    result = []
    for index, node in enumerate(items):
        if node >= nodes_count or nodes[node][4] & 0x10 or nodes[node][6] != index:
            raise ValueError('Invalid hierarchical item/node references')
        result.append(path(node))
    return {'num_nodes': nodes_count, 'num_scopes': scopes_count, 'items': result}


def schema(section):
    if not section['payload']:
        return None  # A resource pack can intentionally carry an empty schema.
    reader = Reader(section['payload'], section['payload_offset'])
    count, unique_length, simple_length, pad = reader.read('4H')
    extended = section['type'] == '[mrm_hschemaex]'
    names_type = reader.read('16s')[0].rstrip(b'\0 ') if extended else b'[def_hnames]'
    if names_type not in (b'[def_hnames]', b'[def_hnamesx]'):
        raise Unsupported('Unknown hierarchical name section type')
    versions = reader.array('HH4I', count)
    unique = fixed_utf16(reader, unique_length)
    simple = fixed_utf16(reader, simple_length)
    reader.align()
    names = hnames(reader.take(len(reader.data) - reader.position), names_type == b'[def_hnamesx]')
    if not versions or not unique or not simple:
        raise ValueError('Schema has no version or identity')
    return {'section_index': section['index'], 'unique_id': unique, 'simple_id': simple,
            'versions': [list(x) for x in versions], **names}


def schema_reference(data):
    reader = Reader(data)
    version = list(reader.read('HH4I'))
    length, flags, scopes_pool, items_pool = reader.read('HHii')
    unique = fixed_utf16(reader, length)
    return {'unique_id': unique, 'version': version, 'flags': flags, 'scopes_pool': scopes_pool, 'items_pool': items_pool}


def decisions(section):
    reader = Reader(section['payload'], section['payload_offset'])
    base_count, qualifier_count, set_count, decision_count, reference_count, literal_count = reader.read('6H')
    decision_rows = reader.array('HH', decision_count)
    sets = reader.array('HH', set_count)
    qualifiers = reader.array('4H', qualifier_count)
    bases = reader.array('4HI', base_count)
    references = [x[0] for x in reader.array('H', reference_count)]
    literals = reader.take(literal_count * 2)
    decoded_bases = []
    for pool, attribute, op_pool, operator, offset in bases:
        value = terminated(literals, offset, 'utf-16-le')
        decoded_bases.append({'attribute_atom': [pool, attribute], 'attribute': QUALIFIERS[attribute] if pool == 2 and attribute < len(QUALIFIERS) else None,
                              'operator_atom': [op_pool, operator], 'value': value})
    decoded_qualifiers = []
    for base, priority, fallback, pad in qualifiers:
        if base >= len(decoded_bases):
            raise ValueError('Qualifier base index is outside its table')
        decoded_qualifiers.append({**decoded_bases[base], 'priority': priority, 'fallback_score': fallback})
    decoded_sets = []
    for first, count in sets:
        if first + count > len(references):
            raise ValueError('Qualifier-set references exceed their table')
        indices = references[first:first + count]
        if any(index >= len(decoded_qualifiers) for index in indices):
            raise ValueError('Qualifier-set refers to an unknown qualifier')
        decoded_sets.append([decoded_qualifiers[index] for index in indices])
    decoded_decisions = []
    for first, count in decision_rows:
        if first + count > len(references):
            raise ValueError('Decision references exceed their table')
        indices = references[first:first + count]
        if any(index >= len(decoded_sets) for index in indices):
            raise ValueError('Decision refers to an unknown qualifier set')
        decoded_decisions.append(indices)
    return {'qualifiers': decoded_qualifiers, 'sets': decoded_sets, 'decisions': decoded_decisions}


def data_items(section):
    reader = Reader(section['payload'], section['payload_offset'])
    flags, small, large, size = reader.read('IHHI')
    if flags & 1:
        large |= flags & 0x00ff0000
    small_items = reader.array('HH', small)
    large_items = reader.array('II', large)
    base = reader.position
    data = reader.take(size)
    items = []
    for offset, length in small_items + large_items:
        sliced(data, offset, length)
        items.append({'offset': offset, 'bytes': length, 'file_offset': section['payload_offset'] + base + offset})
    return {'data': data, 'items': items}


def descriptor(section, sections):
    reader = Reader(section['payload'], section['payload_offset'])
    flags, included, environments, schemas, decisions_count, maps, primary, files, data_count, pad = reader.read('Hh4Hh3H')
    groups = {}
    for label, count in [('environments', environments), ('schemas', schemas), ('decisions', decisions_count),
                         ('resource_maps', maps), ('referenced_files', files), ('data_items', data_count)]:
        indices = [x[0] for x in reader.array('h', count)]
        if any(index < 0 or index >= len(sections) for index in indices):
            raise ValueError('PRI descriptor section reference exceeds the TOC')
        groups[label] = indices
    if pad or included < -1 or included >= len(sections) or primary < -1 or primary >= len(sections):
        raise ValueError('PRI descriptor has invalid reserved/section fields')
    return {'section_index': section['index'], 'flags': flags, 'included_files_section_index': included,
            'primary_resource_map': primary, **groups}


def resource_map(section):
    reader = Reader(section['payload'], section['payload_offset'])
    env_size, env_count, schema_index, schema_size, decision_index, type_count, dir_count, range_count, item_count, flags, value_count, internal_size, large_size = reader.read('HHhHh5H3I')
    if env_size or env_count:
        raise Unsupported('Explicit resource-map environment remapping is not implemented')
    reference = schema_reference(reader.take(schema_size)) if schema_size else None
    types = reader.array('ii', type_count)
    dirs = reader.array('HH', dir_count)
    ranges = reader.array('HH', range_count)
    items = reader.array('HH', item_count)
    if large_size:
        raise Unsupported('Large resource-map directory/item extensions are not implemented')
    values_at = reader.position
    value_width = 10 if flags & 1 else 8
    raw_values = reader.take(value_count * value_width)
    internal_at = reader.position
    internal = reader.take(internal_size)
    values = []
    for index in range(value_count):
        if flags & 1:
            locator, typ, detail, data1, data2, data3 = struct.unpack_from('<BB4H', raw_values, index * value_width)
        else:
            locator, typ, detail, data1, data2 = struct.unpack_from('<BB3H', raw_values, index * value_width); data3 = 0
        if typ >= len(types):
            raise ValueError('Candidate resource-type index exceeds its table')
        values.append({'index': index, 'file_offset': section['payload_offset'] + values_at + index * value_width,
                       'locator': locator, 'type_atom': list(types[typ]), 'detail': detail,
                       'data1': data1, 'data2': data2, 'data3': data3})
    return {'schema_section_index': schema_index, 'schema_reference': reference, 'decision_section_index': decision_index,
            'dirs': dirs, 'ranges': ranges, 'items': items, 'values': values, 'internal': internal,
            'internal_file_offset': section['payload_offset'] + internal_at}


def resource_indices(mapping):
    found = {}
    for resource_index, offset in mapping['dirs']:
        if offset < len(mapping['ranges']):
            count, first = mapping['ranges'][offset]
        else:
            count, first = 1, offset - len(mapping['ranges'])
        if first + count > len(mapping['items']):
            raise ValueError('Map directory/range refers outside its item table')
        for step in range(count):
            if resource_index + step in found:
                raise ValueError('Overlapping resource-map directory ranges')
            found[resource_index + step] = mapping['items'][first + step]
    return found


def candidate_value(value, mapping, data_sections):
    locator, detail, data1, data2, data3 = (value[k] for k in ['locator', 'detail', 'data1', 'data2', 'data3'])
    if locator == 0:
        offset = data1 | (data2 << 16)
        raw = sliced(mapping['internal'], offset, detail)
        at = mapping['internal_file_offset'] + offset
    elif locator == 1:
        if detail != 0:
            raise Unsupported('Candidate refers to an external file index')
        item_index = data1 | (data3 << 16)
        if data2 not in data_sections or item_index >= len(data_sections[data2]['items']):
            raise ValueError('Candidate data-item reference exceeds its target table')
        data = data_sections[data2]; item = data['items'][item_index]
        raw = sliced(data['data'], item['offset'], item['bytes']); at = item['file_offset']
    else:
        raise Unsupported(f'Unsupported candidate locator {locator}')
    type_pool, type_index = value['type_atom']
    if type_pool != 4 or type_index not in VALUE_TYPES:
        raise Unsupported('Unknown candidate resource-value type atom')
    encoding, kind = VALUE_TYPES[type_index]
    result = {'kind': kind, 'value_file_offset': at, 'value_bytes': len(raw)}
    if encoding is None:
        return {**result, 'sha256': hashlib.sha256(raw).hexdigest()}
    width = 2 if encoding == 'utf-16-le' else 1
    if len(raw) < width or len(raw) % width or raw[-width:] != bytes(width):
        raise ValueError('String/path candidate is not terminated in its declared encoding')
    text = raw[:-width].decode(encoding, errors='strict')
    if '\0' in text:
        raise ValueError('String/path candidate has an embedded terminator')
    return {**result, 'encoding': encoding, 'value': text}


def read_input(path):
    if path.suffix.lower() == '.pri':
        yield str(path), None, path.read_bytes()
    else:
        with zipfile.ZipFile(path) as package:
            for entry in package.infolist():
                if entry.filename.lower().endswith('.pri'):
                    if entry.file_size > 64 * 1024 * 1024:
                        raise ValueError('PRI package entry exceeds the analysis size bound')
                    yield str(path), entry.filename, package.read(entry)


def inspect_inputs(inputs):
    reports, loaded, all_schemas = [], [], []
    for path in inputs:
        for origin, entry, data in read_input(path):
            report = {'input': origin, 'package_entry': entry, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                      'sections': [], 'schemas': [], 'decision_sections': [], 'descriptor_sections': [], 'unsupported': [], 'errors': [], 'resources': []}
            try:
                parsed = container(data)
            except (ValueError, struct.error, UnicodeError) as error:
                report['errors'].append(str(error)); reports.append(report); continue
            report['magic'] = parsed['magic']
            schema_sections, decision_sections, data_sections = {}, {}, {}
            for section in parsed['sections']:
                report['sections'].append({k: v for k, v in section.items() if k != 'payload'})
                try:
                    if section['type'] in ('[mrm_hschema]', '[mrm_hschemaex]'):
                        value = schema(section)
                        if value:
                            schema_sections[section['index']] = value
                            all_schemas.append((report['sha256'], value))
                            report['schemas'].append(value)
                    elif section['type'] == '[mrm_decn_info]':
                        value = decisions(section); decision_sections[section['index']] = value
                        report['decision_sections'].append({'section_index': section['index'], **value})
                    elif section['type'] == '[mrm_dataitem]':
                        data_sections[section['index']] = data_items(section)
                    elif section['type'] == '[mrm_pridescex]':
                        report['descriptor_sections'].append(descriptor(section, parsed['sections']))
                    elif section['type'] != '[mrm_res_map2_]':
                        report['unsupported'].append({'section_index': section['index'], 'reason': 'Section semantics not decoded: ' + section['type']})
                except Unsupported as error:
                    report['unsupported'].append({'section_index': section['index'], 'reason': str(error)})
                except (ValueError, struct.error, UnicodeError) as error:
                    report['errors'].append({'section_index': section['index'], 'error': str(error)})
            report['data_item_count'] = sum(len(x['items']) for x in data_sections.values())
            loaded.append((report, parsed, schema_sections, decision_sections, data_sections))
            reports.append(report)
    for report, parsed, schemas, decision_sections, data_sections in loaded:
        for section in parsed['sections']:
            if section['type'] != '[mrm_res_map2_]':
                continue
            try:
                mapping = resource_map(section)
                if mapping['schema_reference']:
                    ref = mapping['schema_reference']
                    matches = [(sha, value) for sha, value in all_schemas if value['unique_id'].casefold() == ref['unique_id'].casefold() and ref['version'] in value['versions']]
                    if not matches:
                        raise Unsupported('No supplied schema matches the pack identity/version/checksum reference')
                    schema_sha, selected_schema = matches[0]
                else:
                    schema_sha, selected_schema = report['sha256'], schemas.get(mapping['schema_section_index'])
                    if selected_schema is None:
                        raise Unsupported('Resource map has no decoded referenced schema')
                if mapping['decision_section_index'] not in decision_sections:
                    raise Unsupported('Resource map has no decoded referenced decisions')
                decision = decision_sections[mapping['decision_section_index']]
                indices = resource_indices(mapping)
                map_summary = {'section_index': section['index'], 'resource_entries': len(indices),
                    'candidate_values': len(mapping['values']), 'schema_sha256': schema_sha,
                    'schema_unique_id': selected_schema['unique_id'], 'schema_section_index': selected_schema['section_index']}
                report.setdefault('resource_maps', []).append(map_summary)
                referenced_candidates = set()
                for index, (decision_index, first) in sorted(indices.items()):
                    if index >= len(selected_schema['items']) or decision_index >= len(decision['decisions']):
                        raise ValueError('Resource name or decision reference exceeds its table')
                    sets = decision['decisions'][decision_index]
                    if first + len(sets) > len(mapping['values']):
                        raise ValueError('Resource candidate range exceeds its table')
                    resource = {'map_section_index': section['index'], 'resource_index': index,
                                'key': selected_schema['items'][index], 'decision_index': decision_index, 'candidates': []}
                    for number, set_index in enumerate(sets):
                        value = mapping['values'][first + number]
                        referenced_candidates.add(value['index'])
                        candidate = {'candidate_index': number, 'map_value_index': value['index'], 'candidate_file_offset': value['file_offset'],
                                     'qualifier_set_index': set_index, 'qualifiers': decision['sets'][set_index], 'type_atom': value['type_atom']}
                        try:
                            candidate.update(candidate_value(value, mapping, data_sections))
                        except Unsupported as error:
                            candidate['unsupported'] = str(error)
                        resource['candidates'].append(candidate)
                    report['resources'].append(resource)
                map_summary['referenced_candidate_values'] = len(referenced_candidates)
                map_summary['unreferenced_candidate_values'] = len(mapping['values']) - len(referenced_candidates)
            except Unsupported as error:
                report['unsupported'].append({'section_index': section['index'], 'reason': str(error)})
            except (ValueError, struct.error, UnicodeError) as error:
                report['errors'].append({'section_index': section['index'], 'error': str(error)})
    return reports


def write_reports(reports, directory):
    directory.mkdir(parents=True, exist_ok=True)
    resources_path = directory / 'resources.jsonl'
    counts = collections.Counter()
    with resources_path.open('w') as stream:
        for report in reports:
            counts.update({'pri_files': 1, 'sections': len(report['sections']), 'schema_items': sum(len(x['items']) for x in report['schemas']),
                           'resource_entries': len(report['resources']), 'errors': len(report['errors']), 'unsupported_sections': len(report['unsupported'])})
            for resource in report['resources']:
                counts['candidates'] += len(resource['candidates'])
                for candidate in resource['candidates']:
                    counts['unsupported_candidates' if 'unsupported' in candidate else 'decoded_' + candidate['kind']] += 1
                stream.write(json.dumps({'pri_sha256': report['sha256'], **resource}, ensure_ascii=True, separators=(',', ':')) + '\n')
    with resources_path.open('rb') as stream:
        raw_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    summary = {'schema_version': 1, 'format_source': SOURCE_ROOT, 'format_source_commit': SOURCE_COMMIT,
               'resources_jsonl_sha256': raw_hash, 'resources_jsonl_bytes': resources_path.stat().st_size,
               'resources_jsonl_rows': counts['resource_entries'],
               'counts': dict(counts), 'inputs': [{key: value for key, value in report.items() if key != 'resources'} for report in reports],
               'limitations': ['No Windows qualifier ranking/fallback resolver or runtime reachability is implemented.',
                               'Descriptor/environment activation, resource links, large name/map extensions and external-file candidates are not fully implemented.',
                               'Paths are package-relative resource values, not proof of Linux files or visible UI placement.',
                               'Original names/localized text and binary-resource hashes remain in private ignored storage.']}
    (directory / 'summary.json').write_text(json.dumps(summary, ensure_ascii=True, separators=(',', ':')))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', type=Path, nargs='+', help='PRI files or local MSIX/APPX ZIP packages')
    parser.add_argument('--private-output', type=Path, required=True)
    args = parser.parse_args()
    summary = write_reports(inspect_inputs(args.inputs), args.private_output)
    print(json.dumps({'counts': summary['counts'], 'output': str(args.private_output)}))
    if summary['counts'].get('errors'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
