#!/bin/sh
# CI-only pinned toolchain. Source release/tag: bendlang/bend v2.0.21,
# commit 62e7825660327384473304f0001be1b97604eb2c.
# SHA256 comes from the official GitHub release asset metadata:
# https://api.github.com/repos/bendlang/bend/releases/tags/v2.0.21
# Archive layout follows https://bend-lang.com/install.sh (reviewed 2026-09-23).
# Never execute the floating installer or upgrade an existing installation.
set -eu
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'CI installer requires GitHub Actions' >&2; exit 1; }
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo 'Pinned archive requires Linux x86_64' >&2; exit 1; }
: "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}" "${GITHUB_PATH:?}"
bend_ci_dest="$RUNNER_TEMP/bend-2.0.21"
[ ! -e "$bend_ci_dest" ] || { echo 'Toolchain destination already exists' >&2; exit 1; }
bend_ci_tmp=$(mktemp -d "$RUNNER_TEMP/bend-download.XXXXXXXX")
trap 'rm -rf "$bend_ci_tmp"' EXIT
curl --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 180 -fsSL \
  'https://github.com/bendlang/bend/releases/download/v2.0.21/bend-2.0.21-linux-x64.tar.gz' \
  -o "$bend_ci_tmp/archive.tar.gz"
printf '%s  %s\n' '7efce68d47239d5859653deedb2615fd2e048e531ba7025cdcf09e884aca577c' "$bend_ci_tmp/archive.tar.gz" | sha256sum -c -
tar -xzf "$bend_ci_tmp/archive.tar.gz" -C "$bend_ci_tmp"
[ -x "$bend_ci_tmp/bend/bin/bend" ]
[ -f "$bend_ci_tmp/bend/bend2/base.bend" ]
mv "$bend_ci_tmp/bend" "$bend_ci_dest"
BEND_NO_TELEMETRY=1 "$bend_ci_dest/bin/bend" version
{
  printf 'BEND=%s/bin/bend\n' "$bend_ci_dest"
  printf 'BEND_BINARY=%s/bin/bend\n' "$bend_ci_dest"
  printf 'BEND_HOME=%s\n' "$bend_ci_dest"
  printf 'BEND_NO_TELEMETRY=1\n'
} >> "$GITHUB_ENV"
printf '%s/bin\n' "$bend_ci_dest" >> "$GITHUB_PATH"
