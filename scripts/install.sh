#!/usr/bin/env bash
# XBOKS user installer.
#
# One-liner (once the repository is public):
#   curl -fsS --location --max-redirs 0 https://raw.githubusercontent.com/slaveitgr/xboks/main/scripts/install.sh | bash
#
# What it does, without further input:
#   1. Installs system prerequisites with your package manager (skip with
#      XBOKS_SKIP_DEPS=1): backend sign-in and Electron runtime libraries.
#      Rust/Cargo/protoc are not needed for the prebuilt backend.
#   2. Downloads the latest verified XBOKS AppImage from GitHub Releases.
#   3. Installs it to ~/.local/opt/xboks, links it into ~/.local/bin
#      and registers a desktop entry with the app icon.
#
# Environment overrides:
#   XBOKS_SKIP_DEPS=1       do not touch system packages
#   XBOKS_APPIMAGE=<file>   install a local AppImage instead of downloading
set -euo pipefail

REPO="slaveitgr/xboks"
PREFIX="${XBOKS_PREFIX:-${XODUS_NEXUS_PREFIX:-$HOME/.local}}"
APP_DIR="$PREFIX/opt/xboks"
BIN_DIR="$PREFIX/bin"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
LOCAL_APPIMAGE="${XBOKS_APPIMAGE:-${XODUS_NEXUS_APPIMAGE:-}}"
SKIP_DEPS="${XBOKS_SKIP_DEPS:-${XODUS_NEXUS_SKIP_DEPS:-0}}"
AS_INSTALLER=0
[[ "${1:-}" == "--skip-deps" ]] && SKIP_DEPS=1
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && AS_INSTALLER=1

if [[ $AS_INSTALLER -eq 1 ]]; then
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m -> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "This installer supports Linux only."
[[ "$(uname -m)" == "x86_64" ]] || die "Only x86_64 builds are published."
command -v curl >/dev/null || die "curl is required to run this installer."

# ---------------------------------------------------------------- system deps
install_deps() {
  local root="$1"; shift
  if [[ $EUID -eq 0 ]]; then
    "$root" "$@"
  elif command -v sudo >/dev/null; then
    sudo "$root" "$@"
  else
    warn "No sudo available; install these packages yourself: $*"
    return 0
  fi
}

if [[ $SKIP_DEPS -eq 1 ]]; then
  warn "Skipping system packages (XBOKS_SKIP_DEPS=1)."
else
  source /etc/os-release 2>/dev/null || true
  distro="${ID:-unknown}"
  case "${ID_LIKE:-}" in
    *arch*) distro=arch ;;
    *debian*) distro=debian ;;
    *fedora*) distro=fedora ;;
  esac
  case "$distro" in
    arch)
      log "Installing prerequisites with pacman (Arch/CachyOS)…"
      install_deps pacman -S --needed --noconfirm \
        curl python3 coreutils tar xz fuse2 \
        gtk3 nss libxtst desktop-file-utils || warn "Some packages failed to install; continuing."
      ;;
    debian)
      log "Installing prerequisites with apt (Debian/Ubuntu)…"
      install_deps apt-get update -y || true
      # Newer distributions renamed some shared libraries for the time64 ABI.
      nexus_fuse=libfuse2; nexus_gtk=libgtk-3-0; nexus_alsa=libasound2
      if apt-cache show libfuse2t64 >/dev/null 2>&1; then nexus_fuse=libfuse2t64; fi
      if apt-cache show libgtk-3-0t64 >/dev/null 2>&1; then nexus_gtk=libgtk-3-0t64; fi
      if apt-cache show libasound2t64 >/dev/null 2>&1; then nexus_alsa=libasound2t64; fi
      install_deps apt-get install -y \
        curl python3 coreutils tar xz-utils "$nexus_fuse" \
        "$nexus_gtk" libnss3 libxtst6 "$nexus_alsa" desktop-file-utils || warn "Some packages failed to install; continuing."
      ;;
    fedora)
      log "Installing prerequisites with dnf (Fedora)…"
      install_deps dnf install -y \
        curl python3 coreutils tar xz fuse \
        gtk3 nss libXtst alsa-lib desktop-file-utils || warn "Some packages failed to install; continuing."
      ;;
    *)
      warn "Unknown distribution '$distro'; install these before first run:"
      warn "  curl python3 coreutils tar xz fuse2 gtk3 nss libxtst"
      ;;
  esac
fi

# ------------------------------------------------------------------ AppImage
command -v python3 >/dev/null || die "Python 3 is required for release/checksum validation."
mkdir -p "$APP_DIR" "$BIN_DIR" "$DESKTOP_DIR"
target="$APP_DIR/xboks.AppImage"
[[ ! -d "$target" && ! -L "$target" ]] || die "The installation target must be a regular file or absent."
install_stage="$(mktemp -d "$APP_DIR/.install-XXXXXXXX")"
trap 'rm -rf -- "$install_stage"' EXIT
script_directory=""
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi
validator="$script_directory/installer-release.py"
if [[ ! -f "$validator" ]]; then
  # Piped bootstrap: use the same owned source origin as this installer.
  validator="$install_stage/installer-release.py"
  curl -fsS --proto '=https' --location --max-redirs 0 --max-time 30 --max-filesize 65536 \
    -o "$validator" "https://raw.githubusercontent.com/$REPO/main/scripts/installer-release.py" \
    || die "Could not load the XBOKS release validator."
fi
if [[ -n "$LOCAL_APPIMAGE" ]]; then
  [[ -f "$LOCAL_APPIMAGE" ]] || die "XBOKS_APPIMAGE points to a missing file."
  log "Validating local AppImage…"
  python3 "$validator" --verify-local "$LOCAL_APPIMAGE" || die "Local AppImage validation failed; previous install kept."
  install -m 0755 "$LOCAL_APPIMAGE" "$install_stage/xboks.AppImage"
else
  log "Finding and verifying the newest published XBOKS launcher…"
  python3 "$validator" --output "$install_stage/xboks.AppImage" \
    || die "No verified XBOKS download was installed; previous install kept."
fi
mv -- "$install_stage/xboks.AppImage" "$target"

log "Installing application files…"
curl -fsS --proto '=https' --location --max-redirs 0 --max-time 30 --max-filesize 2097152 -o "$install_stage/icon.png" \
  "https://raw.githubusercontent.com/$REPO/main/assets/icon.png" \
  && mv -- "$install_stage/icon.png" "$APP_DIR/icon.png" \
  || warn "Could not download the icon; the previous or generic icon will be used."

ln -sf "$target" "$BIN_DIR/xboks"

cat > "$DESKTOP_DIR/xboks.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=XBOKS
Comment=Open-source Xbox-inspired game launcher
Exec="$BIN_DIR/xboks" %U
Icon=$APP_DIR/icon.png
Terminal=false
Categories=Game;
StartupWMClass=xboks
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$DESKTOP_DIR" || true

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) warn "Add $BIN_DIR to PATH to run 'xboks' from a terminal (usually already in ~/.profile)." ;;
esac

log "XBOKS installed."
cat <<'EOF'

First run:
  1. Start XBOKS from your application menu (or: xboks).
  2. Open Settings -> XBOKS Engine to configure the backend and runtime.
     Downloads use slaveitgr/xboks releases and verify published checksums.
     A complete compatible release must exist; there is no upstream fallback
     or automatic source compilation when an owned release is unavailable.
  3. Sign in through Account, then browse the Store and install your games.
EOF
