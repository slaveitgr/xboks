#!/usr/bin/env bash
set -euo pipefail

# Restore the preserved PR #28 TCP-bridge runtime without changing game files or saves.
# Usage: use-previous-cloud-runtime.sh RUNTIME_ROOT

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 RUNTIME_ROOT" >&2
  exit 2
fi
runtime_root=$(realpath -e -- "$1")
if pgrep -x xodus-cli >/dev/null || pgrep -x xodus-service >/dev/null || pgrep -x wine >/dev/null || pgrep -x wine64 >/dev/null; then
  echo 'A Xodus/game process is active; close it before changing the runtime.' >&2
  exit 1
fi

node - "$runtime_root" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2];
const pointerFile = path.join(root, 'current.json');
const current = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
const match = current.name.match(/^(proton-xodus-[A-Za-z0-9._-]+-xgamesave-pr28-[0-9a-f]{10}-bridge-v1)(?:-locale-v1)?(?:-userstate-v1(?:-userguest-v1)?)?$/);
if (!match) throw new Error('The active release is not a recognized cloud-save preview; pointer unchanged.');
const name = match[1];
if (name === current.name) {
  console.log('The previous cloud runtime is already active.');
  process.exit(0);
}
const release = path.join(root, 'releases', name);
const winePath = path.join(release, 'files', 'bin', 'wine');
const dllPath = path.join(release, 'files', 'lib', 'wine', 'x86_64-windows', 'xgameruntime.dll');
const metadata = JSON.parse(fs.readFileSync(path.join(release, 'XODUS_NEXUS_PATCH.json'), 'utf8'));
if (!metadata.features?.includes('cloud-saves-pr28') ||
    !metadata.features?.includes('xodus-tcp-bridge-v1') ||
    metadata.features?.includes('xuser-state-v1'))
  throw new Error('Previous release metadata does not match the known TCP-bridge preview; pointer unchanged.');
fs.accessSync(winePath, fs.constants.X_OK);
const digest = crypto.createHash('sha256').update(fs.readFileSync(dllPath)).digest('hex');
if (digest !== metadata.patchedDllSha256)
  throw new Error('Previous runtime DLL checksum mismatch; pointer unchanged.');

const backup = path.join(root, `current.json.before-bridge-rollback-${Date.now()}.json`);
fs.copyFileSync(pointerFile, backup, fs.constants.COPYFILE_EXCL);
const next = { ...current, name, winePath, installedAt: new Date().toISOString() };
const temporary = path.join(root, `.current-bridge-rollback-${process.pid}.json`);
try {
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, pointerFile);
} finally {
  try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(`Activated ${name}. Previous pointer saved to ${backup}. Saves and releases unchanged.`);
NODE
