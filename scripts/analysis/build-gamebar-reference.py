#!/usr/bin/env python3
"""Build a private Game Bar package/PRI/XBF/WinMD/PE evidence library.

Windows code is never executed. XBF resources embedded inside PRI are decoded
through the existing bounded readers, not mislabeled as absent native markup.
Raw labels/nodes/literals must stay in ignored local analysis storage.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import zipfile
import xml.etree.ElementTree as ET

MAX_PACKAGE = 512 * 1024 * 1024
MAX_ENTRY = 64 * 1024 * 1024
MAX_ENTRIES = 5000


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'))


def checked_members(archive):
    entries = archive.infolist()
    if len(entries) > MAX_ENTRIES:
        raise ValueError('Package has too many entries')
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate archive members')
    if sum(entry.file_size for entry in entries) > MAX_PACKAGE:
        raise ValueError('Package uncompressed size exceeds inspection limit')
    for entry in entries:
        if entry.file_size > MAX_ENTRY:
            raise ValueError('Package entry exceeds inspection limit')
        # No archive path is used as an extraction destination.
        yield entry


def manifest_contract(data):
    if len(data) > 2 * 1024 * 1024 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('Unsupported manifest size/entity declaration')
    root = ET.fromstring(data)
    local = lambda tag: tag.rsplit('}', 1)[-1]
    contracts = {'identity': {}, 'capabilities': [], 'protocols': [], 'extensions': [], 'applications': [], 'languages': []}
    for node in root.iter():
        name = local(node.tag)
        if name == 'Identity': contracts['identity'] = dict(node.attrib)
        elif name in ('Capability', 'DeviceCapability'):
            contracts['capabilities'].append({'kind': name, **node.attrib})
        elif name == 'Protocol': contracts['protocols'].append(dict(node.attrib))
        elif name == 'Application': contracts['applications'].append(dict(node.attrib))
        elif name == 'Resource': contracts['languages'].append(dict(node.attrib))
        elif name in ('Extension', 'AppExtensionHost', 'AppExtension'):
            contracts['extensions'].append({'kind': name, **node.attrib,
                'children': [{'kind': local(child.tag), 'text': child.text, **child.attrib} for child in node]})
    return contracts


def embedded_bytes(pri_data, candidate):
    if candidate.get('kind') != 'embedded':
        raise ValueError('Candidate is not declared embedded data')
    offset, size = candidate.get('value_file_offset'), candidate.get('value_bytes')
    if type(offset) is not int or type(size) is not int or offset < 0 or size < 0 or size > MAX_ENTRY or offset > len(pri_data) or size > len(pri_data) - offset:
        raise ValueError('Embedded candidate exceeds its owning PRI')
    value = pri_data[offset:offset + size]
    if sha(value) != candidate.get('sha256'):
        raise ValueError('Embedded candidate digest differs from PRI reader')
    return value


def literal_sites(data):
    """Located printable literals, explicitly not semantic calls or source."""
    for encoding, pattern in [('ascii', rb'[\x20-\x7e]{6,}'), ('utf-16-le', rb'(?:[\x20-\x7e]\x00){6,}')]:
        for match in re.finditer(pattern, data):
            if len(match.group()) <= 8192:
                yield {'offset': match.start(), 'bytes': len(match.group()), 'encoding': encoding,
                       'value': match.group().decode(encoding)}


def pe_contract(data):
    import pefile
    image = pefile.PE(data=data, fast_load=False)
    imports = []
    for table, attr in [('import', 'DIRECTORY_ENTRY_IMPORT'), ('delay-import', 'DIRECTORY_ENTRY_DELAY_IMPORT')]:
        for dll in getattr(image, attr, []):
            for item in dll.imports:
                imports.append({'table': table, 'dll': dll.dll.decode('ascii', 'replace'),
                    'name': item.name.decode('ascii', 'replace') if item.name else None,
                    'ordinal': item.ordinal, 'iat_address': item.address})
    resources = []
    def walk(directory, parts=()):
        if len(parts) > 8: raise ValueError('PE resource tree too deep')
        for entry in directory.entries:
            key = str(entry.name) if entry.name is not None else entry.id
            if hasattr(entry, 'directory'): walk(entry.directory, (*parts, key))
            elif hasattr(entry, 'data'):
                info = entry.data.struct
                start, size = image.get_offset_from_rva(info.OffsetToData), info.Size
                if size > MAX_ENTRY or start < 0 or start > len(data) or size > len(data) - start:
                    raise ValueError('PE resource data exceeds file')
                resources.append({'path': [*parts, key], 'offset': start, 'bytes': size,
                    'code_page': info.CodePage, 'sha256': sha(data[start:start + size])})
    if hasattr(image, 'DIRECTORY_ENTRY_RESOURCE'): walk(image.DIRECTORY_ENTRY_RESOURCE)
    return {'machine': image.FILE_HEADER.Machine, 'has_clr_header': bool(image.OPTIONAL_HEADER.DATA_DIRECTORY[14].VirtualAddress),
        'sections': [{'name': s.Name.rstrip(b'\0').decode('ascii', 'replace'), 'rva': s.VirtualAddress,
            'offset': s.PointerToRawData, 'bytes': s.SizeOfRawData, 'virtual_bytes': s.Misc_VirtualSize} for s in image.sections],
        'imports': imports, 'resources': resources,
        'exports': [{'name': s.name.decode('ascii', 'replace') if s.name else None, 'ordinal': s.ordinal, 'rva': s.address}
            for s in getattr(getattr(image, 'DIRECTORY_ENTRY_EXPORT', None), 'symbols', [])]}


def create_database(connection):
    connection.executescript('''
      CREATE TABLE files(package TEXT,name TEXT,sha256 TEXT,bytes INTEGER,PRIMARY KEY(package,name));
      CREATE TABLE manifest(package TEXT,contract_json TEXT);
      CREATE TABLE resources(package TEXT,pri_sha256 TEXT,resource_index INTEGER,key TEXT,candidate_index INTEGER,language TEXT,kind TEXT,value TEXT,detail_json TEXT);
      CREATE INDEX resource_key ON resources(key);
      CREATE TABLE members(file TEXT,type_name TEXT,type_rid INTEGER,kind TEXT,name TEXT,rid INTEGER,detail_json TEXT);
      CREATE INDEX member_name ON members(name);
      CREATE TABLE pe_contracts(file TEXT,detail_json TEXT);
      CREATE TABLE literals(file TEXT,offset INTEGER,encoding TEXT,value TEXT);
      CREATE INDEX literal_file ON literals(file,offset);
      CREATE TABLE xbf_files(key TEXT,sha256 TEXT,pri_sha256 TEXT,pri_offset INTEGER,bytes INTEGER,complete INTEGER,report TEXT,report_sha256 TEXT);
      CREATE TABLE xbf_nodes(key TEXT,stream INTEGER,offset INTEGER,operation TEXT,detail_json TEXT);
      CREATE INDEX xbf_node_key ON xbf_nodes(key,stream,offset);
    ''')


def build(package, bundle, output, format_source):
    if output.exists(): raise ValueError('Use a new private output directory; existing evidence is never overwritten')
    if package.stat().st_size > MAX_PACKAGE: raise ValueError('Package exceeds limit')
    if bundle and bundle.stat().st_size > MAX_PACKAGE: raise ValueError('Bundle exceeds limit')
    pri, xbf, winmd = load('inspect-pri-resources'), load('inspect-xbf-resources'), load('inspect-winmd-signatures')
    tables = xbf.load_stable_tables(format_source)
    output.mkdir(parents=True)
    package_data = package.read_bytes()
    sources = {'x64': {'path': str(package), 'sha256': sha(package_data), 'bytes': len(package_data)}}
    bundle_inventory = []
    greek = None
    if bundle:
        with zipfile.ZipFile(bundle) as archive:
            for entry in checked_members(archive):
                value = archive.read(entry)
                bundle_inventory.append({'name': entry.filename, 'bytes': len(value), 'sha256': sha(value)})
                if entry.filename == 'GameBar_7.326.10141.0_x64.appx' and sha(value) != sha(package_data):
                    raise ValueError('Bundle x64 package differs from selected package')
                if entry.filename == 'GameBar_7.326.10141.0_language-el.appx':
                    greek = output / 'language-el.appx'
                    greek.write_bytes(value)
        sources['bundle'] = {'path': str(bundle), 'sha256': sha(bundle.read_bytes()), 'bytes': bundle.stat().st_size}
        if greek: sources['el'] = {'path': str(greek), 'sha256': sha(greek.read_bytes()), 'bytes': greek.stat().st_size}
    (output / 'bundle-inventory.json').write_text(json_text(bundle_inventory))
    pri_reports = pri.inspect_inputs([package, *([greek] if greek else [])])
    pri_summary = pri.write_reports(pri_reports, output / 'pri')
    if pri_summary['counts'].get('errors') or pri_summary['counts'].get('unsupported_sections') or pri_summary['counts'].get('unsupported_candidates'):
        raise ValueError('PRI analysis incomplete; inspect private PRI summary')
    database = output / 'gamebar.sqlite3'
    c = sqlite3.connect(database)
    create_database(c)
    counts, errors, xbf_reports = Counter(), [], []
    native = {'schema_version': 1, 'package_sha256': sha(package_data), 'files': {}}
    with zipfile.ZipFile(package) as archive:
        for entry in checked_members(archive):
            data = archive.read(entry)
            c.execute('INSERT INTO files VALUES(?,?,?,?)', ('x64', entry.filename, sha(data), len(data)))
            counts['x64_files'] += 1
            if entry.filename == 'AppxManifest.xml':
                c.execute('INSERT INTO manifest VALUES(?,?)', ('x64', json_text(manifest_contract(data))))
            if entry.filename.lower().endswith(('.exe', '.dll', '.winmd')):
                try:
                    contract = pe_contract(data)
                    c.execute('INSERT INTO pe_contracts VALUES(?,?)', (entry.filename, json_text(contract)))
                    counts['pe_files'] += 1
                    counts['pe_imports'] += len(contract['imports'])
                    counts['pe_resources'] += len(contract['resources'])
                    for site in literal_sites(data):
                        c.execute('INSERT INTO literals VALUES(?,?,?,?)', (entry.filename, site['offset'], site['encoding'], site['value']))
                        counts['literal_sites'] += 1
                except Exception as error: errors.append({'file': entry.filename, 'stage': 'PE', 'error': str(error)})
            if entry.filename.lower().endswith('.winmd'):
                try:
                    metadata = winmd.inspect(data)
                    native['files'][entry.filename] = metadata
                    counts['winmd_files'] += 1
                    if metadata['errors']: errors.extend(metadata['errors'])
                    for typ in metadata['types']:
                        counts['types'] += 1
                        for kind, members in [('method', typ['methods']), ('field', typ['fields'])]:
                            for member in members:
                                c.execute('INSERT INTO members VALUES(?,?,?,?,?,?,?)', (entry.filename, typ['name'], typ['rid'], kind, member['name'], member['rid'], json_text(member)))
                                counts['typed_members'] += 1
                except Exception as error: errors.append({'file': entry.filename, 'stage': 'WinMD', 'error': str(error)})
        pri_data = archive.read('resources.pri')
    (output / 'native-signatures.json').write_text(json_text(native))
    for report in pri_reports:
        package_label = 'x64' if report['input'] == str(package) else 'el'
        for resource in report['resources']:
            for candidate in resource['candidates']:
                language = next((q['value'] for q in candidate['qualifiers'] if q.get('attribute') == 'Language'), None)
                c.execute('INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?)', (package_label, report['sha256'], resource['resource_index'], resource['key'], candidate['candidate_index'], language, candidate['kind'], candidate.get('value'), json_text(candidate)))
                counts['resource_candidates'] += 1
                if language == 'EL-GR': counts['greek_candidates'] += 1
                if package_label == 'x64' and resource['key'].lower().endswith('.xbf'):
                    try:
                        data = embedded_bytes(pri_data, candidate)
                        decoded = xbf.inspect(data, tables)
                        filename = f"xbf/{len(xbf_reports):03d}.json"
                        (output / 'xbf').mkdir(exist_ok=True)
                        raw = json_text(decoded).encode()
                        (output / filename).write_bytes(raw)
                        c.execute('INSERT INTO xbf_files VALUES(?,?,?,?,?,?,?,?)', (resource['key'], sha(data), report['sha256'], candidate['value_file_offset'], len(data), int(decoded['complete_stream_decode']), filename, sha(raw)))
                        for stream in decoded['streams']:
                            for node in stream['nodes']:
                                c.execute('INSERT INTO xbf_nodes VALUES(?,?,?,?,?)', (resource['key'], stream['index'], node['file_offset'], node['operation'], json_text(node)))
                        xbf_reports.append({'key': resource['key'], 'sha256': sha(data), 'report': filename, 'report_sha256': sha(raw), 'nodes': decoded['decoded_nodes'], 'complete': decoded['complete_stream_decode'], 'errors': decoded['errors']})
                        counts['xbf_files'] += 1
                        counts['xbf_nodes'] += decoded['decoded_nodes']
                        if not decoded['complete_stream_decode']: errors.extend(decoded['errors'])
                    except Exception as error: errors.append({'resource': resource['key'], 'stage': 'XBF', 'error': str(error)})
    c.commit()
    result = c.execute('PRAGMA integrity_check').fetchone()[0]
    c.close()
    if result != 'ok': errors.append({'stage': 'SQLite', 'error': result})
    summary = {'schema_version': 1, 'sources': sources, 'counts': dict(counts), 'errors': errors,
        'analysis_tool_sha256': sha(Path(__file__).read_bytes()),
        'reader_sha256': {name: sha(Path(__file__).with_name(name + '.py').read_bytes())
            for name in ['inspect-pri-resources', 'inspect-xbf-resources', 'inspect-winmd-signatures']},
        'pri': {'format_commit': pri.SOURCE_COMMIT, 'summary': 'pri/summary.json'},
        'xbf': {'format_commit': xbf.FORMAT_COMMIT, 'stable_table_hashes': xbf.TABLE_HASHES, 'resources': xbf_reports},
        'files': {str(p.relative_to(output)): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
            for p in [database, output / 'native-signatures.json', output / 'bundle-inventory.json', output / 'pri/summary.json', output / 'pri/resources.jsonl']},
        'limitations': ['No package code, Windows API, account or service is executed.',
            'Native PE methods are not decompiled; typed WinMD signatures are contracts, not portable implementations.',
            'Located printable literals are not callsites or evidence of reachable UI.',
            'Persisted XBF nodes are not an evaluated render tree; bindings/theme/resource/flight/runtime behavior remains separate.',
            'Main x64 and Greek PRI receive semantic parsing; other bundle members receive CRC/hash inventory only.',
            'Third-party widgets such as Spotify/Edge/Xbox Social require their separate packages and services.']}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    if errors: raise ValueError('Analysis has errors; see private summary')
    return summary


def search(database, query, limit):
    if not query or len(query) > 200 or not 1 <= limit <= 200:
        raise ValueError('Use a nonempty query up to 200 characters and limit 1..200')
    with sqlite3.connect(f'file:{database.resolve()}?mode=ro', uri=True) as c:
        q = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        result = {}
        for name, sql in [
            ('resources', "SELECT package,key,language,kind,value,detail_json FROM resources WHERE key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\' LIMIT ?"),
            ('members', "SELECT file,type_name,kind,name,rid,detail_json FROM members WHERE type_name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' LIMIT ?"),
            ('xbf_nodes', "SELECT key,stream,offset,operation,detail_json FROM xbf_nodes WHERE key LIKE ? ESCAPE '\\' OR detail_json LIKE ? ESCAPE '\\' LIMIT ?"),
            ('literals', "SELECT file,offset,encoding,value FROM literals WHERE value LIKE ? ESCAPE '\\' OR file LIKE ? ESCAPE '\\' LIMIT ?")]:
            result[name] = list(c.execute(sql, (q, q, limit)))
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('build')
    create.add_argument('package', type=Path)
    create.add_argument('--bundle', type=Path)
    create.add_argument('--format-source', type=Path, default=Path('work/reference/library/xbf/source'))
    create.add_argument('--private-output', type=Path, required=True)
    query = sub.add_parser('search')
    query.add_argument('database', type=Path)
    query.add_argument('query')
    query.add_argument('--limit', type=int, default=12)
    args = parser.parse_args()
    if args.command == 'build':
        report = build(args.package, args.bundle, args.private_output, args.format_source)
        print(json_text({'counts': report['counts'], 'errors': len(report['errors'])}))
    else:
        print(json_text(search(args.database, args.query, args.limit)))
