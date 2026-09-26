#!/bin/sh
# Compatibility entrypoint: local ownership now uses jj workspaces, not Git branches.
set -eu
JJ="${JJ:-jj}"
"$JJ" root >/dev/null
exec "$JJ" status --no-pager
