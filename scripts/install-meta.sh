#!/bin/sh
# Install the native command and role without overwriting prior configuration.
# Existing entries are preserved in a private backup directory. No host restart.
set -eu
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/.." && pwd)
CONFIG=${1:-${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}}
[ "$#" -le 1 ] || { echo 'usage: install-meta.sh [OPENCODE_CONFIG_DIR]' >&2; exit 64; }
for required in runtime/AUTONOMY.md runtime/adaptive/META.md runtime/worker/system.bend mundus .opencode/commands/meta.md .opencode/agents/meta.md; do
    [ -f "$REPO/$required" ] || { echo "meta install: missing $required" >&2; exit 1; }
done
mkdir -p "$CONFIG/commands" "$CONFIG/agents" "$CONFIG/meta-backups"
backup=$(mktemp -d "$CONFIG/meta-backups/install.XXXXXXXX")
for kind in commands agents; do
    target="$CONFIG/$kind/meta.md"
    [ ! -d "$target" ] || { echo "meta install: directory at $target" >&2; exit 1; }
    if [ -e "$target" ] || [ -L "$target" ]; then
        cp -P "$target" "$backup/$kind.meta.md"
    fi
    ln -s "$REPO/.opencode/$kind/meta.md" "$backup/$kind.next"
    mv -f "$backup/$kind.next" "$target"
done
printf 'Meta command and agent point to %s\nPrevious entries preserved at %s\nFresh OpenCode contexts load these entries; active sessions are unchanged.\n' "$REPO" "$backup"
printf 'Use this as the active OpenCode configuration directory: %s\n' "$CONFIG"
