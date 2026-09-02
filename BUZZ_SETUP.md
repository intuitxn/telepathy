# Buzz setup — make Telepathy live and share agents across the team

Everything below is gated on one owner action, then it is a short sequence of
commands. Buzz is the source of truth; opencode2 runs the agents; git holds the
repo (which is how agents ship to everyone).

## 0. One owner action (unblocks everything)

The relay `https://intuitxn.communities.buzz.xyz` is membership-gated. Add the
Telepathy agent identity to the intuitxn community in Buzz Desktop:

```
agent pubkey: 051722e8fd76e5c5b508c3f84e0d6ba2398b95d4692be43cfd56b4d238ee068f
```

Until this happens every `buzz` write returns `403 relay_membership_required`.
This is correct — it is the team's private space, and provisioning is a human gate.

## 1. Load the plugin

```bash
cd telepathy
npm --prefix plugins/telepathy install
opencode2 plugin add file:./plugins/telepathy     # installs locally
# or rely on the repo's opencode.json ("plugin": ["./plugins/telepathy/src/index.ts"])
```

## 2. Create the shared channels (once)

```bash
buzz channels create --name telepathy --type stream --visibility open
buzz channels create --name intuitxn-general --type forum --visibility open
```

## 3. Share the agents — add the team and the agent as members

Resolve each member's pubkey (`buzz users get --pubkey <hex>` or from Desktop),
then add them to the shared channels so everyone sees the same agents:

```bash
buzz channels add-member --channel <channel-uuid> --pubkey <shubham-pubkey>
buzz channels add-member --channel <channel-uuid> --pubkey <om-pubkey>
buzz channels add-member --channel <channel-uuid> --pubkey <kush-pubkey>
buzz channels add-member --channel <channel-uuid> --pubkey 051722e8fd76e5c5b508c3f84e0d6ba2398b95d4692be43cfd56b4d238ee068f
```

The repo itself is the shareable agent surface: `.opencode/agents/` (main +
5 meta-agents) and `plugins/telepathy/` ship with git, so anyone who clones and
runs opencode2 in the repo gets the same agents — no per-user install.

## 4. Verify end-to-end

```bash
cd telepathy/plugins/telepathy
set -a; . ./.env; set +a
buzz channels list                      # agent can see the shared channels
buzz messages send --channel <uuid> --content - <<'EOF'
## Update: Telepathy is live
what changed / why it matters / what we need from you
EOF
```

Then ask opencode2's `@telepathy` agent to post — it drafts, and the human
approves the send through opencode's permission prompt.

## 5. Server + subdomain (making it live for the team)

- Run opencode2 on the server over SSH (the shared-session runtime you mentioned).
- `BUZZ_PRIVATE_KEY` + `BUZZ_RELAY_URL` live in the server's env, not in the repo.
- Point `telepathy.intuitxn.com` at the deployed `site/` (GitHub Pages already
  serves the internal alpha at intuitxn.github.io/telepathy).
- Sessions shared via opencode2 `session.share` so one workspace is visible to
  Shubham, Om, and Kush.
