#!/usr/bin/env python3
"""Stage the optional XBOKS GNOME extension; install only with explicit --install.

Never enables an extension, changes settings, restarts Shell or logs out.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

UUID = 'xboks-experience@slaveitgr.github.io'
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'desktop' / 'gnome' / UUID
FILES = ('metadata.json', 'extension.js', 'state.js', 'switcher.js', 'switcher-state.js', 'switcher-theme.js', 'window-policy.js', 'stylesheet.css', 'README.md')


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
            (bundle / name).write_bytes(data)
            hashes[name] = hashlib.sha256(data).hexdigest()
        metadata = json.loads((bundle / 'metadata.json').read_text())
        if metadata['uuid'] != UUID or metadata['shell-version'] != ['51'] or metadata['session-modes'] != ['user']:
            raise ValueError('Unexpected extension identity or supported Shell version.')
        (destination / 'stage-manifest.json').write_text(json.dumps({'schema': 1, 'uuid': UUID, 'sha256': hashes}, indent=2) + '\n')
        return bundle
    except Exception:
        shutil.rmtree(destination)
        raise


def install(bundle):
    version = subprocess.run(['gnome-shell', '--version'], check=True, capture_output=True, text=True, timeout=5).stdout
    if not re.fullmatch(r'GNOME Shell 51(?:\.[0-9A-Za-z.-]+)?\s*', version):
        raise ValueError('This prototype targets only the inspected GNOME Shell 51 API.')
    data = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')
    target = data / 'gnome-shell/extensions' / UUID
    if target.exists() or target.is_symlink():
        raise ValueError('Extension destination already exists; no files were replaced.')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(bundle, target)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New staging directory, outside the live GNOME extension directory')
    parser.add_argument('--source', type=Path, default=SOURCE, help='Extension source directory (packaged: resources/gnome-extension/' + UUID + ')')
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
        if args.install:
            print('Installed inactive: ' + str(install(bundle)))
        print('No extension enabled, desktop settings changed, Shell restarted or session ended.')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
