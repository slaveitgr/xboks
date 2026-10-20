#!/usr/bin/env python3
"""Inspect MSIX metadata and the Hermes header without executing package code."""
import argparse
import collections
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('bundle', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
ns = {'b': 'http://schemas.microsoft.com/appx/2013/bundle',
      'a': 'http://schemas.microsoft.com/appx/manifest/foundation/windows10'}
with args.bundle.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
with zipfile.ZipFile(args.bundle) as bundle:
    bundle_manifest = ET.fromstring(bundle.read('AppxMetadata/AppxBundleManifest.xml'))
    app = next(p for p in bundle_manifest.findall('b:Packages/b:Package', ns)
               if p.get('Type') == 'application' and p.get('Architecture') == 'x64')
    with zipfile.ZipFile(io.BytesIO(bundle.read(app.attrib['FileName']))) as package:
        entries = package.infolist()
        manifest = ET.fromstring(package.read('AppxManifest.xml'))
        bytecode = package.read('Bundle/index.bundle')
        magic, version = struct.unpack_from('<QI', bytecode)
        # Only the stable prefix is read. Version-specific string tables and
        # function records are deliberately not interpreted using a guessed layout.
        report = {
            'bundle': {'bytes': args.bundle.stat().st_size, 'sha256': digest},
            'identity': manifest.find('a:Identity', ns).attrib,
            'x64_package': app.attrib['FileName'],
            'entry_count': len(entries),
            'extensions': dict(sorted(collections.Counter(Path(e.filename).suffix.lower() or '[none]' for e in entries).items())),
            'dependencies': [e.attrib for e in manifest.findall('a:Dependencies/a:PackageDependency', ns)],
            'executables': sorted(e.filename for e in entries if e.filename.endswith('.exe')),
            'compiled_xaml': sorted(e.filename for e in entries if e.filename.endswith('.xbf')),
            'source_maps': sorted(e.filename for e in entries if e.filename.endswith('.map')),
            'ui_bundle': {'bytes': len(bytecode), 'magic_hex': hex(magic),
                          'hermes_magic_matches': magic == 0x1F1903C103BC1FC6,
                          'bytecode_version': version},
            'scope': 'Static metadata inspection only; no Windows code executed; no signature verification.'
        }
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(f"Wrote {args.output}: {report['entry_count']} entries; Hermes={report['ui_bundle']['hermes_magic_matches']}, version={version}")
