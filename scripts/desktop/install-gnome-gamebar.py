#!/usr/bin/env python3
"""Bind GNOME Super+G to an existing xboks launcher; preserve other bindings."""
import argparse
import ast
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--command', required=True, help='Absolute launcher command including --game-bar')
args = parser.parse_args()
schema = 'org.gnome.settings-daemon.plugins.media-keys'
entry_schema = schema + '.custom-keybinding'
entry = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/xboks-gamebar/'
def get(schema, key):
    return subprocess.check_output(['gsettings', 'get', schema, key], text=True).strip()
def put(schema, key, value):
    subprocess.run(['gsettings', 'set', schema, key, value], check=True)
raw = get(schema, 'custom-keybindings')
entries = ast.literal_eval(raw.removeprefix('@as '))
for item in entries:
    if item != entry and get(entry_schema + ':' + item, 'binding') in ("'<Super>g'", "'<Super>G'"):
        raise SystemExit('Super+G is already assigned; existing shortcut was preserved.')
put(entry_schema + ':' + entry, 'name', 'xboks Game Bar')
put(entry_schema + ':' + entry, 'command', args.command)
put(entry_schema + ':' + entry, 'binding', '<Super>g')
if entry not in entries:
    put(schema, 'custom-keybindings', repr(entries + [entry]))
print('GNOME Win+G → ' + args.command)
