#!/bin/sh
# Refresh the team knowledge-base notes from the repo's canonical shared files.
# Reads scripts/shared-files.list: name|title|tag|repo-relative-path
# Requires: buzz CLI, BUZZ_PRIVATE_KEY (env; falls back to the desktop keychain identity).
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
if ! command -v buzz >/dev/null 2>&1; then echo "refresh-notes: buzz CLI not found" >&2; exit 0; fi
if [ -z "${BUZZ_PRIVATE_KEY:-}" ]; then
  BUZZ_PRIVATE_KEY="$(security find-generic-password -s buzz-desktop -w 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["identity"])' 2>/dev/null)"
fi
if [ -z "${BUZZ_PRIVATE_KEY:-}" ] || [ "$BUZZ_PRIVATE_KEY" = "None" ]; then echo "refresh-notes: identity unavailable" >&2; exit 0; fi
export BUZZ_PRIVATE_KEY
export BUZZ_RELAY_URL="${BUZZ_RELAY_URL:-https://intuitxn.communities.buzz.xyz}"
while IFS='|' read -r name title tag path; do
  [ -n "$name" ] || continue
  case "$name" in \#*) continue;; esac
  if [ -f "$repo_dir/$path" ]; then
    if buzz notes set --name "$name" --title "$title" --tag "$tag" --content - < "$repo_dir/$path" >/dev/null 2>&1; then
      echo "note refreshed: $name"
    else
      echo "note refresh failed: $name" >&2
    fi
  fi
done < "$script_dir/shared-files.list"
