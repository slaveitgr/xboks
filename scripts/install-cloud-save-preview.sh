#!/usr/bin/env bash
set -euo pipefail

# Installs a locally built PR #28 xgameruntime DLL as a separate Proton release.
# Usage: install-cloud-save-preview.sh BUILT_DLL RUNTIME_ROOT XGAMERUNTIME_COMMIT

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 BUILT_DLL RUNTIME_ROOT XGAMERUNTIME_COMMIT" >&2
  exit 2
fi

source_dll=$(realpath -e -- "$1")
runtime_root=$(realpath -e -- "$2")
source_commit=$3
if [[ ! $source_commit =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a full 40-character xgameruntime commit.' >&2
  exit 2
fi
if [[ $(file -b -- "$source_dll") != *'PE32+ executable for WINE (DLL)'* ]]; then
  echo 'The source is not a 64-bit Wine DLL.' >&2
  exit 2
fi
if ! grep -a -q 'XODUS_BRIDGE_PORT' "$source_dll"; then
  echo 'The DLL lacks the Xodus TCP bridge patch.' >&2
  exit 2
fi
if ! grep -a -q 'XODUS_PACKAGE_LOCALE' "$source_dll"; then
  echo 'The DLL lacks the XODUS_PACKAGE_LOCALE patch.' >&2
  exit 2
fi
if grep -a -q 'xodus-userstate-v1' "$source_dll" || grep -a -q 'xodus-userguest-v1' "$source_dll"; then
  echo 'The DLL carries the XUserGetState/XUserGetIsGuest research patches, which regress the in-game offline choice after a cloud save loads.' >&2
  echo 'Build with scripts/build-cloud-save-preview.sh, which excludes them.' >&2
  exit 2
fi
if pgrep -x xodus-cli >/dev/null || pgrep -x xodus-service >/dev/null || pgrep -x wine >/dev/null || pgrep -x wine64 >/dev/null; then
  echo 'A Xodus/game process is active; wait until it exits.' >&2
  exit 1
fi

pointer="$runtime_root/current.json"
releases="$runtime_root/releases"
base_name=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).name' "$pointer")
if [[ $base_name =~ ^(proton-xodus-[A-Za-z0-9._-]+)-xgamesave-pr28-[0-9a-f]{10}(-bridge-v1(-userstate-v1(-userguest-v1)?)?)?(-locale-v1)?$ ]]; then
  base_name=${BASH_REMATCH[1]}
fi
if [[ ! $base_name =~ ^proton-xodus-[A-Za-z0-9._-]+$ ]]; then
  echo 'The active runtime pointer has an unexpected release name.' >&2
  exit 1
fi
if [[ $base_name == *-xgamesave-pr28-* ]]; then
  echo 'The active cloud-save preview has an unknown base release.' >&2
  exit 1
fi
base="$releases/$base_name"
if [[ ! -x "$base/files/bin/wine" || ! -f "$base/files/lib/wine/x86_64-windows/xgameruntime.dll" ]]; then
  echo 'The active Proton release is incomplete.' >&2
  exit 1
fi
target_name="${base_name}-xgamesave-pr28-${source_commit:0:10}-bridge-v1-locale-v1"
target="$releases/$target_name"
if [[ -e $target ]]; then
  echo "Target already exists: $target" >&2
  exit 1
fi

staging=$(mktemp -d "$releases/.staging-xgamesave-XXXXXXXX")
trap 'if [[ -n ${staging:-} && -d $staging ]]; then rm -rf -- "$staging"; fi' EXIT
cp -a --reflink=auto "$base/." "$staging/"
install -m 0644 -- "$source_dll" "$staging/files/lib/wine/x86_64-windows/xgameruntime.dll"
install -m 0644 -- "$source_dll" "$staging/files/share/default_pfx/drive_c/windows/system32/xgameruntime.dll"
"$staging/files/bin/wine" --version >/dev/null

dll_sha=$(sha256sum "$source_dll" | cut -d ' ' -f 1)
SOURCE_COMMIT="$source_commit" DLL_SHA="$dll_sha" TARGET_NAME="$target_name" node - "$staging" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
fs.writeFileSync(path.join(dir, 'XODUS_NEXUS_PATCH.json'), JSON.stringify({
  name: 'xgamesave-pr28-bridge-v1-locale-v1',
  source: 'https://github.com/xodus-gaming/xgameruntime/pull/28',
  description: 'PR #28 stack with the Xodus TCP bridge and XPackageGetUserLocale support. The XUserGetState/XUserGetIsGuest research patches are deliberately excluded: they regressed the in-game offline choice after a cloud save loaded.',
  xgameruntimeCommit: process.env.SOURCE_COMMIT,
  patchedDllSha256: process.env.DLL_SHA,
  features: ['cloud-saves-pr28', 'xodus-tcp-bridge-v1', 'xuser', 'xthreading', 'xnetworking', 'package-locale'],
  warning: 'Experimental unmerged PR. Cloud saves are two-way and may upload or delete remote saves. Includes XODUS_PACKAGE_LOCALE support for game language selection.',
  installedAt: new Date().toISOString(),
}, null, 2) + '\n');
NODE

mv -- "$staging" "$target"
staging=''
POINTER="$pointer" TARGET="$target" TARGET_NAME="$target_name" node <<'NODE'
const fs = require('node:fs');
const previous = JSON.parse(fs.readFileSync(process.env.POINTER, 'utf8'));
const next = {
  ...previous,
  name: process.env.TARGET_NAME,
  winePath: `${process.env.TARGET}/files/bin/wine`,
  installedAt: new Date().toISOString(),
};
const tmp = `${process.env.POINTER}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', {mode: 0o600});
fs.renameSync(tmp, process.env.POINTER);
NODE
echo "Activated $target_name (DLL SHA-256 $dll_sha). The previous release remains untouched."
