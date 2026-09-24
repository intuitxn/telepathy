#!/bin/sh
# bundle/verify.sh - re-walk covered set, recompute sha256, compare to manifest.
# No network, no deletes (repo files untouched), no daemon. Deterministic output.
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/manifest.json"
if command -v shasum >/dev/null 2>&1; then
  HASH="shasum -a 256"
else
  HASH="sha256sum"
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "MISSING python3" >&2
  exit 2
fi
if [ ! -f "$MANIFEST" ]; then
  echo "MISSING $MANIFEST" >&2
  exit 2
fi
cd "$ROOT"
TMP_DISK="$(mktemp)"
TMP_MAN="$(mktemp)"
trap 'rm -f "$TMP_DISK" "$TMP_MAN"' EXIT INT TERM
# --- re-walk the covered set (deterministic, LC_ALL=C sorted) ---
{
  if [ -d runtime ]; then
    find runtime -type f -name '*.bend' \
      -not -path '*/.git/*' -not -path '*/node_modules/*' \
      -not -path '*/.local/*' -not -path '*/ops/runs/*' \
      -not -name '*.log' -not -path '*/secrets/*' -not -path 'secrets/*' 2>/dev/null || true
  fi
  if [ -d scripts ]; then
    find scripts -maxdepth 1 -type f -name '*.sh' \
      -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null || true
  fi
  if [ -f mundus ]; then
    printf 'mundus\n'
  fi
  if [ -d tasks/frozen ]; then
    find tasks/frozen -type f -not -name '*.log' \
      -not -path '*/.git/*' -not -path '*/node_modules/*' \
      -not -path '*/.local/*' -not -path '*/ops/runs/*' \
      -not -path '*/secrets/*' 2>/dev/null || true
  fi
} | LC_ALL=C sort -u > "$TMP_DISK"
# --- dump manifest entries as: path<TAB>sha256-or-ABSENT ---
python3 - "$MANIFEST" "$TMP_MAN" <<'PY'
import json, sys
man_path, out_path = sys.argv[1], sys.argv[2]
with open(man_path, 'r', encoding='utf-8') as f:
    man = json.load(f)
with open(out_path, 'w', encoding='utf-8') as out:
    for e in man.get("contents", []):
        p = e.get("path", "")
        if "sha256" in e:
            out.write(p + "\t" + e["sha256"] + "\n")
        else:
            out.write(p + "\tABSENT\n")
PY
FAIL=0
# --- compare each manifest entry against disk ---
while IFS="$(printf '\t')" read -r path want; do
  [ -n "$path" ] || continue
  if [ "$want" = "ABSENT" ]; then
    if [ -e "$ROOT/$path" ]; then
      echo "MISMATCH $path (manifest absent, file exists)"
      FAIL=1
    else
      echo "OK $path (absent as recorded)"
    fi
  else
    if [ ! -f "$path" ]; then
      echo "ABSENT $path"
      FAIL=1
    else
      got=$($HASH "$path" | cut -d' ' -f1)
      if [ "$got" = "$want" ]; then
        echo "OK $path"
      else
        echo "MISMATCH $path"
        FAIL=1
      fi
    fi
  fi
done < "$TMP_MAN"
# --- detect EXTRA files on disk not listed in manifest ---
python3 - "$TMP_MAN" "$TMP_DISK" <<'PY' > "$TMP_DISK.extra"
import sys
man_path, disk_path = sys.argv[1], sys.argv[2]
listed = set()
with open(man_path, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        listed.add(line.split("\t", 1)[0])
with open(disk_path, 'r', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip("\n")
        if p and p not in listed:
            print("EXTRA " + p)
PY
if [ -s "$TMP_DISK.extra" ]; then
  LC_ALL=C sort "$TMP_DISK.extra"
  rm -f "$TMP_DISK.extra"
  FAIL=1
else
  rm -f "$TMP_DISK.extra"
fi
# --- recompute + compare bundle digest (canonical JSON of name/version/contents) ---
DIGEST_LINE=$(python3 - "$MANIFEST" <<'PY'
import json, hashlib, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    man = json.load(f)
obj = {"name": man["name"], "version": man["version"], "contents": man["contents"]}
canon = json.dumps(obj, sort_keys=True, separators=(',', ':'))
recomputed = hashlib.sha256(canon.encode('utf-8')).hexdigest()
print("manifest:%s recomputed:%s" % (man.get("digest", ""), recomputed))
PY
)
MAN_DIGEST=$(printf '%s' "$DIGEST_LINE" | sed 's/^manifest:\([^ ]*\) recomputed:.*/\1/')
RECOMPUTED=$(printf '%s' "$DIGEST_LINE" | sed 's/^.* recomputed://')
echo "digest $RECOMPUTED"
if [ "$MAN_DIGEST" != "$RECOMPUTED" ]; then
  echo "MISMATCH digest (manifest $MAN_DIGEST != recomputed $RECOMPUTED)"
  FAIL=1
fi
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT PASS"
else
  echo "RESULT FAIL"
fi
exit "$FAIL"
