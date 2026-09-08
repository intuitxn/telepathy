#!/bin/sh
# Desk watch wrapper for launchd. Load the existing private environment directly
# so launch-agent ordering does not race identity initialization.
set +x
if [ -r "$HOME/.config/buzz/environment.sh" ]; then
  . "$HOME/.config/buzz/environment.sh"
fi
# Existing interactive fallback: desktop keychain.
if [ -z "$BUZZ_PRIVATE_KEY" ] || [ "$BUZZ_PRIVATE_KEY" = "None" ]; then
  export BUZZ_PRIVATE_KEY="$(security find-generic-password -s buzz-desktop -w 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["identity"])' 2>/dev/null)"
fi
if [ -z "$BUZZ_PRIVATE_KEY" ] || [ "$BUZZ_PRIVATE_KEY" = "None" ]; then
  echo "identity unavailable" >&2
  exit 1
fi
export INTUITXN_NETWORK="${INTUITXN_NETWORK:-${BUZZ_RELAY_URL:-https://intuitxn.communities.buzz.xyz}}"
export BUZZ_RELAY_URL="$INTUITXN_NETWORK"
export INTUITXN_HOME="${INTUITXN_HOME:-$HOME/.local/share/telepathy-host/shared}"
cd "$(dirname "$0")/.." || exit 1
exec node runtime/desk/src/cli.js watch
