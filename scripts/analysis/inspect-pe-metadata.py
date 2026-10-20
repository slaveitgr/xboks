#!/usr/bin/env python3
"""Read PE headers/import DLLs from a ZIP package without executing binaries."""
import argparse
import json
from pathlib import Path
import struct
import zipfile


def inspect(data):
    def u16(off): return struct.unpack_from('<H', data, off)[0]
    def u32(off): return struct.unpack_from('<I', data, off)[0]
    if data[:2] != b'MZ': raise ValueError('Missing MZ header')
    pe = u32(0x3c)
    if data[pe:pe + 4] != b'PE\0\0': raise ValueError('Missing PE header')
    machine, count = u16(pe + 4), u16(pe + 6)
    optional_size = u16(pe + 20)
    opt = pe + 24
    magic = u16(opt)
    if magic not in (0x10b, 0x20b): raise ValueError('Unsupported PE optional header')
    dirs = opt + (112 if magic == 0x20b else 96)
    sections = []
    for i in range(count):
        off = opt + optional_size + i * 40
        name = data[off:off + 8].rstrip(b'\0').decode('ascii', 'replace')
        virtual_size, rva, raw_size, raw = struct.unpack_from('<IIII', data, off + 8)
        if raw + raw_size > len(data): raise ValueError('Section exceeds file')
        sections.append({'name': name, 'rva': rva, 'virtual_size': virtual_size, 'raw_size': raw_size, 'raw': raw})
    def offset(rva):
        for s in sections:
            delta = rva - s['rva']
            if 0 <= delta < s['raw_size']: return s['raw'] + delta
        raise ValueError('RVA is outside file-backed sections')
    def text(rva):
        off = offset(rva)
        end = data.find(b'\0', off, min(len(data), off + 512))
        if end == -1: raise ValueError('Unterminated import name')
        return data[off:end].decode('ascii')
    imports = []
    import_rva, import_size = struct.unpack_from('<II', data, dirs + 8)
    if import_rva:
        start = offset(import_rva)
        for index in range(min(import_size // 20 + 1, 4096)):
            values = struct.unpack_from('<IIIII', data, start + index * 20)
            if not any(values): break
            imports.append(text(values[3]))
        else: raise ValueError('Import table is unterminated')
    clr_rva, clr_size = struct.unpack_from('<II', data, dirs + 14 * 8)
    return {'machine_hex': hex(machine), 'format': 'PE32+' if magic == 0x20b else 'PE32',
            'section_count': len(sections), 'sections': [s['name'] for s in sections],
            'imports': sorted(set(imports)), 'has_clr_header': bool(clr_rva and clr_size)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {}
    with zipfile.ZipFile(args.package) as package:
        for name in package.namelist():
            if name.lower().endswith(('.exe', '.dll', '.winmd')):
                try: result[name] = inspect(package.read(name))
                except (ValueError, struct.error) as error: result[name] = {'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'files': len(result), 'errors': [k for k, v in result.items() if 'error' in v]}))
