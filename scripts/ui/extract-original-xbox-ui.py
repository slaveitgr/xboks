#!/usr/bin/env python3
"""Extract a private visual reference kit from a locally supplied Xbox MSIX.

The generated public/original-xbox directory is deliberately ignored by Git.
No package is downloaded, executed or modified by this script.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--output', type=Path, default=Path('public/original-xbox'))
args = parser.parse_args()
ns = 'http://www.w3.org/2000/svg'
ET.register_namespace('', ns)
fonts = {'regular': 'Assets/Fonts/Segoe-Sans-Text.ttf', 'semibold': 'Assets/Fonts/Segoe-Sans-Text-Semibold.ttf', 'bold': 'Assets/Fonts/Segoe-Sans-Text-Bold.ttf', 'display': 'Assets/Fonts/Segoe-Sans-Display-Semibold.ttf', 'mdl2': 'Assets/Fonts/SegMDL2.ttf', 'xbox': 'Assets/Fonts/XboxFluent2.ttf'}
manifest = {'package_sha256': hashlib.sha256(args.package.read_bytes()).hexdigest(), 'icons': [], 'fonts': {}}
with zipfile.ZipFile(args.package) as package:
    icon_names = [name for name in package.namelist() if '/xds-foundation/svg/' in name and name.endswith('.svg')]
    if not icon_names or not all(source in package.namelist() for source in fonts.values()):
        raise SystemExit('This package does not contain the expected Xbox UI assets.')
    (args.output / 'icons').mkdir(parents=True, exist_ok=True)
    (args.output / 'fonts').mkdir(parents=True, exist_ok=True)
    for name in icon_names:
        root = ET.fromstring(package.read(name))
        for element in root.iter():
            tag = element.tag.split('}')[-1]
            if tag in ('script', 'foreignObject', 'image', 'use'):
                raise SystemExit(f'Unexpected active or referenced SVG content: {name}')
            if not element.tag.startswith('{'):
                element.tag = f'{{{ns}}}{tag}'
        filename = Path(name).name
        (args.output / 'icons' / filename).write_bytes(ET.tostring(root, encoding='utf-8'))
        manifest['icons'].append(Path(name).stem)
    for label, source in fonts.items():
        content = package.read(source)
        (args.output / 'fonts' / f'{label}.ttf').write_bytes(content)
        manifest['fonts'][label] = hashlib.sha256(content).hexdigest()
    provider_sources = {
        'ea': 'EAAppLogo.png', 'epic': 'Epic.png', 'gog': 'Gog.png',
        'steam': 'Steam.png', 'ubisoft': 'UbisoftConnectLogo.png',
    }
    (args.output / 'providers').mkdir(exist_ok=True)
    manifest['providers'] = {}
    for provider, filename in provider_sources.items():
        source = 'Bundle/assets/src/windows/app/assets/' + filename
        content = package.read(source)
        (args.output / 'providers' / f'{provider}.png').write_bytes(content)
        manifest['providers'][provider] = {'member': source, 'sha256': hashlib.sha256(content).hexdigest()}
(args.output / 'theme.css').write_text('''@font-face { font-family: 'Xbox Segoe Text'; src: url('./fonts/regular.ttf') format('truetype'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Xbox Segoe Text'; src: url('./fonts/semibold.ttf') format('truetype'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'Xbox Segoe Text'; src: url('./fonts/bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }
@font-face { font-family: 'Xbox Segoe Display'; src: url('./fonts/display.ttf') format('truetype'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'Xbox Segoe MDL2'; src: url('./fonts/mdl2.ttf') format('truetype'); font-weight: 400; font-display: block; }
@font-face { font-family: 'Xbox Fluent 2'; src: url('./fonts/xbox.ttf') format('truetype'); font-weight: 400; font-display: block; }
html[data-original-xbox-ui] { font-family: 'Xbox Segoe Text', 'Segoe UI', sans-serif; }
html[data-original-xbox-ui] .dashboard-home h1, html[data-original-xbox-ui] .dashboard-home h2 { font-family: 'Xbox Segoe Display', 'Xbox Segoe Text', sans-serif; font-weight: 600; }
''')
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Extracted {len(manifest["icons"])} original icons and {len(fonts)} fonts to {args.output}')
