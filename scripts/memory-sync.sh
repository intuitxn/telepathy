#!/bin/sh
# Mirror Buzz agent memory to a local root for Bend checks.
# Contract (fixed by sibling Bend side; do not change):
#   <root>/memory.in holds one "slug|digest" line per entry, sorted by slug,
#   where digest is sha256 hex of the body bytes.
#   <root>/memory/<slug> holds body bytes with "/" replaced by "__".
# Only reads via the buzz CLI; never prints key material; no daemon.
set -eu

RELAY="https://intuitxn.communities.buzz.xyz"
BUZZ="${BUZZ:-$HOME/.local/bin/buzz}"

usage() {
    cat <<'HELP'
usage: memory-sync.sh sync <root>
       memory-sync.sh ls <root>
       memory-sync.sh get <root> <slug>
       memory-sync.sh ensure <root>
       memory-sync.sh help
HELP
}

die() { echo "memory-sync: $*" >&2; exit 1; }

is_hex64() {
    [ "${#1}" -eq 64 ] || return 1
    case "$1" in
        *[!0-9a-fA-F]*) return 1 ;;
        *) return 0 ;;
    esac
}

abspath() {
    case "$1" in /*) printf '%s' "$1" ;; *) printf '%s' "$PWD/$1" ;; esac
}

sha_hex() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d' ' -f1
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        die "no shasum/sha256sum available"
    fi
}

encode_slug() {
    printf '%s' "$1" | sed 's|/|__|g'
}

# Load read-only signing identity into env only; never print it.
load_identity() {
    if [ -z "${BUZZ_PRIVATE_KEY:-}" ] || [ "${BUZZ_PRIVATE_KEY}" = "None" ]; then
        BUZZ_PRIVATE_KEY="$(security find-generic-password -s buzz-desktop -w 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("identity") or "")' 2>/dev/null || true)"
    fi
    [ -n "${BUZZ_PRIVATE_KEY:-}" ] && [ "${BUZZ_PRIVATE_KEY}" != "None" ] || die "identity unavailable"
    export BUZZ_PRIVATE_KEY
    BUZZ_RELAY_URL="$RELAY"
    export BUZZ_RELAY_URL
    [ -x "$BUZZ" ] || die "buzz CLI not found"
}

# Print owner pubkey (64-hex, public) or nothing. Never prints secrets.
owner_pubkey() {
    if [ -n "${BUZZ_OWNER_PUBKEY:-}" ] && is_hex64 "$BUZZ_OWNER_PUBKEY"; then
        printf '%s' "$BUZZ_OWNER_PUBKEY"
        return 0
    fi
    /usr/bin/python3 -c '
import os, sys
v = os.environ.get("BUZZ_PRIVATE_KEY", "")
try:
    if v.startswith("nsec"):
        cs = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
        s = v.lower(); pos = s.rfind("1")
        data = [cs.find(c) for c in s[pos+1:]]
        payload = data[:-6]
        acc = 0; bits = 0; out = bytearray()
        for x in payload:
            acc = (acc << 5) | x; bits += 5
            while bits >= 8:
                bits -= 8; out.append((acc >> bits) & 0xff)
        priv = int.from_bytes(bytes(out), "big")
    else:
        priv = int(v.strip(), 16)
    P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
    Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
    Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
    def add(A, B):
        if A is None: return B
        if B is None: return A
        x1, y1 = A; x2, y2 = B
        if x1 == x2 and (y1 + y2) % P == 0: return None
        s = (pow(2*y1, P-2, P) * (3*x1*x1)) % P if (x1 == x2 and y1 == y2) else (pow((x2-x1) % P, P-2, P) * (y2-y1)) % P
        x3 = (s*s - x1 - x2) % P; y3 = (s*(x1-x3) - y1) % P
        return (x3, y3)
    R = None; A = (Gx, Gy); k = priv
    while k:
        if k & 1: R = add(R, A)
        A = add(A, A); k >>= 1
    sys.stdout.write(format(R[0], "064x"))
except Exception:
    pass
' 2>/dev/null || true
}

# Print candidate agent pubkeys (64-hex, public), one per line. Never prints secrets.
agent_pubkeys() {
    /usr/bin/python3 -c '
import json, os, re
seen = set()
hex64 = re.compile(r"^[0-9a-fA-F]{64}$")
try:
    import subprocess
    raw = subprocess.check_output(["security", "find-generic-password", "-s", "buzz-desktop", "-w"], text=True, stderr=subprocess.DEVNULL)
    d = json.loads(raw)
    for k in d.keys():
        if k.startswith("agent:"):
            pub = k.split(":", 1)[1]
            if hex64.match(pub): seen.add(pub.lower())
except Exception:
    pass
try:
    p = os.path.expanduser("~/Library/Application Support/xyz.block.buzz.app/agents/managed-agents.json")
    with open(p) as f:
        for e in json.load(f):
            pub = (e.get("pubkey") or "")
            if hex64.match(pub): seen.add(pub.lower())
except Exception:
    pass
for tok in (os.environ.get("MEMORY_SYNC_AGENTS", "") + " " + os.environ.get("BUZZ_MEM_AGENTS", "")).split():
    if hex64.match(tok): seen.add(tok.lower())
for pub in sorted(seen):
    print(pub)
' 2>/dev/null || true
}

# List slugs (one per line) for a scope; exit nonzero on relay failure.
buzz_slugs() {
    scope="$1"; pub="$2"; out="$3"
    if [ "$scope" = "owner" ]; then
        "$BUZZ" mem ls --json --owner "$pub" >"$out" 2>/dev/null || return 1
    else
        "$BUZZ" mem ls --json --agent "$pub" >"$out" 2>/dev/null || return 1
    fi
    /usr/bin/python3 -c '
import json, sys
with open(sys.argv[1]) as f: d = json.load(f)
for e in sorted((x.get("slug") or "") for x in d):
    if e: print(e)
' "$out" || return 1
}

do_sync() {
    root="$(abspath "${1:?root required}")"
    mkdir -p "$root/memory"
    load_identity
    tmpd="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmpd'" EXIT INT TERM
    : >"$tmpd/entries"
    owner_pub="$(owner_pubkey || true)"
    if [ -n "$owner_pub" ] && is_hex64 "$owner_pub"; then
        if buzz_slugs owner "$owner_pub" "$tmpd/ls.json" >"$tmpd/slugs" 2>/dev/null; then
            while IFS= read -r s; do [ -n "$s" ] && printf 'owner|%s\n' "$s" >>"$tmpd/entries"; done <"$tmpd/slugs"
        fi
    fi
    agents="$(agent_pubkeys || true)"
    if [ -n "$agents" ]; then
        for ap in $agents; do
            is_hex64 "$ap" || continue
            if buzz_slugs agent "$ap" "$tmpd/ls.json" >"$tmpd/slugs" 2>/dev/null; then
                while IFS= read -r s; do [ -n "$s" ] && printf 'agent|%s\n' "$s" >>"$tmpd/entries"; done <"$tmpd/slugs"
            fi
        done
    fi
    LC_ALL=C sort -u -t'|' -k2,2 "$tmpd/entries" >"$tmpd/uniq" || : >"$tmpd/uniq"
    # first scope wins per slug (owner attempted first); deterministic
    /usr/bin/python3 -c '
import sys
seen = {}
for line in open(sys.argv[1]):
    line = line.rstrip("\n")
    if not line or "|" not in line: continue
    sc, slug = line.split("|", 1)
    if slug and slug not in seen: seen[slug] = sc
with open(sys.argv[2], "w") as f:
    for slug in sorted(seen): f.write(seen[slug] + "|" + slug + "\n")
' "$tmpd/uniq" "$tmpd/final" || : >"$tmpd/final"
    : >"$tmpd/index"
    own=0; ag=0
    while IFS='|' read -r scope slug; do
        [ -n "$slug" ] || continue
        enc="$(encode_slug "$slug")"
        case "$enc" in */*|"" ) die "bad slug" ;; esac
        body="$tmpd/body"
        if [ "$scope" = "owner" ]; then
            "$BUZZ" mem get "$slug" --owner "$owner_pub" >"$body" 2>/dev/null || die "get failed"
        else
            got=""
            for ap in $agents; do
                if "$BUZZ" mem get "$slug" --agent "$ap" >"$body" 2>/dev/null; then got=1; break; fi
            done
            [ -n "$got" ] || die "get failed"
        fi
        d="$(sha_hex "$body")"
        printf '%s|%s\n' "$slug" "$d" >>"$tmpd/index"
        cp "$body" "$root/memory/$enc"
        if [ "$scope" = "owner" ]; then own=$((own+1)); else ag=$((ag+1)); fi
    done <"$tmpd/final"
    LC_ALL=C sort -t'|' -k1,1 "$tmpd/index" >"$root/memory.in"
    n=$((own + ag))
    printf 'sync: %d entries (owner:%d agent:%d) to %s\n' "$n" "$own" "$ag" "$root"
    while IFS='|' read -r scope slug; do
        [ -n "$slug" ] || continue
        printf '%s %s\n' "$scope" "$slug"
    done <"$tmpd/final"
    trap - EXIT INT TERM
    rm -rf "$tmpd"
}

do_ls() {
    root="$(abspath "${1:?root required}")"
    [ -f "$root/memory.in" ] || die "no index"
    /usr/bin/python3 -c '
import sys
for line in open(sys.argv[1]):
    line = line.rstrip("\n")
    if line and "|" in line: print(line.split("|", 1)[0])
' "$root/memory.in"
}

do_get() {
    root="$(abspath "${1:?root required}")"; slug="${2:?slug required}"
    enc="$(encode_slug "$slug")"
    case "$enc" in */*|"" ) die "bad slug" ;; esac
    [ -f "$root/memory/$enc" ] || die "unknown slug"
    cat "$root/memory/$enc"
}

do_ensure() {
    root="$(abspath "${1:?root required}")"
    if [ ! -s "$root/memory.in" ]; then
        do_sync "$root"
        return 0
    fi
    n="$(wc -l <"$root/memory.in" | tr -d ' ')"
    mt="$(stat -f %m "$root/memory.in" 2>/dev/null || stat -c %Y "$root/memory.in" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    age=$((now - mt))
    [ "$age" -ge 0 ] || age=0
    printf 'fresh: %s entries age %ss %s\n' "$n" "$age" "$root"
}

cmd="${1:-help}"
case "$cmd" in
    sync) shift; do_sync "${1:?root required}" ;;
    ls) shift; do_ls "${1:?root required}" ;;
    get) shift; do_get "${1:?root required}" "${2:?slug required}" ;;
    ensure) shift; do_ensure "${1:?root required}" ;;
    help|-h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
esac
