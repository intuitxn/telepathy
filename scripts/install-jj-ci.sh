#!/bin/sh
# Pinned official jj release; digest from GitHub release asset metadata.
# https://api.github.com/repos/jj-vcs/jj/releases/tags/v0.45.1
set -eu
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'CI installer requires GitHub Actions' >&2; exit 1; }
[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || { echo 'Pinned archive requires Linux x86_64' >&2; exit 1; }
: "${RUNNER_TEMP:?}" "${GITHUB_PATH:?}"
jj_ci_dest="$RUNNER_TEMP/jj-0.45.1"
[ ! -e "$jj_ci_dest" ] || { echo 'Toolchain destination already exists' >&2; exit 1; }
jj_ci_tmp=$(mktemp -d "$RUNNER_TEMP/jj-download.XXXXXXXX")
trap 'rm -rf "$jj_ci_tmp"' EXIT
curl --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 180 -fsSL \
  'https://github.com/jj-vcs/jj/releases/download/v0.45.1/jj-v0.45.1-x86_64-unknown-linux-musl.tar.gz' \
  -o "$jj_ci_tmp/archive.tar.gz"
printf '%s  %s\n' 'f35438350b5d61963aac5dd74ede510b31d6b9690769d1a6268cf058cc825f72' "$jj_ci_tmp/archive.tar.gz" | sha256sum -c -
python3 - "$jj_ci_tmp/archive.tar.gz" "$jj_ci_dest" <<'PY'
import pathlib, shutil, sys, tarfile
destination = pathlib.Path(sys.argv[2])
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = [m for m in archive.getmembers() if m.isfile() and pathlib.PurePosixPath(m.name).name == 'jj']
    if len(members) != 1:
        raise SystemExit('Expected exactly one jj executable in the verified release')
    destination.mkdir()
    with archive.extractfile(members[0]) as source, (destination / 'jj').open('xb') as target:
        shutil.copyfileobj(source, target)
(destination / 'jj').chmod(0o755)
PY
"$jj_ci_dest/jj" --version
printf '%s\n' "$jj_ci_dest" >> "$GITHUB_PATH"
