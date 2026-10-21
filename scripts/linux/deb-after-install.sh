#!/bin/sh
# Native Debian/Ubuntu package only. Keep Chromium's sandbox enabled on hosts
# that restrict unprivileged user namespaces. Never elevate a user-owned helper.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
APP_DIR='/opt/xboks'
PARENT_DIR='/opt'
fail() { printf '%s\n' "xboks sandbox setup failed: $*" >&2; exit 1; }
case "${1-}" in configure) ;; *) exit 0 ;; esac
[ "$(id -u)" = 0 ] || fail 'the native package must be configured by the package manager as root.'

owned() {
  [ ! -L "$1" ] || fail "symbolic link is not permitted: $1"
  [ "$(stat -c '%u:%g' -- "$1")" = '0:0' ] || fail "root ownership is required: $1"
  mode=$(stat -c '%a' -- "$1")
  case "$mode" in ''|*[!0-7]*) fail "invalid file mode: $1" ;; esac
  [ "$((0$mode & 022))" = 0 ] || fail "group/other writable path is not permitted: $1"
}
directory() { [ -d "$1" ] || fail "directory is missing: $1"; owned "$1"; }
regular() {
  [ -f "$1" ] || fail "regular file is missing: $1"
  owned "$1"
  [ "$(stat -c '%h' -- "$1")" = 1 ] || fail "hard-linked file is not permitted: $1"
}
directory "$PARENT_DIR"
directory "$APP_DIR"
directory "$APP_DIR/resources"
for file in xboks xboks.bin chrome-sandbox resources/xboks-sandbox.sha256; do regular "$APP_DIR/$file"; done
[ -x "$APP_DIR/xboks" ] && [ -x "$APP_DIR/xboks.bin" ] && [ -x "$APP_DIR/chrome-sandbox" ] || fail 'package executables are not executable.'

# The build hook records the exact native executable and its matching helper.
# Parse exactly two fixed filenames before asking sha256sum to read anything.
manifest="$APP_DIR/resources/xboks-sandbox.sha256"
[ "$(stat -c '%s' -- "$manifest")" -le 256 ] || fail 'sandbox manifest is oversized.'
exec 3<"$manifest"
IFS= read -r native_line <&3 || fail 'native executable checksum is missing.'
IFS= read -r helper_line <&3 || fail 'sandbox helper checksum is missing.'
extra=''
if IFS= read -r extra <&3 || [ -n "$extra" ]; then fail 'unexpected sandbox manifest entry.'; fi
exec 3<&-
checksum_line() {
  digest=${1%%  *}
  [ "${#digest}" = 64 ] || fail 'invalid sandbox checksum.'
  case "$digest" in *[!0-9a-f]*) fail 'invalid sandbox checksum.' ;; esac
  [ "$1" = "$digest  $2" ] || fail 'unexpected sandbox checksum filename.'
}
checksum_line "$native_line" xboks.bin
checksum_line "$helper_line" chrome-sandbox
(cd "$APP_DIR" && sha256sum --strict --check --status resources/xboks-sandbox.sha256) || fail 'native executable/helper checksum mismatch; reinstall the verified package.'

# The image's matching helper is enabled only after fixed-path ownership and
# content validation. Root-owned /opt and package-manager upgrades preserve it.
chown 0:0 -- "$APP_DIR/chrome-sandbox"
chmod 4755 -- "$APP_DIR/chrome-sandbox"
[ "$(stat -c '%u:%g:%a' -- "$APP_DIR/chrome-sandbox")" = '0:0:4755' ] || fail 'sandbox helper permissions were not applied.'
update-alternatives --install /usr/bin/xboks xboks "$APP_DIR/xboks" 100
if command -v update-mime-database >/dev/null 2>&1; then update-mime-database /usr/share/mime || true; fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications || true; fi
