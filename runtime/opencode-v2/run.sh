#!/bin/sh
set -eu
pilot_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pilot_root="${INTUITXN_PILOT_ROOT:-$HOME/.local/share/intuitxn-opencode-v2}"
pilot_cli="$pilot_root/node_modules/.bin/opencode2"
if [ ! -x "$pilot_cli" ]; then
  npm install --prefix "$pilot_root" --save-exact @opencode-ai/cli@0.0.0-beta-19192
fi
mkdir -p "$pilot_root/workspace" "$pilot_root/config/opencode" "$pilot_root/data" "$pilot_root/state" "$pilot_root/cache"
cp "$pilot_source/AGENTS.md" "$pilot_source/opencode.json" "$pilot_source/README.md" "$pilot_root/workspace/"
cp "$pilot_source/AGENTS.md" "$pilot_source/opencode.json" "$pilot_root/config/opencode/"
export XDG_CONFIG_HOME="$pilot_root/config"
export XDG_DATA_HOME="$pilot_root/data"
export XDG_STATE_HOME="$pilot_root/state"
export XDG_CACHE_HOME="$pilot_root/cache"
export OPENCODE_DB="$pilot_root/data/opencode/opencode.db"
unset OPENCODE_CONFIG OPENCODE_CONFIG_CONTENT OPENCODE_CONFIG_DIR OPENCODE_DISABLE_PROJECT_CONFIG
cd "$pilot_root/workspace"
exec "$pilot_cli" "$@"
