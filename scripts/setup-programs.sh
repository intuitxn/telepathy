#!/bin/sh
# Set up the Intuitxn programs on the Buzz relay: channels, NIP-MP projects, members,
# canvases, shared-file notes, and the JTBD workflow.
#
# The repo's programs/*.md and scripts/* are the source of truth; this script creates the
# relay objects they describe. Idempotent: existing channels/projects are left alone,
# notes upsert by name, canvases replace.
#
# Requirements:
#   - buzz CLI on PATH (or set BUZZ_BIN)
#   - BUZZ_PRIVATE_KEY (hex or nsec) in the environment — never stored in any file
#   - the identity must already be a member of the intuitxn community (Buzz Desktop)
#
# Usage:
#   BUZZ_PRIVATE_KEY=... ./scripts/setup-programs.sh <owner-pubkey> [member-pubkey ...]
# The telepathy agent bot identity is always added as a bot member.

set -eu

buzz_bin="${BUZZ_BIN:-buzz}"
agent_pubkey="051722e8fd76e5c5b508c3f84e0d6ba2398b95d4692be43cfd56b4d238ee068f"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if ! command -v "$buzz_bin" >/dev/null 2>&1; then
  echo "buzz CLI not found (set BUZZ_BIN to its path)" >&2; exit 1
fi
if [ -z "${BUZZ_PRIVATE_KEY:-}" ]; then
  echo "Set BUZZ_PRIVATE_KEY (hex or nsec) in the environment first." >&2; exit 1
fi
if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <owner-pubkey-hex> [member-pubkey-hex ...]" >&2; exit 1
fi
owner_pubkey="$1"; shift

channel_uuid() { # channel_uuid <name>
  "$buzz_bin" channels list     | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((c.get('id') or c.get('uuid') or c.get('channel_id') for c in d if c.get('name')=='$1'), ''))"
}

ensure_channel() { # ensure_channel <name> <type>
  uuid="$(channel_uuid "$1")"
  if [ -n "$uuid" ]; then
    echo "channel $1 exists: $uuid"
  else
    echo "creating channel $1 ($2)..."
    "$buzz_bin" channels create --name "$1" --type "$2" --visibility open >/dev/null
    uuid="$(channel_uuid "$1")"
    if [ -z "$uuid" ]; then echo "failed to create channel $1" >&2; exit 1; fi
    echo "created channel $1: $uuid"
  fi
  echo "$uuid"
}

ensure_project() { # ensure_project <slug> <name> <channel-uuid>
  if "$buzz_bin" projects list 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); ps=d if isinstance(d,list) else d.get('projects',[]); exit(0 if any(p.get('slug')=='$1' or (p.get('tags') or []).__contains__(['d','$1']) for p in ps) else 1)"; then
    echo "project $1 exists"
  else
    echo "creating project $1..."
    if "$buzz_bin" projects create "$1" --name "$2" --channel "$3" --visibility listed >/dev/null 2>&1; then
      echo "created project $1"
    else
      echo "project $1 already exists on the relay (conflict) — continuing"
    fi
  fi
}

add_member() { # add_member <channel-uuid> <pubkey> <role>
  if [ "$3" = "owner" ]; then
    "$buzz_bin" channels add-member --channel "$1" --pubkey "$2" >/dev/null 2>&1 \
      && echo "  member (creator is owner): $2" || echo "  member: $2 (already added or pending)"
  else
    "$buzz_bin" channels add-member --channel "$1" --pubkey "$2" --role "$3" >/dev/null 2>&1 \
      && echo "  member $3: $2" || echo "  member $3: $2 (already added or pending)"
  fi
}

set_canvas() { # set_canvas <channel-uuid> <file>
  if [ -f "$script_dir/$2" ]; then
    "$buzz_bin" canvas set --channel "$1" --content - < "$script_dir/$2" >/dev/null       && echo "canvas set on channel ($2)"
  fi
}

publish_note() { # publish_note <name> <title> <tag> <repo-relative-path>
  if [ -f "$repo_dir/$4" ]; then
    "$buzz_bin" notes set --name "$1" --title "$2" --tag "$3" --content - < "$repo_dir/$4" >/dev/null       && echo "note published: $1 <- $4"
  else
    echo "skipping note $1: $4 not found" >&2
  fi
}

t_channel="$(ensure_channel telepathy stream)"
s_channel="$(ensure_channel sansara stream)"
i_channel="$(ensure_channel iktara stream)"
g_channel="$(ensure_channel intuitxn-general forum)"
c_channel="$(ensure_channel changelog stream)"
f_channel="$(ensure_channel shared-files stream)"

ensure_project telepathy "Telepathy" "$t_channel"
ensure_project sansara "Sansara" "$s_channel"
ensure_project iktara "Iktara" "$i_channel"

echo ""
echo "Members:"
for ch in "$t_channel" "$s_channel" "$i_channel" "$g_channel" "$c_channel" "$f_channel"; do
  add_member "$ch" "$owner_pubkey" owner
  for pubkey in "$@"; do add_member "$ch" "$pubkey" member; done
  add_member "$ch" "$agent_pubkey" bot
done

echo ""
echo "Canvases:"
set_canvas "$t_channel" canvas-telepathy.md
set_canvas "$c_channel" canvas-changelog.md
set_canvas "$f_channel" canvas-shared-files.md

echo ""
echo "Shared files (team knowledge base):"
while IFS='|' read -r name title tag path; do
  [ -n "$name" ] || continue
  case "$name" in \#*) continue;; esac
  publish_note "$name" "$title" "$tag" "$path"
done < "$script_dir/shared-files.list"

# JTBD workflow on the telepathy channel (non-fatal: schema may need a first tweak)
if [ -f "$script_dir/jtbd-workflow.yaml" ]; then
  if "$buzz_bin" workflows create --channel "$t_channel" --yaml "$(cat "$script_dir/jtbd-workflow.yaml")" >/dev/null 2>&1; then
    echo ""
    echo "workflow jtbd created on channel telepathy"
  else
    echo "workflow create failed (check schema) — continuing; channels and projects are unaffected" >&2
  fi
fi

echo ""
echo "Publish the telepathy code to the relay (run once, then push over NIP-98):"
echo "  $buzz_bin repos create --id telepathy --clone <relay>/git/<your-pubkey>/telepathy"
echo "  git -C '$repo_dir' remote add buzz <relay>/git/<your-pubkey>/telepathy"
echo "  git -C '$repo_dir' push -u buzz main"

echo ""
echo "Copy these into $repo_dir/.local/config.json (desk intake = program channels only):"
echo "  \"channels\": [\"$t_channel\", \"$s_channel\", \"$i_channel\"],"
echo "  \"authorizedPubkeys\": [\"$owner_pubkey\"$([ $# -gt 0 ] && printf ', \"%s\"' "$@")],"
