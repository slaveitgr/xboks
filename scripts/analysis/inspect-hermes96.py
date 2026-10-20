#!/usr/bin/env python3
"""Read Hermes v96 metadata/string tables without executing or decompiling code.

Layout reference: facebook/hermes v0.13.0, BytecodeFileFormat.h and
BytecodeDataProvider.cpp. This reader intentionally rejects other versions.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

FIELDS = ('fileLength globalCodeIndex functionCount stringKindCount identifierCount '
          'stringCount overflowStringCount stringStorageSize bigIntCount bigIntStorageSize '
          'regExpCount regExpStorageSize arrayBufferSize objKeyBufferSize objValueBufferSize '
          'segmentID cjsModuleCount functionSourceCount debugInfoOffset').split()


def inspect(data):
    if len(data) < 148:
        raise ValueError('Truncated Hermes header/footer')
    magic, version = struct.unpack_from('<QI', data)
    if magic != 0x1F1903C103BC1FC6 or version != 96:
        raise ValueError('Only Hermes execution-form bytecode v96 is supported')
    header = dict(zip(FIELDS, struct.unpack_from('<19I', data, 32)))
    if header['fileLength'] != len(data):
        raise ValueError('Header length differs from actual file length')
    if not 128 <= header['debugInfoOffset'] <= len(data) - 20:
        raise ValueError('Debug section is outside file bounds')
    footer_ok = hashlib.sha1(data[:-20]).digest() == data[-20:]
    if not footer_ok:
        raise ValueError('Hermes footer SHA-1 does not match')
    offset = 128
    sections = {}

    def section(name, count, width):
        nonlocal offset
        offset = (offset + 3) & ~3
        size = count * width
        if offset + size > len(data) - 20:
            raise ValueError(f'{name} table exceeds bytecode bounds')
        sections[name] = {'offset': offset, 'bytes': size, 'count': count}
        view = memoryview(data)[offset:offset + size]
        offset += size
        return view

    functions = section('function_headers', header['functionCount'], 16)
    section('string_kinds', header['stringKindCount'], 4)
    section('identifier_hashes', header['identifierCount'], 4)
    small = section('small_strings', header['stringCount'], 4)
    overflow = section('overflow_strings', header['overflowStringCount'], 8)
    storage = section('string_storage', header['stringStorageSize'], 1)
    strings = []
    utf16 = 0
    for index in range(header['stringCount']):
        word = struct.unpack_from('<I', small, index * 4)[0]
        wide, start, length = word & 1, (word >> 1) & 0x7fffff, word >> 24
        if length == 255:
            if start >= header['overflowStringCount']:
                raise ValueError('Invalid overflow string index')
            start, length = struct.unpack_from('<II', overflow, start * 8)
        size = length * (2 if wide else 1)
        if start + size > len(storage):
            raise ValueError(f'String {index} is outside storage')
        raw = bytes(storage[start:start + size])
        # Hermes permits lone UTF-16 surrogates in JS strings.
        strings.append(raw.decode('utf-16-le', errors='surrogatepass') if wide else raw.decode('utf-8', errors='surrogateescape'))
        utf16 += wide
    function_rows = []
    for index in range(header['functionCount']):
        w0, w1, w2 = struct.unpack_from('<III', functions, index * 16)
        flags = functions[index * 16 + 15]
        if flags & 0x20:
            large = (w0 & 0xffff) | ((w2 & 0x1ffffff) << 16)
            if large + 16 > len(data) - 20:
                raise ValueError('Large function header exceeds bounds')
            start, params, size, name = struct.unpack_from('<IIII', data, large)
        else:
            start, params, size, name = w0 & 0x1ffffff, w0 >> 25, w1 & 0x7fff, w1 >> 15
        if name >= len(strings) or start + size > len(data) - 20:
            raise ValueError(f'Function {index} has invalid name/body bounds')
        function_rows.append({'id': index, 'name': strings[name], 'offset': start, 'bytes': size, 'parameters': params})
    return {'header': header, 'sections': sections, 'footer_sha1_matches': footer_ok,
            'utf16_strings': utf16, 'strings': strings, 'functions': function_rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--private-output', type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.bundle.read_bytes())
    args.private_output.parent.mkdir(parents=True, exist_ok=True)
    args.private_output.write_text(json.dumps(report, ensure_ascii=True))
    print(json.dumps({'strings': len(report['strings']), 'functions': len(report['functions']),
                      'utf16_strings': report['utf16_strings'], 'footer_sha1_matches': report['footer_sha1_matches']}))
