#!/usr/bin/env python3
"""Audit Hermes v96 switch/exception structures without executing the bundle.

Pinned format: facebook/hermes v0.13.0 BytecodeFileFormat.h,
BytecodeDataProvider.cpp and Interpreter.cpp. This checks encoded edges and
boundaries, not a complete semantic control-flow graph.
"""
import argparse
import bisect
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import struct


def sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


evidence = sibling('build-xbox-function-evidence')
LARGE_HEADER_SIZE = struct.calcsize('<7I3B')  # Packed v96 FunctionHeader: 31 bytes.


def align4(value):
    return (value + 3) & ~3


def bounded(data, start, length, limit, description):
    if start < 0 or length < 0 or start > limit or length > limit - start or limit > len(data):
        raise ValueError(description + ' exceeds its bounded region')


def function_header(data, function_id, file_limit):
    small_at = 128 + function_id * 16
    bounded(data, small_at, 16, file_limit, 'Small function header')
    w0, w1, w2 = struct.unpack_from('<III', data, small_at)
    flags = data[small_at + 15]
    large = bool(flags & 0x20)
    info_at = w2 & 0x1ffffff
    if large:
        large_at = (w0 & 0xffff) | (info_at << 16)
        bounded(data, large_at, LARGE_HEADER_SIZE, file_limit, 'Large function header')
        values = struct.unpack_from('<7I3B', data, large_at)
        start, params, size, name, info_at, frame, environment, read_cache, write_cache, large_flags = values
        if (flags & 0x1f) != (large_flags & 0x1f):
            raise ValueError('Small/large function flags disagree')
        # The provider skips the packed header; it does not follow info_at again.
        info_at = large_at + LARGE_HEADER_SIZE
        info_region_start = large_at
    else:
        start, params, size, name = w0 & 0x1ffffff, w0 >> 25, w1 & 0x7fff, w1 >> 15
        frame, environment = w2 >> 25, data[small_at + 12]
        read_cache, write_cache = data[small_at + 13], data[small_at + 14]
        info_region_start = info_at
    bounded(data, start, size, file_limit, 'Function body')
    return {'id': function_id, 'offset': start, 'bytes': size, 'name_id': name, 'parameters': params,
            'frame_size': frame, 'environment_size': environment, 'flags': flags,
            'has_exception_handler': bool(flags & 8), 'has_debug_info': bool(flags & 16),
            'large_header': large, 'info_at': info_at, 'info_region_start': info_region_start,
            'read_cache': read_cache, 'write_cache': write_cache}


def audit_switch(data, function, instruction, starts, payload_limit):
    at, args = instruction['offset'], instruction['operands']
    if len(args) != 5:
        raise ValueError('Unsupported SwitchImm operand layout')
    _, displacement, default, minimum, maximum = args
    if maximum < minimum:
        raise ValueError('SwitchImm maximum precedes minimum')
    count = maximum - minimum + 1
    opcode_at = function['offset'] + at
    table_at = align4(opcode_at + displacement)
    if table_at < align4(function['offset'] + function['bytes']):
        raise ValueError('SwitchImm table is not after its function bytecode')
    bounded(data, table_at, count * 4, payload_limit, 'SwitchImm table')
    default_target = at + default
    if default_target not in starts:
        raise ValueError('SwitchImm default is not an instruction boundary')
    cases = []
    for index in range(count):
        entry_at = table_at + index * 4
        relative = struct.unpack_from('<i', data, entry_at)[0]
        target = at + relative
        if target not in starts:
            raise ValueError(f'SwitchImm case {minimum + index} is not an instruction boundary')
        cases.append({'value': minimum + index, 'entry_file_offset': entry_at,
                      'relative_offset': relative, 'target': target})
    return {'offset': at, 'file_offset': opcode_at, 'table_file_offset': table_at,
            'table_bytes': count * 4, 'minimum': minimum, 'maximum': maximum,
            'default_target': default_target, 'cases': cases}


def audit_exceptions(data, header, starts, opcodes_at, info_limit):
    if not header['has_exception_handler']:
        return None
    table_at = align4(header['info_at'])
    bounded(data, table_at, 4, info_limit, 'Exception table header')
    count = struct.unpack_from('<I', data, table_at)[0]
    bounded(data, table_at + 4, count * 12, info_limit, 'Exception table entries')
    ends = starts | {header['bytes']}
    entries = []
    for index in range(count):
        entry_at = table_at + 4 + index * 12
        start, end, target = struct.unpack_from('<III', data, entry_at)
        if not 0 <= start < end <= header['bytes']:
            raise ValueError(f'Exception range {index} is not a non-empty interval inside the function')
        if start not in starts or end not in ends:
            raise ValueError(f'Exception range {index} endpoint is not an instruction boundary')
        if target not in starts:
            raise ValueError(f'Exception target {index} is not an instruction boundary')
        entries.append({'index': index, 'entry_file_offset': entry_at, 'start': start, 'end': end,
                        'target': target, 'target_opcode': opcodes_at[target]})
    return {'table_file_offset': table_at, 'table_bytes': 4 + count * 12,
            'range_semantics': '[start,end)', 'entries': entries}


def next_boundary(boundaries, value, fallback):
    position = bisect.bisect_right(boundaries, value)
    return boundaries[position] if position < len(boundaries) else fallback


def audit(data, metadata, opcode_source):
    file_limit = len(data) - 20
    functions = metadata['functions']
    headers = [function_header(data, function['id'], file_limit) for function in functions]
    for header, function in zip(headers, functions):
        if (header['offset'], header['bytes'], header['parameters']) != (function['offset'], function['bytes'], function['parameters']):
            raise ValueError('Function header differs from freshly parsed metadata')
    info_starts = sorted({header['info_region_start'] for header in headers if header['info_region_start']})
    body_starts = sorted({header['offset'] for header in headers})
    first_info = min(info_starts, default=file_limit)
    ops, refs = evidence.opcode_tables(opcode_source)
    counts = collections.Counter({'functions': 0, 'instructions': 0, 'large_headers': 0,
                                 'regular_addr_edges': 0, 'switch_instructions': 0, 'switch_case_edges': 0,
                                 'switch_default_edges': 0, 'exception_functions': 0, 'exception_entries': 0,
                                 'debug_info_functions': 0})
    rows, errors = [], []
    for function, header in zip(functions, headers):
        try:
            instructions = evidence.decode_function(data, function, ops, refs, len(metadata['strings']), len(functions))
            starts = {row['offset'] for row in instructions}
            opcodes_at = {row['offset']: row['opcode'] for row in instructions}
            counts.update({'functions': 1, 'instructions': len(instructions),
                           'large_headers': int(header['large_header']), 'debug_info_functions': int(header['has_debug_info'])})
            switches = []
            for instruction in instructions:
                for target in instruction['jumps']:
                    counts['regular_addr_edges'] += 1
                    if target not in starts:
                        raise ValueError(f'Addr target at {instruction["offset"]} is not an instruction boundary')
                if instruction['opcode'] == 'SwitchImm':
                    payload_limit = min(first_info, next_boundary(body_starts, header['offset'], first_info))
                    switch = audit_switch(data, function, instruction, starts, payload_limit)
                    switches.append(switch)
                    counts.update({'switch_instructions': 1, 'switch_case_edges': len(switch['cases']), 'switch_default_edges': 1})
            info_limit = min(file_limit, metadata['header']['debugInfoOffset'],
                             next_boundary(info_starts, header['info_region_start'], file_limit))
            exceptions = audit_exceptions(data, header, starts, opcodes_at, info_limit)
            if exceptions is not None:
                counts.update({'exception_functions': 1, 'exception_entries': len(exceptions['entries'])})
            if switches or exceptions is not None:
                rows.append({'function_id': function['id'], 'name': function['name'],
                             'function_file_offset': header['offset'], 'bytecode_bytes': header['bytes'],
                             'large_header': header['large_header'], 'switches': switches, 'exceptions': exceptions})
        except (ValueError, struct.error, KeyError) as error:
            errors.append({'function_id': function['id'], 'error': str(error)})
    return {'schema_version': 1, 'bytecode_version': 96,
            'bundle_sha256': hashlib.sha256(data).hexdigest(),
            'opcode_definition_sha256': hashlib.sha256(opcode_source.encode()).hexdigest(),
            'counts': dict(counts), 'errors': errors, 'functions': rows,
            'limitations': ['Encoded branch/switch/handler boundaries are checked, not full semantic control flow.',
                            'Exception range order is preserved; possible thrown values and exact throw sites are not inferred.',
                            'Generator suspension, dynamic calls, native returns and asynchronous scheduling are not modeled.',
                            'Debug offsets, regex semantics and preserved function-source tables are outside this audit.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--opcodes', type=Path, required=True)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--private-output', type=Path, required=True)
    args = parser.parse_args()
    data = args.bundle.read_bytes()
    metadata = evidence.metadata_reader.inspect(data)
    if args.metadata and json.loads(args.metadata.read_text()) != metadata:
        parser.error('Metadata does not exactly match the bundle')
    report = audit(data, metadata, args.opcodes.read_text())
    args.private_output.parent.mkdir(parents=True, exist_ok=True)
    args.private_output.write_text(json.dumps(report, ensure_ascii=True, separators=(',', ':')))
    print(json.dumps({'counts': report['counts'], 'errors': len(report['errors']), 'output': str(args.private_output)}))
    if report['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
