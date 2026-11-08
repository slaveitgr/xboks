#!/usr/bin/env python3
"""Stage Linux Gaming Mode; install only with explicit --install.

Never enables an extension, changes settings, restarts Shell or logs out.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

UUID = 'xboks-experience@slaveitgr.github.io'
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'desktop' / 'gnome' / UUID
SETTINGS_SCHEMA = 'org.gnome.shell.extensions.linux-gaming-mode'
FILES = ('metadata.json', 'extension.js', 'state.js', 'native-state.js',
         'native-auth.js', 'switcher.js', 'switcher-state.js', 'switcher-theme.js',
         'window-policy.js', 'home-apps.js', 'home-launcher.js', 'feral-gamemode.js', 'prefs.js',
         'stylesheet.css', 'README.md', 'LICENSE', 'schemas/' + SETTINGS_SCHEMA + '.gschema.xml')


def stage(destination, source_directory=SOURCE):
    destination = Path(destination).absolute()
    destination.mkdir(parents=True, exist_ok=False)
    bundle = destination / UUID
    bundle.mkdir()
    try:
        hashes = {}
        for name in FILES:
            source = Path(source_directory) / name
            if not source.is_file() or source.is_symlink():
                raise ValueError('Missing or unsafe extension source: ' + name)
            data = source.read_bytes()
            if not data or len(data) > 256 * 1024:
                raise ValueError('Invalid extension source size: ' + name)
            target = bundle / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            hashes[name] = hashlib.sha256(data).hexdigest()
        metadata = json.loads((bundle / 'metadata.json').read_text())
        if metadata['uuid'] != UUID or metadata['shell-version'] != ['51'] or metadata['session-modes'] != ['user'] or metadata.get('settings-schema') != SETTINGS_SCHEMA:
            raise ValueError('Unexpected extension identity or supported Shell version.')
        schema = ElementTree.fromstring((bundle / 'schemas' / (SETTINGS_SCHEMA + '.gschema.xml')).read_bytes())
        if schema.tag != 'schemalist' or not any(item.get('id') == SETTINGS_SCHEMA for item in schema.findall('schema')):
            raise ValueError('The preferences schema does not match extension metadata.')
        # Compile the copied XML, never a source-tree or pre-existing binary.
        # Preferences and Shell load the same locally shipped schema on install.
        subprocess.run(['glib-compile-schemas', '--strict', str(bundle / 'schemas')],
                       check=True, capture_output=True, text=True, timeout=10)
        compiled = bundle / 'schemas/gschemas.compiled'
        if not compiled.is_file() or compiled.is_symlink() or not 0 < compiled.stat().st_size <= 2 * 1024 * 1024:
            raise ValueError('Schema compiler did not produce a valid bundle.')
        hashes['schemas/gschemas.compiled'] = hashlib.sha256(compiled.read_bytes()).hexdigest()
        (destination / 'stage-manifest.json').write_text(json.dumps({'schema': 1, 'uuid': UUID, 'sha256': hashes}, indent=2) + '\n')
        return bundle
    except Exception:
        shutil.rmtree(destination)
        raise


def install(bundle):
    version = subprocess.run(['gnome-shell', '--version'], check=True, capture_output=True, text=True, timeout=5).stdout
    if not re.fullmatch(r'GNOME Shell 51(?:\.[0-9A-Za-z.-]+)?\s*', version):
        raise ValueError('Linux Gaming Mode supports only the inspected GNOME Shell 51 API.')
    data = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
    target = data / 'gnome-shell/extensions' / UUID
    if target.exists() or target.is_symlink():
        raise ValueError('Extension destination already exists; no files were replaced.')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(bundle, target)
    return target


def pack(bundle, destination):
    """Create an installable archive with verified entries at its root."""
    bundle = Path(bundle).resolve()
    destination = Path(destination).absolute()
    if destination.resolve() == bundle or bundle in destination.resolve().parents:
        raise ValueError('Archive output must be outside the staged extension directory.')
    manifest = json.loads((bundle.parent / 'stage-manifest.json').read_text())
    expected = set(FILES) | {'schemas/gschemas.compiled'}
    if manifest.get('uuid') != UUID or set(manifest.get('sha256', {})) != expected:
        raise ValueError('Unexpected staging manifest.')
    entries = []
    for name in sorted(expected):
        source = bundle / name
        if not source.is_file() or source.is_symlink():
            raise ValueError('Missing or unsafe staged source: ' + name)
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['sha256'][name]:
            raise ValueError('Staged source changed after verification: ' + name)
        entries.append((name, data))
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also refuses symlinks and never replaces an artifact.
    with destination.open('xb') as stream:
        try:
            with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, data in entries:
                    archive.writestr(name, data)
        except Exception:
            destination.unlink()
            raise
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New staging directory, outside the live GNOME extension directory')
    parser.add_argument('--source', type=Path, default=SOURCE, help='Extension source directory (packaged: resources/gnome-extension/' + UUID + ')')
    parser.add_argument('--archive', type=Path, help='Create a new installable .shell-extension.zip outside the staged bundle')
    parser.add_argument('--install', action='store_true', help='Explicitly copy the staged extension into this user’s extension directory; does not enable it')
    args = parser.parse_args()
    data = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share').resolve()
    output = Path(args.output).resolve()
    live = (data / 'gnome-shell/extensions').resolve()
    if output == live or live in output.parents:
        parser.error('Use --output outside the live extension directory; --install is the explicit installation action.')
    try:
        bundle = stage(output, args.source)
        print('Staged: ' + str(bundle))
        if args.archive:
            print('Archive: ' + str(pack(bundle, args.archive)))
        if args.install:
            print('Installed inactive: ' + str(install(bundle)))
        print('No extension enabled, desktop settings changed, Shell restarted or session ended.')
    except (OSError, ValueError, ElementTree.ParseError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
