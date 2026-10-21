#!/usr/bin/env python3
"""Build/search a local, versioned Xbox reference database; never run package code.

Bulk strings, assets and screenshots belong in ignored work/reference. The public
summary contains only hashes/counts. Exact file paths in the database are evidence
locators, not instructions to execute package contents.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import xml.etree.ElementTree as ET
import zipfile

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE packages(id TEXT PRIMARY KEY,path TEXT,sha256 TEXT,bytes INTEGER,identity_json TEXT,crc_ok INTEGER);
CREATE TABLE files(package TEXT REFERENCES packages(id),path TEXT,sha256 TEXT,bytes INTEGER,kind TEXT,PRIMARY KEY(package,path));
CREATE TABLE manifest_items(package TEXT REFERENCES packages(id),tag TEXT,attributes_json TEXT);
CREATE TABLE strings(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE functions(id INTEGER PRIMARY KEY,name TEXT,offset INTEGER,bytes INTEGER,instructions INTEGER);
CREATE TABLE string_refs(function_id INTEGER REFERENCES functions(id),string_id INTEGER REFERENCES strings(id),PRIMARY KEY(function_id,string_id));
CREATE INDEX string_refs_string ON string_refs(string_id);
CREATE TABLE function_refs(owner_id INTEGER REFERENCES functions(id),target_id INTEGER REFERENCES functions(id),PRIMARY KEY(owner_id,target_id));
CREATE INDEX function_refs_target ON function_refs(target_id);
CREATE TABLE string_sites(function_id INTEGER REFERENCES functions(id),string_id INTEGER REFERENCES strings(id),offset INTEGER,file_offset INTEGER,opcode TEXT,source TEXT);
CREATE INDEX string_sites_by_string ON string_sites(string_id);
CREATE INDEX string_sites_by_function ON string_sites(function_id);
CREATE TABLE typed_function_refs(owner_id INTEGER REFERENCES functions(id),target_id INTEGER REFERENCES functions(id),offset INTEGER,kind TEXT,opcode TEXT);
CREATE TABLE control_flow(function_id INTEGER PRIMARY KEY REFERENCES functions(id),detail_json TEXT);
CREATE TABLE modules(id INTEGER PRIMARY KEY,factory_id INTEGER REFERENCES functions(id),registration_function INTEGER REFERENCES functions(id),offset INTEGER);
CREATE TABLE module_dependencies(owner_id INTEGER,slot INTEGER,target_id INTEGER,target_registered INTEGER);
CREATE TABLE native_types(source TEXT,name TEXT,methods_json TEXT,fields_json TEXT);
CREATE TABLE native_files(source TEXT PRIMARY KEY,sha256 TEXT,bytes INTEGER,imports_json TEXT,exports_json TEXT,error TEXT);
CREATE TABLE resource_candidates(pri_sha256 TEXT,map_index INTEGER,resource_index INTEGER,resource_key TEXT,candidate_index INTEGER,kind TEXT,language TEXT,value TEXT,detail_json TEXT,PRIMARY KEY(pri_sha256,map_index,resource_index,candidate_index));
CREATE INDEX resource_candidates_key ON resource_candidates(resource_key);
CREATE TABLE xbf_nodes(member TEXT,stream INTEGER,file_offset INTEGER,operation TEXT,detail_json TEXT,PRIMARY KEY(member,stream,file_offset));
CREATE TABLE native_members(source TEXT,type_name TEXT,type_rid INTEGER,kind TEXT,name TEXT,rid INTEGER,detail_json TEXT,PRIMARY KEY(source,type_rid,kind,rid));
CREATE INDEX native_members_name ON native_members(name);
CREATE TABLE sources(id TEXT PRIMARY KEY,path TEXT,sha256 TEXT,scope TEXT);
'''


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def kind(name):
    suffix = Path(name).suffix.lower()
    return {'.bundle':'hermes-or-bundle', '.winmd':'runtime-metadata', '.xbf':'compiled-xaml',
            '.pri':'resource-index', '.ttf':'font', '.svg':'vector', '.png':'bitmap',
            '.dll':'pe', '.exe':'pe', '.xml':'xml'}.get(suffix, suffix or 'other')


def index_package(db, name, path):
    """Read members in memory; do not extract archive paths or follow them."""
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        paths = [i.filename for i in entries]
        if len(paths) != len(set(paths)):
            raise ValueError(f'Duplicate members in {name}')
        manifest = ET.fromstring(archive.read('AppxManifest.xml'))
        identity = next((e.attrib for e in manifest if e.tag.rsplit('}',1)[-1] == 'Identity'), {})
        # Reading each member checks its CRC. This does not verify signing identity.
        db.execute('INSERT INTO packages VALUES(?,?,?,?,?,?)',
                   (name,str(path),sha(path),Path(path).stat().st_size,json.dumps(identity),1))
        counts = Counter()
        for entry in entries:
            if entry.is_dir():
                continue
            content = archive.read(entry)
            category = kind(entry.filename)
            db.execute('INSERT INTO files VALUES(?,?,?,?,?)',
                       (name,entry.filename,hashlib.sha256(content).hexdigest(),len(content),category))
            counts[category] += 1
        for element in manifest.iter():
            if element.attrib:
                db.execute('INSERT INTO manifest_items VALUES(?,?,?)',
                           (name,element.tag,json.dumps(element.attrib,ensure_ascii=True)))
        return {'id':name,'identity':identity,'sha256':sha(path),'entries':sum(counts.values()),
                'kinds':dict(sorted(counts.items())), 'crc_ok':True, 'signature_verified':False}


def add_source(db, root, relative, scope):
    path = root / relative
    if not path.is_file():
        return None
    db.execute('INSERT INTO sources VALUES(?,?,?,?)',(relative,str(path),sha(path),scope))
    return json.loads(path.read_text())


def verify_hermes_inputs(root, metadata, code):
    def reader(filename):
        spec=importlib.util.spec_from_file_location(filename,Path(__file__).with_name(filename+'.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module
    bundle=(root/'index.bundle').read_bytes()
    opcode_path=root/'hermes-format/BytecodeList.def'
    if sha(opcode_path) != '62bfc95c5ab7d96bc58c31f1a9faa8772afb9500d5f87e541c8a3623645f1a85':
        raise ValueError('Opcode source differs from the pinned v96 definition')
    actual_metadata=reader('inspect-hermes96').inspect(bundle)
    if metadata != actual_metadata:
        raise ValueError('Decoded metadata differs from the actual Hermes input')
    actual_code=reader('index-hermes96-code').index_code(bundle,actual_metadata,opcode_path.read_text())
    if code != actual_code:
        raise ValueError('Code index differs from the actual Hermes input')
    with zipfile.ZipFile(root/'XboxAppPackage_2610.1001.20.0_x64.msix') as package:
        if package.read('Bundle/index.bundle') != bundle:
            raise ValueError('Hermes input differs from the supplied package')


def index_hermes(db, metadata, code):
    if code['errors']:
        raise ValueError('Instruction index has errors; regenerate before importing')
    if code['functions_indexed'] != len(metadata['functions']):
        raise ValueError('Function count mismatch')
    rows = {f['id']:f for f in code['functions']}
    db.executemany('INSERT INTO strings VALUES(?,?)',
                   ((i,s.encode('utf-8',errors='backslashreplace').decode()) for i,s in enumerate(metadata['strings'])))
    for f in metadata['functions']:
        c = rows[f['id']]
        if c['name'] != f['name']:
            raise ValueError('Function identity mismatch')
        db.execute('INSERT INTO functions VALUES(?,?,?,?,?)',
                   (f['id'],f['name'],f['offset'],f['bytes'],c['instructions']))
    for f in rows.values():
        db.executemany('INSERT INTO string_refs VALUES(?,?)',((f['id'],s) for s in f['string_ids']))
        db.executemany('INSERT INTO function_refs VALUES(?,?)',((f['id'],t) for t in f['function_ids']))
    return {'strings':len(metadata['strings']),'functions':len(rows),'instructions':code['instructions'],
            'instruction_errors':len(code['errors']),
            'reference_scope':'Legacy explicit-reference index; function refs include closures, not a dynamic call graph. Multiple string operands are completed by function-evidence.json.'}


def index_evidence(db, root, evidence, output):
    if evidence['errors'] or evidence['counts'].get('jump_errors',0):
        raise ValueError('Function evidence contains decode/branch errors')
    if evidence['bundle_sha256'] != sha(root/'index.bundle'):
        raise ValueError('Evidence bundle hash mismatch')
    with zipfile.ZipFile(root/'XboxAppPackage_2610.1001.20.0_x64.msix') as package:
        digest = hashlib.sha256(package.read('Bundle/index.bundle')).hexdigest()
        if digest != evidence['bundle_sha256']:
            raise ValueError('Hermes input differs from the supplied package')
    path=output/'function-evidence.jsonl'
    if evidence.get('function_evidence_jsonl_sha256') != sha(path):
        raise ValueError('Function evidence JSONL hash mismatch or missing binding')
    db.execute('INSERT INTO sources VALUES(?,?,?,?)',('function-evidence.jsonl',str(path),sha(path),'Exact instruction/literal string sites and typed function references'))
    seen=set()
    with path.open() as stream:
        for line in stream:
            row=json.loads(line)
            if row['id'] in seen:
                raise ValueError('Duplicate function evidence row')
            seen.add(row['id'])
            sites=row.get('string_sites',[])
            db.executemany('INSERT INTO string_sites VALUES(?,?,?,?,?,?)',
                ((row['id'],v['string_id'],v['offset'],v['file_offset'],v['opcode'],v['source']) for v in sites))
            db.executemany('INSERT OR IGNORE INTO string_refs VALUES(?,?)',
                ((row['id'],v['string_id']) for v in sites))
            db.executemany('INSERT INTO typed_function_refs VALUES(?,?,?,?,?)',
                ((row['id'],v['target'],v['offset'],v['kind'],v.get('opcode')) for v in row.get('function_relations',[])))
    if len(seen) != evidence['counts']['functions']:
        raise ValueError('Missing function evidence rows')
    for module in evidence.get('module_registration_patterns',[]):
        # Duplicate module IDs are a finding, never silently collapsed.
        db.execute('INSERT INTO modules VALUES(?,?,?,?)',
            (module['module_id'],module['factory_function_id'],module['function_id'],module['offset']))
    db.executemany('INSERT INTO module_dependencies VALUES(?,?,?,?)',
        ((v['source_module'],v['dependency_slot'],v['target_module'],int(v['target_registered'])) for v in evidence.get('declared_module_dependency_edges',[])))
    return {'counts':evidence['counts'],'modules':len(evidence.get('module_registration_patterns',[])),
            'declared_module_dependencies':len(evidence.get('declared_module_dependency_edges',[])),
            'limitations':evidence['limitations']}


def index_native(db, source_id, contents, package):
    counts = Counter()
    with zipfile.ZipFile(package) as archive:
        for name, info in contents.items():
            if 'error' in info:
                raise ValueError(f'Native analysis error: {source_id}::{name}')
            data=archive.read(name)
            if info.get('sha256') != hashlib.sha256(data).hexdigest() or info.get('bytes') != len(data):
                raise ValueError(f'Native input hash mismatch: {source_id}::{name}')
    for name, info in contents.items():
        locator = source_id + '::' + name
        db.execute('INSERT INTO native_files VALUES(?,?,?,?,?,?)',
                   (locator,info.get('sha256'),info.get('bytes'),json.dumps(info.get('imports',[])),
                    json.dumps(info.get('exports',[])),info.get('error')))
        counts['files'] += 1
        counts['errors'] += int('error' in info)
        for typ in info.get('types',[]):
            db.execute('INSERT INTO native_types VALUES(?,?,?,?)',
                       (locator,typ['name'],json.dumps(typ.get('methods',[])),json.dumps(typ.get('fields',[]))))
            counts['types'] += 1
    return dict(counts)


def index_xbf(db, archive_path, summary_path):
    xbf=json.loads(summary_path.read_text())
    if xbf['package_sha256']!=sha(archive_path):raise ValueError('XBF package input hash mismatch')
    node_count=0;seen=set()
    with zipfile.ZipFile(archive_path) as archive:
        for resource in xbf['resources']:
            member=resource['member'];filename=resource['report']
            if member in seen:raise ValueError('Duplicate XBF resource')
            seen.add(member)
            if Path(filename).name!=filename:raise ValueError('XBF report filename must be a basename')
            data_path=summary_path.parent/filename
            if resource.get('report_sha256')!=sha(data_path):raise ValueError('XBF decoded report hash mismatch')
            decoded=json.loads(data_path.read_text());raw=archive.read(member)
            digest=hashlib.sha256(raw).hexdigest()
            if resource['errors'] or decoded['errors'] or not resource['complete_stream_decode'] or not decoded['complete_stream_decode'] or digest!=resource['sha256'] or digest!=decoded['sha256'] or len(raw)!=resource['bytes']:
                raise ValueError('XBF errors or source hash mismatch')
            count=sum(len(stream['nodes']) for stream in decoded['streams'])
            if count!=resource['decoded_nodes'] or len(decoded['streams'])!=resource['substreams']:
                raise ValueError('XBF decoded count mismatch')
            for stream in decoded['streams']:
                for node in stream['nodes']:
                    db.execute('INSERT INTO xbf_nodes VALUES(?,?,?,?,?)',(member,stream['index'],node['file_offset'],node['operation'],json.dumps(node,separators=(',',':'))))
            node_count+=count
            db.execute('INSERT INTO sources VALUES(?,?,?,?)',('xbf/'+filename,str(data_path),sha(data_path),'XBF persisted object-writer nodes; not a rendered UI'))
        if seen!={name for name in archive.namelist() if name.lower().endswith('.xbf')}:
            raise ValueError('Missing XBF input members')
    db.execute('INSERT INTO sources VALUES(?,?,?,?)',('xbf/summary.json',str(summary_path),sha(summary_path),'XBF version and source/report provenance'))
    return {'files':len(seen),'decoded_nodes':node_count,'scope':xbf['scope']}


def index_signatures(db, archive_path, signature_path):
    signatures=json.loads(signature_path.read_text())
    if signatures['counts']['errors'] or signatures['package_sha256']!=sha(archive_path):
        raise ValueError('Native signature provenance mismatch or decode errors')
    counts={'files':0,'types':0,'members':0,'errors':0}
    with zipfile.ZipFile(archive_path) as archive:
        if set(signatures['files'])!={name for name in archive.namelist() if name.lower().endswith('.winmd')}:
            raise ValueError('Native signature input member set mismatch')
        for member,info in signatures['files'].items():
            if info.get('errors') or 'error' in info:raise ValueError('Native signature file decode errors')
            raw=archive.read(member)
            if info.get('sha256')!=hashlib.sha256(raw).hexdigest() or info.get('bytes')!=len(raw):
                raise ValueError('Native signature member hash mismatch')
            file_members=0;counts['files']+=1
            for typ in info['types']:
                counts['types']+=1
                for kind,collection in [('method','methods'),('field','fields')]:
                    for row in typ[collection]:
                        if 'error' in row:raise ValueError('Native signature member decode error')
                        if ('signature' if kind=='method' else 'type') not in row:
                            raise ValueError('Missing decoded native signature')
                        db.execute('INSERT INTO native_members VALUES(?,?,?,?,?,?,?)',
                            (signature_path.name+'::'+member,typ['name'],typ['rid'],kind,row['name'],row['rid'],json.dumps(row,separators=(',',':'))))
                        file_members+=1
            if file_members!=info['members']:raise ValueError('Native signature file member count mismatch')
            counts['members']+=file_members
    if counts!=signatures['counts']:raise ValueError('Native signature aggregate count mismatch')
    db.execute('INSERT INTO sources VALUES(?,?,?,?)',(signature_path.name,str(signature_path),sha(signature_path),'Decoded ECMA335 member signatures and constants; not native semantics'))
    return counts


def publish_generation(database, summary, output):
    """Keep prior files recoverable if either staged-file replacement fails.

    SQLite's own summary is authoritative for readers. The JSON file is a mirror;
    two directory entries cannot be switched in one filesystem operation.
    """
    staged=[(database,output/'reference.sqlite3'),(summary,output/'summary.json')]
    backups={}
    for index,(_,target) in enumerate(staged):
        if target.exists():
            backup=database.parent/f'previous-{index}'
            os.link(target,backup)
            backups[target]=backup
    published=[]
    try:
        for source,target in staged:
            source.replace(target)
            published.append(target)
    except OSError:
        for target in reversed(published):
            if target in backups:
                backups[target].replace(target)
            else:
                target.unlink(missing_ok=True)
        raise


def build(root, output):
    output = output.resolve()
    output.mkdir(parents=True,exist_ok=True)
    # Publish only a complete database; a failed import preserves the previous one.
    with tempfile.TemporaryDirectory(prefix='xboks-reference-',dir=output) as staging:
        temporary = Path(staging)/'reference.sqlite3'
        db = sqlite3.connect(temporary)
        try:
            db.executescript(SCHEMA)
            db.execute('INSERT INTO meta VALUES(?,?)',('schema_version','1'))
            report = {'schema_version':1,'packages':[],'native':{},'limitations':[
                'Static local evidence, not recovered original source or complete semantics.',
                'No Windows runtime, server responses or feature flights observed by this build.',
                'Optional PRI/XBF decoders describe candidates/nodes; Windows resource resolution, rendering and event execution are not verified.',
                'CRC and SHA checks are integrity checks, not Microsoft signing verification.',
                'Architecture/language variants beyond the supplied x64/Greek inputs are outside this database.'
            ]}
            for ident, filename in [('xbox-x64','XboxAppPackage_2610.1001.20.0_x64.msix'),
                                    ('xbox-el','XboxAppPackage_2610.1001.20.0_language-el.msix'),
                                    ('gamebar-x64','GameBar_7.326.10141.0_x64.appx')]:
                path = root / filename
                if path.exists():
                    report['packages'].append(index_package(db,ident,path))
            meta = add_source(db,root,'hermes96-decoded.json','All v96 strings and function metadata')
            code = add_source(db,root,'hermes96-code-index.json','Instruction boundaries and legacy explicit references')
            if meta is not None and code is not None:
                verify_hermes_inputs(root,meta,code)
                report['hermes'] = index_hermes(db,meta,code)
            else:
                raise ValueError('Missing Hermes metadata/code index')
            native_sources = {
                'xbox-components.json':'XboxAppPackage_2610.1001.20.0_x64.msix',
                'gamebar-components.json':'GameBar_7.326.10141.0_x64.appx',
                'incoming/tcui-legacy-components.json':'incoming/TCUI-App_1.24.10001.0_x64.appx',
                'incoming/gaming-services-components.json':'incoming/GamingServicesTcui-Package_38.118.9001.0_x64.appx',
                'incoming/identity-provider-components.json':'incoming/XboxIdp_12.130.16001.0_x64.appx',
                'incoming/store-modern-components.json':'incoming/WinStore2_22609.1401.5.0_x64.msix',
                'incoming/store-old-components.json':'incoming/WinStore_12107.1001.15.0_x64.appx',
                'incoming/store-modern-app.json':'incoming/WinStore2_22609.1401.5.0_x64.msix'}
            for relative, archive in native_sources.items():
                data = add_source(db,root,relative,'PE/WinMD/managed IL static inspection; no native semantic recovery')
                if data is not None:
                    report['native'][relative] = index_native(db,relative,data,root/archive)
            evidence_path=output/'function-evidence.json'
            if evidence_path.is_file():
                evidence=json.loads(evidence_path.read_text())
                db.execute('INSERT INTO sources VALUES(?,?,?,?)',('function-evidence.json',str(evidence_path),sha(evidence_path),'Function evidence summary and module registration patterns'))
                report['function_evidence']=index_evidence(db,root,evidence,output)
            else:
                report['limitations'].append('Exact function evidence has not been generated; only legacy explicit refs available.')
            pri_path=output/'pri/summary.json'
            if pri_path.is_file():
                pri=json.loads(pri_path.read_text());rows_path=pri_path.parent/'resources.jsonl'
                if pri['counts']['errors'] or pri['counts']['unsupported_sections'] or sha(rows_path)!=pri['resources_jsonl_sha256']:
                    raise ValueError('PRI errors/unsupported sections or JSONL provenance mismatch')
                expected_inputs={p['pri_sha256'] if 'pri_sha256' in p else p['sha256'] for p in pri['inputs']}
                allowed_archives={'XboxAppPackage_2610.1001.20.0_x64.msix','XboxAppPackage_2610.1001.20.0_language-el.msix','GameBar_7.326.10141.0_x64.appx'}
                for item in pri['inputs']:
                    filename=Path(item['input']).name
                    if filename not in allowed_archives:raise ValueError('Unexpected PRI input archive')
                    with zipfile.ZipFile(root/filename) as archive:
                        if hashlib.sha256(archive.read(item['package_entry'])).hexdigest()!=item['sha256']:
                            raise ValueError('PRI member input hash mismatch')
                count=0
                with rows_path.open() as stream:
                    for line in stream:
                        row=json.loads(line);count+=1
                        if row['pri_sha256'] not in expected_inputs:raise ValueError('PRI row has unknown owner')
                        for candidate in row['candidates']:
                            languages=[q['value'] for q in candidate['qualifiers'] if q.get('attribute')=='Language']
                            language=languages[0] if len(languages)==1 else None
                            value=candidate.get('value')
                            db.execute('INSERT INTO resource_candidates VALUES(?,?,?,?,?,?,?,?,?)',
                                (row['pri_sha256'],row['map_section_index'],row['resource_index'],row['key'],candidate['candidate_index'],candidate['kind'],language,value if isinstance(value,str) else None,json.dumps(candidate,separators=(',',':'))))
                if count!=pri['resources_jsonl_rows']:raise ValueError('PRI row count differs from summary')
                db.execute('INSERT INTO sources VALUES(?,?,?,?)',('pri/summary.json',str(pri_path),sha(pri_path),'MRT resource schema/map/qualifier/candidate inspection'))
                db.execute('INSERT INTO sources VALUES(?,?,?,?)',('pri/resources.jsonl',str(rows_path),sha(rows_path),'Named resource candidates, not runtime selection'))
                report['pri']=pri['counts']
            xbf_path=output/'xbf/summary.json'
            if xbf_path.is_file():
                report['xbf']=index_xbf(db,root/'XboxAppPackage_2610.1001.20.0_x64.msix',xbf_path)
            signature_inputs={'native-signatures-xbox.json':'XboxAppPackage_2610.1001.20.0_x64.msix',
                              'native-signatures-gamebar.json':'GameBar_7.326.10141.0_x64.appx'}
            for filename, archive_name in signature_inputs.items():
                signature_path=output/filename
                if not signature_path.is_file():continue
                report.setdefault('native_signatures',{})[filename]=index_signatures(db,root/archive_name,signature_path)
            flow_path=output/'control-flow.json'
            if flow_path.is_file():
                flow=json.loads(flow_path.read_text())
                if flow['errors'] or flow['bundle_sha256'] != sha(root/'index.bundle'):
                    raise ValueError('Control-flow input hash mismatch or audit errors')
                db.execute('INSERT INTO sources VALUES(?,?,?,?)',('control-flow.json',str(flow_path),sha(flow_path),'Switch/exception table bounds and target checks; not complete semantics'))
                for row in flow['functions']:
                    db.execute('INSERT INTO control_flow VALUES(?,?)',(row['function_id'],json.dumps(row,separators=(',',':'))))
                report['control_flow']={'counts':flow['counts'],'errors':len(flow['errors']),'limitations':flow['limitations']}
            db.execute('INSERT INTO meta VALUES(?,?)',('summary',json.dumps(report)))
            db.commit()
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Reference database integrity check failed')
        finally:
            db.close()
        summary=Path(staging)/'summary.json'
        summary.write_text(json.dumps(report,indent=2)+'\n')
        publish_generation(temporary,summary,output)
    return report


def query(db, args):
    db.row_factory = sqlite3.Row
    if args.command == 'status':
        return json.loads(db.execute("SELECT value FROM meta WHERE key='summary'").fetchone()[0])
    if args.command == 'search':
        # Literal substring search; %, _, quote and SQL fragments have no syntax.
        term = '%' + args.term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        strings = db.execute("SELECT id,value FROM strings WHERE value LIKE ? ESCAPE '\\' LIMIT ?",(term,args.limit)).fetchall()
        return {'strings':[dict(r) | {'value':r['value'][:300], 'function_ids':[f[0] for f in db.execute('SELECT function_id FROM string_refs WHERE string_id=? LIMIT 30',(r['id'],))]} for r in strings],
            'functions':[dict(r) for r in db.execute("SELECT * FROM functions WHERE name LIKE ? ESCAPE '\\' LIMIT ?",(term,args.limit))],
            'native_types':[dict(r) for r in db.execute("SELECT * FROM native_types WHERE name LIKE ? ESCAPE '\\' OR methods_json LIKE ? ESCAPE '\\' LIMIT ?",(term,term,args.limit))]}
    if args.command == 'resource':
        term='%' + args.term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        if args.language:
            rows=db.execute("SELECT * FROM resource_candidates WHERE resource_key LIKE ? ESCAPE '\\' AND UPPER(language)=UPPER(?) LIMIT ?",(term,args.language,args.limit)).fetchall()
        else:rows=db.execute("SELECT * FROM resource_candidates WHERE resource_key LIKE ? ESCAPE '\\' LIMIT ?",(term,args.limit)).fetchall()
        return {'candidates':[{k:row[k] for k in row.keys() if k!='detail_json'}|{'detail':json.loads(row['detail_json'])} for row in rows],
                'scope':'Declared resource candidates only. Language filtering does not implement Windows qualifier resolution or prove UI use.'}
    if args.command == 'xbf':
        term='%' + args.term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        rows=db.execute("SELECT * FROM xbf_nodes WHERE member LIKE ? ESCAPE '\\' AND detail_json LIKE ? ESCAPE '\\' LIMIT ?",('%'+args.member.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%',term,args.limit)).fetchall()
        return {'nodes':[{k:row[k] for k in row.keys() if k!='detail_json'}|{'detail':json.loads(row['detail_json'])} for row in rows],
                'scope':'Persisted native XBF nodes; not a render tree, main React Native geometry or event execution.'}
    if args.command == 'member':
        term='%' + args.term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        rows=db.execute("SELECT * FROM native_members WHERE name LIKE ? ESCAPE '\\' OR type_name LIKE ? ESCAPE '\\' LIMIT ?",(term,term,args.limit)).fetchall()
        return {'members':[{key:row[key] for key in row.keys() if key!='detail_json'}|{'detail':json.loads(row['detail_json'])} for row in rows],
                'scope':'WinMD metadata contract only. No native implementation or portable ABI is established.'}
    if args.command == 'files':
        term='%' + args.term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
        return {'files':[dict(r) for r in db.execute("SELECT * FROM files WHERE path LIKE ? ESCAPE '\\' LIMIT ?",(term,args.limit))]}
    if args.command == 'module':
        row=db.execute('SELECT * FROM modules WHERE id=?',(args.id,)).fetchone()
        if row is None:
            raise ValueError('Unknown module ID')
        return {'module':dict(row),'declared_dependencies':[dict(r) for r in db.execute('SELECT * FROM module_dependencies WHERE owner_id=? ORDER BY slot',(args.id,))],
            'scope':'Declared dependencies/registration pattern; not proof that every import executed.'}
    if args.command == 'function':
        row = db.execute('SELECT * FROM functions WHERE id=?',(args.id,)).fetchone()
        if row is None:
            raise ValueError('Unknown function ID')
        return {'function':dict(row),'strings':[dict(r) for r in db.execute('SELECT s.* FROM strings s JOIN string_refs r ON s.id=r.string_id WHERE r.function_id=?',(args.id,))],
            'explicit_function_refs':[dict(r) for r in db.execute('SELECT f.* FROM functions f JOIN function_refs r ON f.id=r.target_id WHERE r.owner_id=?',(args.id,))],
            'explicit_referrers':[dict(r) for r in db.execute('SELECT f.* FROM functions f JOIN function_refs r ON f.id=r.owner_id WHERE r.target_id=?',(args.id,))],
            'string_sites':[dict(r) for r in db.execute('SELECT * FROM string_sites WHERE function_id=? LIMIT 300',(args.id,))],
            'typed_function_refs':[dict(r) for r in db.execute('SELECT * FROM typed_function_refs WHERE owner_id=?',(args.id,))],
            'control_flow':[json.loads(r[0]) for r in db.execute('SELECT detail_json FROM control_flow WHERE function_id=?',(args.id,))],
            'module_factories':[dict(r) for r in db.execute('SELECT * FROM modules WHERE factory_id=?',(args.id,))],
            'scope':'Explicit refs can be closure creation; this is not a complete call graph. Exact sites are capped at 300; use the evidence script --function for all instructions.'}
    raise ValueError('Unknown query')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path('work/reference'))
    parser.add_argument('--output',type=Path,default=Path('work/reference/library'))
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('build'); commands.add_parser('status')
    search=commands.add_parser('search');search.add_argument('term');search.add_argument('--limit',type=int,default=12)
    function=commands.add_parser('function');function.add_argument('id',type=int)
    module=commands.add_parser('module');module.add_argument('id',type=int)
    resource=commands.add_parser('resource');resource.add_argument('term');resource.add_argument('--language');resource.add_argument('--limit',type=int,default=8)
    xbf=commands.add_parser('xbf');xbf.add_argument('term');xbf.add_argument('--member',default='');xbf.add_argument('--limit',type=int,default=8)
    member=commands.add_parser('member');member.add_argument('term');member.add_argument('--limit',type=int,default=8)
    files=commands.add_parser('files');files.add_argument('term');files.add_argument('--limit',type=int,default=12)
    args=parser.parse_args()
    if not 1 <= getattr(args,'limit',12) <= 100:
        parser.error('limit must be 1..100')
    if args.command == 'build':
        result=build(args.root,args.output)
    else:
        path=(args.output/'reference.sqlite3').resolve()
        with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
            result=query(db,args)
    print(json.dumps(result,ensure_ascii=True,indent=2))


if __name__ == '__main__': main()
