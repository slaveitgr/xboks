#!/bin/sh
# Steam's injected overlay can crash Electron before JavaScript starts (including
# the font bootstrap). Filter only that library, retaining other preloads and
# Steam's launch/tracking environment. Never evaluate or glob loader tokens.
if [ -n "${LD_PRELOAD-}" ]; then
  xboks_filtered_preload=$(
    set -f
    IFS=' :'
    xboks_preload_result=
    xboks_preload_removed=
    for xboks_preload_entry in $LD_PRELOAD; do
      [ -n "$xboks_preload_entry" ] || continue
      case "${xboks_preload_entry##*/}" in
        gameoverlayrenderer.so) xboks_preload_removed=1 ;;
        *)
          if [ -n "$xboks_preload_result" ]; then
            xboks_preload_result="$xboks_preload_result:$xboks_preload_entry"
          else
            xboks_preload_result=$xboks_preload_entry
          fi ;;
      esac
    done
    # A sentinel preserves literal trailing newlines in unrelated loader tokens.
    if [ -n "$xboks_preload_removed" ]; then
      printf '%s.' "$xboks_preload_result"
    else
      printf '%s.' "$LD_PRELOAD"
    fi
  )
  xboks_filtered_preload=${xboks_filtered_preload%.}
  if [ "$xboks_filtered_preload" != "$LD_PRELOAD" ]; then
    if [ -n "$xboks_filtered_preload" ]; then
      export LD_PRELOAD="$xboks_filtered_preload"
    else
      unset LD_PRELOAD
    fi
  fi
  unset xboks_filtered_preload
fi
app_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
binary="$app_root/${0##*/}.bin"
# Native helper modes must retain their normal behavior, including Crashpad.
if [ "${ELECTRON_RUN_AS_NODE-}" = 1 ]; then exec "$binary" "$@"; fi
# Steam's GTK input module can deliver the same text twice to Electron. Scope
# the fallback to the top-level Game Mode session, before native GTK starts.
# The main process restores Steam's module for non-Electron child processes.
unset XBOKS_STEAM_IME XODUS_NEXUS_STEAM_IME
unset XBOKS_FONTCONFIG XBOKS_FONTCONFIG_ORIGINAL_SET XBOKS_FONTCONFIG_ORIGINAL
unset XODUS_NEXUS_FONTCONFIG XODUS_NEXUS_FONTCONFIG_ORIGINAL_SET XODUS_NEXUS_FONTCONFIG_ORIGINAL
case ":${XDG_CURRENT_DESKTOP-}:" in
  *:[gG][aA][mM][eE][sS][cC][oO][pP][eE]:*)
    if [ "${GTK_IM_MODULE-}" = Steam ]; then
      export XBOKS_STEAM_IME=1
      export GTK_IM_MODULE=simple
    fi ;;
esac
original_set="${FONTCONFIG_FILE+x}"
original="${FONTCONFIG_FILE-}"
config=$(ELECTRON_RUN_AS_NODE=1 "$binary" "$app_root/resources/font-bootstrap/bootstrap.mjs")
if [ -n "$config" ]; then
  export XBOKS_FONTCONFIG="$config"
  export XBOKS_FONTCONFIG_ORIGINAL_SET="$original_set"
  export XBOKS_FONTCONFIG_ORIGINAL="$original"
  export FONTCONFIG_FILE="$config"
fi
exec "$binary" "$@"
