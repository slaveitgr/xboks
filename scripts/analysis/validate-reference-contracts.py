#!/usr/bin/env python3
"""Check public UI contract locators against the versioned local evidence.
No source packages are executed; no runtime verification is inferred.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct


# Microsoft.GamingApp 2610.1001.20.0 x64 index.bundle and the Hermes
# facebook/hermes v0.13.0 BytecodeList.def used for its v96 instruction set.
# These pins bind public FIDs/offsets to their actual build, not a mutable index.
MENU_BUNDLE_SHA256 = '4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55'
MENU_OPCODES_SHA256 = '62bfc95c5ab7d96bc58c31f1a9faa8772afb9500d5f87e541c8a3623645f1a85'
MENU_REFERENCE = {'application': 'Microsoft.GamingApp', 'version': '2610.1001.20.0',
                  'architecture': 'x64', 'bytecode_version': 96}


def function_reader():
    path = Path(__file__).with_name('build-xbox-function-evidence.py')
    spec = importlib.util.spec_from_file_location('contract_function_evidence', path)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    return reader


def validate_menu_contracts(contracts, reference, *,
                            expected_bundle_sha256=MENU_BUNDLE_SHA256,
                            expected_opcodes_sha256=MENU_OPCODES_SHA256):
    """Check only cited functions against freshly decoded, hash-bound bytes.

    Expected hashes are keyword-injectable for synthetic reader tests. The CLI
    always uses the pinned production hashes. private_trace is an explanatory
    locator only: it is neither read nor used as decoding evidence.
    """
    result = {'menu_rule_records': 0, 'menu_functions_decoded': 0,
              'menu_instruction_locators': 0, 'menu_source_binding': {}, 'issues': []}
    issues = result['issues']
    try:
        document = json.loads((contracts/'menu-behavior-contracts.json').read_text())
    except (OSError, ValueError) as error:
        issues.append(f'Menu contracts cannot be read: {error}')
        return result
    if not isinstance(document, dict):
        issues.append('Menu contracts must be an object')
        return result
    if type(document.get('schema_version')) is not int or document.get('schema_version') != 1:
        issues.append('Unsupported menu contract schema version')
    if document.get('reference') != MENU_REFERENCE:
        issues.append('Menu contract build identity does not match the pinned source')
    rules = document.get('rules')
    if not isinstance(rules, list) or not rules:
        issues.append('Menu rules must be a nonempty list')
        return result
    result['menu_rule_records'] = len(rules)
    counts = document.get('counts', {})
    if not isinstance(counts, dict):
        counts = {}
    if type(counts.get('rules')) is not int or counts.get('rules') != len(rules):
        issues.append('Menu rule count mismatch')
    if type(counts.get('original_runtime_verified')) is not int or counts.get('original_runtime_verified') != 0:
        issues.append('Menu runtime-verified count must be zero without runtime evidence')

    seen, citations = set(), []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            issues.append(f'Menu rule {index}: expected object')
            continue
        ident = rule.get('id')
        if not isinstance(ident, str) or not ident.strip():
            issues.append(f'Menu rule {index}: invalid rule ID')
            ident = f'row[{index}]'
        elif ident in seen:
            issues.append(f'Menu rule {ident}: duplicate rule ID')
        seen.add(ident)
        if rule.get('original_runtime_verified') is not False:
            issues.append(f'Menu rule {ident}: original_runtime_verified must be false without runtime evidence')
        if rule.get('classification') != 'bounded_static_dataflow':
            issues.append(f'Menu rule {ident}: expected bounded_static_dataflow classification')
        evidence = rule.get('evidence')
        if not isinstance(evidence, list) or not evidence:
            issues.append(f'Menu rule {ident}: missing instruction evidence')
            continue
        for site in evidence:
            if not isinstance(site, dict):
                issues.append(f'Menu rule {ident}: invalid evidence object')
                continue
            fid, offsets = site.get('function_id'), site.get('instruction_offsets')
            if type(fid) is not int or fid < 0:
                issues.append(f'Menu rule {ident}: invalid function ID')
                continue
            if (not isinstance(offsets, list) or not offsets or
                    any(type(value) is not int or value < 0 for value in offsets)):
                issues.append(f'Menu rule {ident}: F{fid} has invalid instruction offsets')
                continue
            if len(offsets) != len(set(offsets)):
                issues.append(f'Menu rule {ident}: F{fid} has duplicate instruction offsets')
            citations.append((ident, fid, offsets))
            result['menu_instruction_locators'] += len(offsets)

    try:
        data = (reference/'index.bundle').read_bytes()
        opcode_bytes = (reference/'hermes-format'/'BytecodeList.def').read_bytes()
        bundle_hash = hashlib.sha256(data).hexdigest()
        opcode_hash = hashlib.sha256(opcode_bytes).hexdigest()
        result['menu_source_binding'] = {'bundle_sha256': bundle_hash,
                                         'opcode_definition_sha256': opcode_hash,
                                         'fresh_metadata': False,
                                         'private_trace_trusted': False}
        if bundle_hash != expected_bundle_sha256:
            issues.append('Menu bundle SHA-256 differs from the pinned source')
        if opcode_hash != expected_opcodes_sha256:
            issues.append('Menu opcode-definition SHA-256 differs from pinned Hermes v96 source')
        if bundle_hash != expected_bundle_sha256 or opcode_hash != expected_opcodes_sha256:
            return result
        reader = function_reader()
        metadata = reader.metadata_reader.inspect(data)
        result['menu_source_binding']['fresh_metadata'] = True
        ops, refs = reader.opcode_tables(opcode_bytes.decode('utf-8'))
    except (OSError, ValueError, struct.error) as error:
        issues.append(f'Menu source decoding failed: {error}')
        return result

    functions, boundaries = metadata['functions'], {}
    for fid in sorted({fid for _, fid, _ in citations}):
        if fid >= len(functions):
            issues.append(f'Menu function F{fid} is outside the actual bundle function table')
            continue
        try:
            rows = reader.decode_function(data, functions[fid], ops, refs,
                                          len(metadata['strings']), len(functions))
            boundaries[fid] = {row['offset'] for row in rows}
            result['menu_functions_decoded'] += 1
        except (ValueError, struct.error, KeyError) as error:
            issues.append(f'Menu function F{fid} cannot be decoded: {error}')
    for ident, fid, offsets in citations:
        if fid in boundaries:
            for offset in offsets:
                if offset not in boundaries[fid]:
                    issues.append(f'Menu rule {ident}: F{fid}+{offset} is not an instruction boundary in the actual bundle')
    return result


def validate(contracts, reference, screenshots=None):
    registry=json.loads((contracts/'ui-actions.json').read_text())
    matrix=json.loads((contracts/'verification-matrix.json').read_text())
    metadata=json.loads((reference/'hermes96-decoded.json').read_text())
    code=json.loads((reference/'hermes96-code-index.json').read_text())
    functions={f['id']:f for f in code['functions']}
    evidence=registry['evidence'];actions=registry['actions'];issues=[]
    ids=[a['id'] for a in actions]
    if len(ids)!=len(set(ids)):issues.append('Duplicate action IDs')
    if registry['counts']['actions']!=len(actions):issues.append('Action count mismatch')
    features=[f['id'] for f in matrix['features']]
    if len(features)!=len(set(features)):issues.append('Duplicate matrix feature IDs')
    for action in actions:
        for ident in action['evidence']:
            if ident not in evidence:issues.append(f"{action['id']}: missing evidence {ident}")
    screenshot_files={}
    if screenshots:
        for path in screenshots.rglob('*.png'):screenshot_files.setdefault(path.name,[]).append(path)
    for ident,item in evidence.items():
        if item['kind']=='hermes_function_index':
            row=functions.get(item['function_id'])
            if row is None or row['name']!=item['name'] or row['instructions']!=item['instructions']:
                issues.append(f'{ident}: function identity differs from the index')
        elif item['kind']=='hermes_string':
            index=item['string_id']
            if not 0<=index<len(metadata['strings']) or metadata['strings'][index]!=item['symbol']:
                issues.append(f'{ident}: string differs from the index')
        elif item['kind']=='screenshot' and screenshots:
            matches=[]
            for path in screenshot_files.get(item['basename'],[]):
                data=path.read_bytes()
                if hashlib.sha256(data).hexdigest()==item['sha256']:
                    if data[:8]!=b'\x89PNG\r\n\x1a\n' or list(struct.unpack_from('>II',data,16))!=item['viewport']:
                        issues.append(f'{ident}: PNG viewport mismatch')
                    matches.append(path)
            if not matches:issues.append(f'{ident}: no matching screenshot fingerprint')
    menu=validate_menu_contracts(contracts, reference)
    issues.extend(menu.pop('issues'))
    return {'action_records':len(actions),'feature_records':len(features),
            'screenshot_records':sum(v['kind']=='screenshot' for v in evidence.values()),
            'screenshot_hashes_checked':screenshots is not None,**menu,'issues':issues,
            'scope':'Locator consistency, including freshly decoded pinned menu instructions; not proof of rule semantics, original Windows behavior or Linux parity.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--contracts',type=Path,default=Path('docs/analysis/reference'))
    parser.add_argument('--reference',type=Path,default=Path('work/reference'))
    parser.add_argument('--screenshots',type=Path)
    args=parser.parse_args()
    result=validate(args.contracts,args.reference,args.screenshots)
    print(json.dumps(result,indent=2))
    raise SystemExit(1 if result['issues'] else 0)
