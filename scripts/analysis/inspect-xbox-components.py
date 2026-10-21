#!/usr/bin/env python3
"""Statically index native PE strings/exports and managed metadata/IL references.
Requires dnfile and dncil. Never executes input modules or unpacks arbitrary paths.
Raw output belongs in ignored work/reference, not the public repository.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import zipfile
import dnfile
from dncil.cil.body.reader import read_method_body_from_bytes

INTEREST = re.compile(r'account|auth|subscription|identity|library|extension|provider|cloudsave|cloud.?sync|install|launch|gamingapp|gamingservices|xbox|https?://|xsts|tcui|xvd|gamepass|gamer|userpicker|entitlement', re.I)

def inspect(data):
    pe = dnfile.dnPE(data=data, fast_load=False)
    result = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    result['imports'] = sorted({e.dll.decode('ascii', 'replace') for e in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', [])})
    exports = getattr(getattr(pe, 'DIRECTORY_ENTRY_EXPORT', None), 'symbols', [])
    result['exports'] = [e.name.decode('ascii','replace') for e in exports if e.name]
    values = set(m.group().decode('ascii') for m in re.finditer(rb'[\x20-\x7e]{7,}', data))
    values.update(m.group().decode('utf-16-le') for m in re.finditer(rb'(?:[\x20-\x7e]\x00){7,}', data))
    result['relevant_strings'] = sorted(v for v in values if len(v) < 1200 and INTEREST.search(v))
    if pe.net is None or pe.net.mdtables is None:
        return result
    tables = pe.net.mdtables
    owners = {}
    result['types'] = []
    for t in getattr(tables.TypeDef, 'rows', []):
        name = (str(t.TypeNamespace) + '.' + str(t.TypeName)).strip('.')
        methods = [str(m.row.Name) for m in t.MethodList]
        fields = [str(f.row.Name) for f in t.FieldList]
        result['types'].append({'name': name, 'methods': methods, 'fields': fields})
        for m in t.MethodList:
            owners[id(m.row)] = name
    def token_name(value):
        table, rid = value >> 24, value & 0xffffff
        if table == 0x06 and tables.MethodDef and rid <= len(tables.MethodDef.rows):
            row = tables.MethodDef.rows[rid-1]
            return owners.get(id(row),'') + '::' + str(row.Name)
        if table == 0x0a and tables.MemberRef and rid <= len(tables.MemberRef.rows):
            row = tables.MemberRef.rows[rid-1]; parent = row.Class.row
            name = (str(getattr(parent,'TypeNamespace','')) + '.' + str(getattr(parent,'TypeName',''))).strip('.')
            return name + '::' + str(row.Name)
        return hex(value)
    methods = []
    for row in getattr(tables.MethodDef, 'rows', []):
        if not row.Rva or row.ImplFlags.miNative or row.ImplFlags.miRuntime:
            continue
        item = {'name': owners.get(id(row),'') + '::' + str(row.Name), 'rva': row.Rva, 'strings': [], 'calls': []}
        try:
            body = read_method_body_from_bytes(pe.get_data(row.Rva,65536))
            item['instructions'] = len(body.instructions)
            for ins in body.instructions:
                if ins.opcode.name == 'ldstr':
                    value = pe.net.user_strings.get(ins.operand.value & 0xffffff)
                    item['strings'].append({'offset': ins.offset, 'value': value.value if value else None})
                elif ins.opcode.name in ('call','callvirt','newobj'):
                    item['calls'].append({'offset': ins.offset, 'target': token_name(ins.operand.value)})
        except Exception as error:
            item['error'] = str(error)
        methods.append(item)
    result['methods'] = methods
    return result

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=Path)
    parser.add_argument('--select', action='append', default=[], help='Exact entry names; default all managed WinMD and selected application components')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); result={}
    with zipfile.ZipFile(args.package) as z:
        selected=args.select or [n for n in z.namelist() if n.lower().endswith('.winmd') or n.lower() in {
            'gamingservices.exe','gamingservicesnet.exe','gameplatformservices.dll','gamelaunchhelper.dll','gamingservicesproxy.dll','tcui-app.dll','tcui-native.dll',
            'gamingservicestcui/gamingservicestcui.dll','gamingservicesui/gamingservicesuiapp.dll','xgameruntime.dll','xsapi.dll','xcrdapi.dll'}]
        for name in selected:
            try: result[name]=inspect(z.read(name))
            except Exception as error: result[name]={'error':str(error)}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'files':len(result),'managed':sum('types' in r for r in result.values()),'errors':{n:r['error'] for n,r in result.items() if 'error' in r}}))
