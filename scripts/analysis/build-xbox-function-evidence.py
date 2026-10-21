#!/usr/bin/env python3
"""Build a private, bounded Hermes v96 evidence index without executing code.

This is an instruction/literal/reference reader, not a semantic decompiler.
It distinguishes closure creation, generator bodies and direct calls. Register
provenance is deliberately limited to individual basic blocks. Original strings
and instruction details belong in ignored local storage, never a public bundle.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import struct


def sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


metadata_reader = sibling('inspect-hermes96')
opcode_reader = sibling('index-hermes96-code')
TOPICS = {
    'settings': r'Settings(Account|General|App|Subscription|Notification|Install|Audio|Accessibility|About|Library)|LibraryAndExtensions|SettingsTab|SettingsPage|SettingsModal',
    'product-details': r'ProductDetails|ProductDetail|navigateToProduct|DisplayProduct|ProductMedia|ProductScreenshots|ProductDescription|ProductContextMenu',
    'menus': r'ContextMenu|MenuItems|GameCard.*(Press|Click)|OnGameCard|ViewGameDetails',
    'library': r'LibraryTabs|LibraryGames|LibraryAllGames|LibraryProvider|PlayLater|PlayHistory|JumpBackIn',
    'home-gamepass': r'HomePage|HomeLayout|GamePassLayout|GamePassSpotlight|FeaturedCard|Collection.*(Layout|Channel)|fetch.*Collection',
    'remote-play': r'RemotePlay|XHome|ConsoleDevices|ConsoleStreaming|ConsoleConnect',
    'fullscreen': r'FullScreenExperience|FullScreenAsync|FullScreenSupported|GarrisonSetAsFullScreen',
    'controller': r'GamepadNavigation|GamepadButton|GamepadMapping|GamepadConnected|FocusManager|NavigationManager',
    'social-notifications': r'NotificationSettings|FriendsList|FriendRequests|NotificationFlyout|NotificationPanel|SocialPanel|PartyChat',
    'install-launch': r'ActiveInstallItem|AvailableItemMenu|InstallQueue|InstallOperation|LaunchGame|GameLaunch|InstallProgress',
    'gamebar': r'GameBar|Gamebar|XboxWidgets|SettingsWidget|GamingOverlay',
}


def opcode_tables(source):
    ops, _, _ = opcode_reader.read_opcodes(source)
    if not ops or len({name for name, _ in ops}) != len(ops):
        raise ValueError('Missing or duplicate opcode declarations')
    # An opcode can carry more than one StringID (CreateRegExp does).
    cleaned = re.sub(r'/\*.*?\*/|//[^\n]*', '', source, flags=re.S)
    refs = {}
    for kind in ('STRING', 'FUNCTION'):
        table = collections.defaultdict(list)
        for name, index in re.findall(r'OPERAND_' + kind + r'_ID\((\w+),\s*(\d+)\)', cleaned):
            table[name].append(int(index) - 1)
        refs[kind] = dict(table)
    return ops, refs


def decode_function(data, function, ops, refs, string_count, function_count):
    start, size = function['offset'], function['bytes']
    if start < 0 or size < 0 or start + size > len(data):
        raise ValueError('Function body is outside the bundle')
    cursor, end, rows = start, start + size, []
    while cursor < end:
        opcode = data[cursor]
        if opcode >= len(ops):
            raise ValueError(f'Unknown opcode {opcode} at {cursor}')
        name, types = ops[opcode]
        fmt = '<' + ''.join(opcode_reader.FORMATS[t] for t in types)
        width = 1 + struct.calcsize(fmt)
        if cursor + width > end:
            raise ValueError(f'Instruction crosses function boundary at {cursor}')
        args = struct.unpack_from(fmt, data, cursor + 1)
        row = {'offset': cursor - start, 'file_offset': cursor, 'opcode': name,
               'size': width, 'operands': list(args), 'types': types}
        for kind, limit, key in [('STRING', string_count, 'string_refs'), ('FUNCTION', function_count, 'function_refs')]:
            sites = []
            for operand in refs[kind].get(name, []):
                if operand >= len(args) or not 0 <= args[operand] < limit:
                    raise ValueError(f'Invalid {kind.lower()} reference at {cursor}')
                sites.append({'operand': operand + 1, 'id': args[operand]})
            if sites:
                row[key] = sites
        # Hermes Addr operands are relative to the opcode byte, not its end.
        row['jumps'] = [row['offset'] + args[i] for i, typ in enumerate(types) if typ.startswith('Addr')]
        rows.append(row)
        cursor += width
    return rows


def literal_sections(data, metadata):
    storage = metadata['sections']['string_storage']
    offset = storage['offset'] + storage['bytes']
    sections = {}
    for name, field in [('array', 'arrayBufferSize'), ('object-key', 'objKeyBufferSize'), ('object-value', 'objValueBufferSize')]:
        offset = (offset + 3) & ~3
        length = metadata['header'][field]
        if offset + length > len(data) - 20:
            raise ValueError(f'{name} literal buffer is outside the bundle')
        sections[name] = {'file_offset': offset, 'bytes': length, 'data': memoryview(data)[offset:offset + length]}
        offset += length
    return sections


def decode_literals(buffer, offset, count, string_count):
    """Decode only the requested literal count; all reads remain buffer-bounded."""
    if count < 0 or count > 65535 or offset < 0 or offset > len(buffer):
        raise ValueError('Invalid literal-buffer range')
    cursor, values = offset, []
    while len(values) < count:
        if cursor >= len(buffer):
            raise ValueError('Truncated literal tag')
        tag = buffer[cursor]; cursor += 1
        run = tag & 15
        if tag & 128:
            if cursor >= len(buffer):
                raise ValueError('Truncated long literal tag')
            run = (run << 8) | buffer[cursor]; cursor += 1
        if run == 0:
            raise ValueError('Zero-length literal run')
        kind = (tag >> 4) & 7
        # A shared prefix may use a run longer than the requested object/array.
        take = min(run, count - len(values))
        formats = {3: 'd', 4: 'I', 5: 'H', 6: 'B', 7: 'i'}
        fmt = formats.get(kind)
        width = struct.calcsize('<' + fmt) if fmt else 0
        if cursor + width * take > len(buffer):
            raise ValueError('Literal value crosses buffer boundary')
        for _ in range(take):
            at = cursor
            value = struct.unpack_from('<' + fmt, buffer, cursor)[0] if fmt else {0: None, 1: True, 2: False}[kind]
            cursor += width
            if kind in (4, 5, 6):
                if value >= string_count:
                    raise ValueError('Invalid literal string ID')
                values.append({'kind': 'string', 'id': value, 'buffer_offset': at})
            else:
                if isinstance(value, float) and not math.isfinite(value):
                    value = repr(value)
                values.append({'kind': 'number' if kind in (3, 7) else 'constant', 'value': value, 'buffer_offset': at})
    return values


def attach_literals(instructions, sections, string_count):
    for row in instructions:
        name, args = row['opcode'], row['operands']
        buffers = []
        if name in ('NewArrayWithBuffer', 'NewArrayWithBufferLong'):
            buffers = [('array', args[3])]
        elif name in ('NewObjectWithBuffer', 'NewObjectWithBufferLong'):
            buffers = [('object-key', args[3]), ('object-value', args[4])]
        if buffers:
            row['literals'] = {}
            for kind, offset in buffers:
                values = decode_literals(sections[kind]['data'], offset, args[2], string_count)
                row['literals'][kind] = values


def relation_kind(opcode):
    if opcode.startswith('CallDirect'):
        return 'direct_call'
    if opcode.startswith('CreateGeneratorClosure') or opcode.startswith('CreateAsyncClosure') or opcode.startswith('CreateClosure'):
        return 'closure'
    if opcode.startswith('CreateGenerator'):
        return 'generator_body'
    return 'code_reference'


def bytecode_payload_limits(data, metadata):
    """Bound appended tables by the next distinct body or information region."""
    file_limit = len(data) - 20
    first_info = metadata.get('header', {}).get('debugInfoOffset', file_limit)
    if 'function_headers' in metadata.get('sections', {}):
        for function in metadata['functions']:
            at = metadata['sections']['function_headers']['offset'] + function['id'] * 16
            if at + 16 > file_limit:
                raise ValueError('Small function header exceeds bundle bounds')
            w0, _, w2 = struct.unpack_from('<III', data, at)
            info = w2 & 0x1ffffff
            if data[at + 15] & 32:
                info = (w0 & 0xffff) | (info << 16)
            if info:
                first_info = min(first_info, info)
    offsets = sorted({function['offset'] for function in metadata['functions']})
    return {offset: min(first_info, offsets[index + 1] if index + 1 < len(offsets) else file_limit)
            for index, offset in enumerate(offsets)}


def switch_case_leaders(data, function, instructions, payload_limit):
    starts = {row['offset'] for row in instructions}
    leaders = set()
    for row in instructions:
        if row['opcode'] != 'SwitchImm':
            continue
        _, displacement, _, minimum, maximum = row['operands']
        if maximum < minimum:
            raise ValueError('SwitchImm maximum precedes minimum')
        count = maximum - minimum + 1
        table_at = (function['offset'] + row['offset'] + displacement + 3) & ~3
        body_end = (function['offset'] + function['bytes'] + 3) & ~3
        if table_at < body_end or not 0 <= table_at <= payload_limit <= len(data) - 20 or count > (payload_limit - table_at) // 4:
            raise ValueError('SwitchImm table exceeds its function payload')
        for index in range(count):
            target = row['offset'] + struct.unpack_from('<i', data, table_at + index * 4)[0]
            if target not in starts:
                raise ValueError('SwitchImm case target is not an instruction boundary')
            leaders.add(target)
    return leaders


def analyze_function(function, instructions, strings, extra_leaders=None):
    starts = {row['offset'] for row in instructions}
    leaders = {0} | set(extra_leaders or ())
    # A caller lacking table bytes must not infer provenance across unknown
    # switch case entries. The CLI/index always supply validated case leaders.
    unknown_switch_leaders = extra_leaders is None and any(row['opcode'] == 'SwitchImm' for row in instructions)
    jumps, errors = [], []
    for row in instructions:
        for target in row['jumps']:
            valid = target in starts
            jumps.append({'offset': row['offset'], 'target': target, 'valid': valid})
            if not valid:
                errors.append({'offset': row['offset'], 'target': target, 'error': 'Jump target is not an instruction boundary'})
            leaders.add(target)
        if row['opcode'] == 'Catch':
            leaders.add(row['offset'])
        if row['jumps'] or row['opcode'] in ('Ret', 'Throw', 'Unreachable', 'SwitchImm', 'SaveGenerator', 'ResumeGenerator'):
            leaders.add(row['offset'] + row['size'])
    registers, sites, relations, calls, bindings, registrations = {}, [], [], [], [], []
    literal_objects = []
    for row in instructions:
        at, name, args = row['offset'], row['opcode'], row['operands']
        if at in leaders or unknown_switch_leaders:
            registers.clear()
        for ref in row.get('string_refs', []):
            sites.append({'offset': at, 'file_offset': row['file_offset'], 'opcode': name,
                          'source': 'operand', 'operand': ref['operand'], 'string_id': ref['id']})
        for source, values in row.get('literals', {}).items():
            for index, value in enumerate(values):
                if value['kind'] == 'string':
                    sites.append({'offset': at, 'file_offset': row['file_offset'], 'opcode': name,
                                  'source': source, 'element': index, 'buffer_offset': value['buffer_offset'], 'string_id': value['id']})
        if 'object-key' in row.get('literals', {}):
            literal_objects.append({'offset': at, 'keys': row['literals']['object-key'], 'values': row['literals']['object-value']})
        for ref in row.get('function_refs', []):
            relations.append({'offset': at, 'target': ref['id'], 'kind': relation_kind(name), 'opcode': name})

        # Resolve call targets before the return register is overwritten.
        if name.startswith(('Call', 'Construct')) and not name.startswith(('CallDirect', 'CallBuiltin')):
            callee = registers.get(args[1])
            call = {'offset': at, 'opcode': name, 'callee_register': args[1], 'provenance': callee or {'kind': 'unknown'}}
            calls.append(call)
            if callee and callee['kind'] == 'function':
                relations.append({'offset': at, 'target': callee['id'], 'kind': 'local_closure_call', 'opcode': name})
            if name in ('Call1', 'Call2', 'Call3', 'Call4'):
                call['arguments'] = [registers.get(reg, {'kind': 'unknown'}) for reg in args[2:]]
            # This records a bytecode pattern, not proof that the module runs.
            if name == 'Call4' and callee and callee.get('property') == '__d':
                values = call['arguments']
                if values[1].get('kind') == 'function' and values[2].get('kind') == 'number' and values[3].get('kind') == 'array':
                    registrations.append({'offset': at, 'module_id': values[2]['value'], 'factory_function_id': values[1]['id'],
                                          'dependencies': values[3]['values'], 'confidence': 'constant_call4_pattern'})
        if name.startswith(('PutById', 'PutNewOwnById', 'PutNewOwnNEById', 'TryPutById')):
            value = registers.get(args[1])
            if value and value['kind'] == 'function' and row.get('string_refs'):
                bindings.append({'offset': at, 'property_string_id': row['string_refs'][0]['id'], 'target': value['id'], 'kind': 'property_closure_assignment'})

        # Explicit definitions are the only values allowed to survive locally.
        value = None
        if name in ('Mov', 'MovLong'):
            value = registers.get(args[1])
        elif name.startswith('Create') and relation_kind(name) == 'closure':
            value = {'kind': 'function', 'id': args[2]}
        elif name == 'GetGlobalObject':
            value = {'kind': 'global', 'path': 'global'}
        elif name in ('LoadParam', 'LoadParamLong'):
            value = {'kind': 'parameter', 'index': args[1], 'path': f'arg[{args[1]}]'}
        elif name == 'GetEnvironment':
            value = {'kind': 'environment', 'depth': args[1], 'path': f'env[{args[1]}]'}
        elif name in ('LoadFromEnvironment', 'LoadFromEnvironmentL'):
            base = registers.get(args[1], {})
            value = {'kind': 'environment_slot', 'slot': args[2], 'path': f"{base.get('path', '?env')}.slot[{args[2]}]"}
        elif name.startswith(('GetById', 'TryGetById')):
            base = registers.get(args[1], {})
            prop = strings[row['string_refs'][0]['id']]
            value = {'kind': 'property', 'property': prop, 'path': (base.get('path', f'r{args[1]}?') + '.' + prop)[-240:]}
        elif name == 'GetByVal':
            base, key = registers.get(args[1], {}), registers.get(args[2], {})
            if base.get('kind') == 'parameter' and key.get('kind') == 'number':
                value = {'kind': 'indexed_parameter', 'parameter_index': base['index'], 'index': key['value']}
        elif name in ('LoadConstString', 'LoadConstStringLongIndex'):
            value = {'kind': 'string', 'id': args[1]}
        elif name in ('LoadConstInt', 'LoadConstUInt8', 'LoadConstDouble'):
            value = {'kind': 'number', 'value': args[1] if math.isfinite(args[1]) else repr(args[1])}
        elif name == 'LoadConstZero':
            value = {'kind': 'number', 'value': 0}
        elif name in ('LoadConstUndefined', 'LoadConstNull', 'LoadConstTrue', 'LoadConstFalse'):
            value = {'kind': 'constant', 'value': name.removeprefix('LoadConst').lower()}
        elif 'array' in row.get('literals', {}):
            value = {'kind': 'array', 'values': row['literals']['array']}
        elif name == 'NewArray' and args[1] == 0:
            value = {'kind': 'array', 'values': []}
        if value is not None:
            registers[args[0]] = value
        elif args and row['types'][0].startswith('Reg') and not name.startswith(('Put', 'Store', 'TryPut', 'J', 'Ret', 'Throw', 'SaveGenerator', 'Profile')):
            registers.pop(args[0], None)
    return {'id': function['id'], 'name': function['name'], 'file_offset': function['offset'], 'bytes': function['bytes'],
            'instructions': len(instructions), 'string_sites': sites, 'function_relations': relations,
            'calls': calls, 'closure_bindings': bindings, 'object_literals': literal_objects,
            'jump_edges': jumps, 'jump_errors': errors, 'module_registration_patterns': registrations}


def index_bundle(data, metadata, source, output):
    output.mkdir(parents=True, exist_ok=True)
    ops, refs = opcode_tables(source)
    strings, functions = metadata['strings'], metadata['functions']
    sections = literal_sections(data, metadata)
    payload_limits = bytecode_payload_limits(data, metadata)
    topics = {key: {'function_ids': [], 'matched_string_ids': []} for key in TOPICS}
    patterns = {key: re.compile(pattern, re.I) for key, pattern in TOPICS.items()}
    string_topics = collections.defaultdict(set)
    for sid, value in enumerate(strings):
        for key, pattern in patterns.items():
            if pattern.search(value):
                string_topics[sid].add(key)
                topics[key]['matched_string_ids'].append(sid)
    counts = collections.Counter()
    histogram = collections.Counter()
    errors, registrations, dependency_calls = [], [], []
    factories = {}
    function_names = {f['id']: f['name'] for f in functions}
    with (output / 'function-evidence.jsonl').open('w') as stream:
        for function in functions:
            try:
                rows = decode_function(data, function, ops, refs, len(strings), len(functions))
                attach_literals(rows, sections, len(strings))
                case_leaders = switch_case_leaders(data, function, rows, payload_limits[function['offset']])
                report = analyze_function(function, rows, strings, case_leaders)
                matched = {key for key, pattern in patterns.items() if pattern.search(function['name'])}
                for site in report['string_sites']:
                    matched.update(string_topics[site['string_id']])
                    counts['string_sites_' + site['source']] += 1
                for key in sorted(matched):
                    topics[key]['function_ids'].append(function['id'])
                report['topics'] = sorted(matched)
                for relation in report['function_relations']:
                    counts['relations_' + relation['kind']] += 1
                counts.update({'functions': 1, 'instructions': len(rows), 'jump_edges': len(report['jump_edges']),
                               'jump_errors': len(report['jump_errors']), 'calls': len(report['calls']),
                               'calls_with_local_provenance': sum(c['provenance']['kind'] != 'unknown' for c in report['calls']),
                               'closure_bindings': len(report['closure_bindings']), 'object_literals': len(report['object_literals'])})
                histogram.update(row['opcode'] for row in rows)
                errors.extend({'function_id': function['id'], **err} for err in report['jump_errors'])
                registrations.extend({'function_id': function['id'], **reg} for reg in report['module_registration_patterns'])
                for reg in report['module_registration_patterns']:
                    factories[reg['factory_function_id']] = reg
                report['factory_dependency_call_patterns'] = []
                if function['id'] in factories:
                    factory = factories[function['id']]
                    for call in report['calls']:
                        callee, args = call['provenance'], call.get('arguments', [])
                        if callee.get('kind') != 'parameter' or callee.get('index') not in (2, 3, 4) or len(args) != 2:
                            continue
                        slot = args[1]
                        if slot.get('kind') != 'indexed_parameter' or slot.get('parameter_index') != 7:
                            continue
                        index = slot['index']
                        if not isinstance(index, int) or not 0 <= index < len(factory['dependencies']):
                            continue
                        dependency = factory['dependencies'][index]
                        if dependency.get('kind') != 'number':
                            continue
                        pattern = {'function_id': function['id'], 'offset': call['offset'], 'source_module': factory['module_id'],
                                   'dependency_slot': index, 'declared_target_module': dependency['value'],
                                   'parameter_role': {2: 'require', 3: 'importDefault', 4: 'importAll'}[callee['index']],
                                   'confidence': 'metro_factory_argument_pattern'}
                        report['factory_dependency_call_patterns'].append(pattern)
                        dependency_calls.append(pattern)
                stream.write(json.dumps(report, ensure_ascii=True, separators=(',', ':')) + '\n')
            except (ValueError, struct.error, KeyError) as error:
                errors.append({'function_id': function['id'], 'error': str(error)})
    # Declared dependencies are distinct from observed require calls.
    defined_modules = {reg['module_id'] for reg in registrations}
    dependency_edges = []
    for reg in registrations:
        for slot, value in enumerate(reg['dependencies']):
            if value['kind'] == 'number' and isinstance(value['value'], int):
                dependency_edges.append({'source_module': reg['module_id'], 'dependency_slot': slot,
                                         'target_module': value['value'], 'target_registered': value['value'] in defined_modules})
    jsonl_path = output / 'function-evidence.jsonl'
    with jsonl_path.open('rb') as stream:
        jsonl_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {'schema_version': 1, 'bundle_sha256': hashlib.sha256(data).hexdigest(),
              'function_evidence_jsonl_sha256': jsonl_hash, 'function_evidence_jsonl_bytes': jsonl_path.stat().st_size,
              'function_evidence_jsonl_rows': counts['functions'],
              'opcode_definition_sha256': hashlib.sha256(source.encode()).hexdigest(), 'bytecode_version': 96,
              'counts': dict(counts), 'opcodes_defined': len(ops), 'opcode_counts': dict(histogram),
              'errors': errors, 'topics': topics, 'function_names': function_names,
              'literal_sections': {key: {k: v for k, v in value.items() if k != 'data'} for key, value in sections.items()},
              'module_registration_patterns': registrations, 'declared_module_dependency_edges': dependency_edges,
              'factory_dependency_call_patterns': dependency_calls,
              'limitations': ['No original source recovery or native-machine-code decompilation.',
                              'Closure creation is not a call; generator body is not an immediate call.',
                              'Local provenance clears at basic-block boundaries; dynamic callees remain unresolved.',
                              'Module registration/dependency patterns do not prove executed imports or service behavior.',
                              'Switch case targets bound local provenance; full exception-range audit is a separate report.',
                              'Topic selection is a search aid, not a proof of feature reachability or complete semantics.']}
    (output / 'function-evidence.json').write_text(json.dumps(report, ensure_ascii=True, separators=(',', ':')))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--opcodes', type=Path, required=True)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--private-output', type=Path)
    parser.add_argument('--function', type=int, help='Print one annotated function as JSON; no index required')
    args = parser.parse_args()
    data, source = args.bundle.read_bytes(), args.opcodes.read_text()
    metadata = metadata_reader.inspect(data)
    if args.metadata and json.loads(args.metadata.read_text()) != metadata:
        parser.error('Metadata does not exactly match the bundle')
    if args.function is not None:
        if not 0 <= args.function < len(metadata['functions']):
            parser.error('Function ID is outside the function table')
        ops, refs = opcode_tables(source)
        function = metadata['functions'][args.function]
        rows = decode_function(data, function, ops, refs, len(metadata['strings']), len(metadata['functions']))
        attach_literals(rows, literal_sections(data, metadata), len(metadata['strings']))
        case_leaders = switch_case_leaders(data, function, rows, bytecode_payload_limits(data, metadata)[function['offset']])
        report = analyze_function(function, rows, metadata['strings'], case_leaders)
        for row in rows:
            for ref in row.get('string_refs', []):
                ref['value'] = metadata['strings'][ref['id']]
            for ref in row.get('function_refs', []):
                ref['name'] = metadata['functions'][ref['id']]['name']
        report['annotated_instructions'] = rows
        report['referenced_strings'] = {site['string_id']: metadata['strings'][site['string_id']] for site in report['string_sites']}
        print(json.dumps(report, ensure_ascii=True, indent=2))
    else:
        if not args.private_output:
            parser.error('--private-output is required when not querying --function')
        report = index_bundle(data, metadata, source, args.private_output)
        print(json.dumps({'counts': report['counts'], 'errors': len(report['errors']),
                          'module_registration_patterns': len(report['module_registration_patterns']),
                          'declared_module_dependency_edges': len(report['declared_module_dependency_edges']),
                          'output': str(args.private_output)}))
        if report['errors']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
