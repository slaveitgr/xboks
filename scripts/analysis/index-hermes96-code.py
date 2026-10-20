#!/usr/bin/env python3
"""Index v96 instruction boundaries and references; never execute the app.
Pass the matching upstream v0.13.0 BytecodeList.def as --opcodes.
"""
import argparse
import collections
import json
from pathlib import Path
import re
import struct

FORMATS = {'Reg8': 'B', 'Reg32': 'I', 'UInt8': 'B', 'UInt16': 'H', 'UInt32': 'I',
           'Addr8': 'b', 'Addr32': 'i', 'Imm32': 'i', 'Double': 'd'}


def read_opcodes(source):
    source = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
    source = re.sub(r'//[^\n]*', '', source)
    # Skip preprocessor definitions and continued macro lines. Expand only
    # actual DEFINE_JUMP declarations in source order, as the v96 file does.
    lines = []
    continuation = False
    for line in source.splitlines():
        if line.lstrip().startswith('#') or continuation:
            continuation = line.rstrip().endswith('\\')
            continue
        lines.append(line)
    text = '\n'.join(lines)
    opcodes = []
    for match in re.finditer(r'DEFINE_(OPCODE|JUMP)_([0-6])\s*\(([^)]*)\)', text):
        kind, count, args = match.groups()
        parts = [p.strip() for p in args.split(',')]
        name = parts[0]
        if kind == 'JUMP':
            regs = ['Reg8'] * (int(count) - 1)
            opcodes.extend([(name, ['Addr8'] + regs), (name + 'Long', ['Addr32'] + regs)])
        else:
            if len(parts) - 1 != int(count):
                raise ValueError('Unexpected opcode declaration')
            opcodes.append((name, parts[1:]))
    string_operands = {name: int(index) - 1 for name, index in re.findall(r'OPERAND_STRING_ID\((\w+),\s*(\d+)\)', text)}
    function_operands = {name: int(index) - 1 for name, index in re.findall(r'OPERAND_FUNCTION_ID\((\w+),\s*(\d+)\)', text)}
    return opcodes, string_operands, function_operands


def index_code(data, metadata, source):
    opcodes, string_args, function_args = read_opcodes(source)
    histogram = collections.Counter()
    rows = []
    errors = []
    for func in metadata['functions']:
        cursor, end = func['offset'], func['offset'] + func['bytes']
        strings, calls = set(), set()
        count = 0
        try:
            while cursor < end:
                opcode = data[cursor]
                if opcode >= len(opcodes):
                    raise ValueError(f'Unknown opcode {opcode}')
                name, types = opcodes[opcode]
                fmt = '<' + ''.join(FORMATS[t] for t in types)
                size = 1 + struct.calcsize(fmt)
                if cursor + size > end:
                    raise ValueError('Instruction crosses function boundary')
                operands = struct.unpack_from(fmt, data, cursor + 1)
                if name in string_args:
                    index = operands[string_args[name]]
                    if index >= len(metadata['strings']):
                        raise ValueError('Invalid string reference')
                    strings.add(index)
                if name in function_args:
                    index = operands[function_args[name]]
                    if index >= len(metadata['functions']):
                        raise ValueError('Invalid function reference')
                    calls.add(index)
                histogram[name] += 1
                count += 1
                cursor += size
            rows.append({'id': func['id'], 'name': func['name'], 'instructions': count,
                         'string_ids': sorted(strings), 'function_ids': sorted(calls)})
        except (ValueError, IndexError, struct.error) as error:
            errors.append({'id': func['id'], 'error': str(error)})
    return {'opcodes_defined': len(opcodes), 'functions_indexed': len(rows),
            'instructions': sum(histogram.values()), 'opcode_counts': dict(histogram),
            'errors': errors, 'functions': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--opcodes', type=Path, required=True)
    parser.add_argument('--private-output', type=Path, required=True)
    args = parser.parse_args()
    report = index_code(args.bundle.read_bytes(), json.loads(args.metadata.read_text()), args.opcodes.read_text())
    args.private_output.parent.mkdir(parents=True, exist_ok=True)
    args.private_output.write_text(json.dumps(report, ensure_ascii=True))
    print(json.dumps({k: v for k, v in report.items() if k not in ['functions', 'opcode_counts']})[:2000])
