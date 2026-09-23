# agent-directory.json — derivation notes

Machine-readable companion to [`../../AGENT_DIRECTORY.md`](../../AGENT_DIRECTORY.md).
This file records exactly how `agent-directory.json` maps onto the prose
directory and which fields could not be derived verbatim. It is a draft; it
creates no external effect, authorizes no commit, and contains no secrets,
session IDs, receipts, transcripts, prompts, or tool calls.

## Source paths

- Prose directory: `docs/AGENT_DIRECTORY.md`
- Agent charters: `.opencode/agents/{telepathy,prime,build,steward,research,relationships,bend-forge,relay-keeper}.md`
- This JSON: `docs/drafts/meta/agent-directory.json`
- These notes: `docs/drafts/meta/agent-directory-notes.md`

## Top-level keys

| JSON key | Derived from |
|---|---|
| `source.directory` | Fixed path to the canonical prose document. |
| `source.charters` | Fixed glob for the charter files it cites. |
| `source.derivation` | Summary of the three source parts used (A1, A2, B). |
| `agents` | `docs/AGENT_DIRECTORY.md` Part A1 agent table plus the "Per-agent authority" block; charter H1 titles and frontmatter `mode`. |
| `sessionKinds` | `docs/AGENT_DIRECTORY.md` Part A2 session-kind table plus its per-kind paragraphs. |
| `trajectories` | `docs/AGENT_DIRECTORY.md` Part B trajectory tables T1–T6. |

## `agents[]` (Part A1)

One object per row of the Part A1 table (A1.1–A1.8), in table order. Field map:

| JSON field | Source |
|---|---|
| `id` | Row label `A1.1` … `A1.8`. |
| `name` | Charter H1 heading in `.opencode/agents/<charter>.md` (e.g. `telepathy.md` → `Telepathy`, `prime.md` → `Prime — project steward`). The table's `@handle` canonical form is intentionally not used as `id` so the id is stable and file-traceable; the handle appears in the prose table. |
| `charterPath` | Part A1 "Charter" column, verbatim. |
| `mode` | Charter YAML frontmatter `mode:` (`primary` for A1.1, `subagent` for A1.2–A1.8); matches the Part A1 "Mode" column. |
| `runtime` | Part A1 "Runtime" column, verbatim. |
| `jtbd` | Part A1 "JTBD" column, verbatim. |
| `may[]` | The "May" bullets in the Part A1 "Per-agent authority" block, cross-checked against the charter `## You may` section. For A1.1 `@telepathy` the bullets come only from the prose block because that charter has no explicit `## You may` section. Each item keeps the directory's `file:line` citation. |
| `mustNot[]` | The "Must not" bullets in the same block (charters `## You must not`). Each item keeps the `file:line` citation. |

Agents not represented, per AGENT_DIRECTORY.md's own authority note
(lines 8–22): `plugins/telepathy-meta-agents/bend-specialist.md` (unmerged
draft, not canonical) and the retired names `@atlas`, `@forge`, `@ledger`,
`@scout`, `@diplomat`. The three charter-only agents `@telepathy`,
`@bend-forge`, `@relay-keeper` have no registry entry and are included here
because the directory lists them as canonical.

## `sessionKinds[]` (Part A2)

One object per row of the Part A2 table (A2.1–A2.4), in table order.

| JSON field | Source |
|---|---|
| `id` | Row label `A2.1` … `A2.4`. |
| `identityMechanism` | Table "Identity mechanism" column, verbatim (`<agent>:<id8>` is the documented display-name shape, not an actual identifier). |
| `store` | Table "Where state lives" column, verbatim. |
| `durability` | Table "Lifetime" column, collapsed to `ephemeral` or `durable` — see caveat below. |

## `trajectories[]` (Part B)

One object per trajectory section (T1–T6), in document order. `id` is the
section label and `title` is the section heading text.

| JSON field | Source |
|---|---|
| `title` | The `### T*` heading, verbatim (arrow characters preserved). |
| `hops[].from` / `.to` | The hop table "Source → Sink" cell, split on `→`. |
| `hops[].store` | The hop table "Store" column, verbatim. |
| `hops[].transition` | The hop table "Transition (file:line)" column, verbatim. |
| `hops[].durability` | The hop table "Lifetime" column, collapsed — see caveat below. |

Hop counts: T1=4, T2=5, T3=6, T4=5, T5=9, T6=3 (32 total). Every hop row in
the prose is present exactly once; no hop was added or dropped.

## Fields that could not be derived verbatim

1. **`durability` is a forced binary.** AGENT_DIRECTORY.md uses compound
   lifetime phrases. The JSON emits a single `ephemeral` | `durable` value using
   the rule: *classify the persistence of the hop's output/record, not every
   side effect named in the cell.* The prose remains authoritative for the
   compound cases:
   - A2.1 "ephemeral coordination; registry disposable" → `ephemeral`.
   - A2.2 "live, disposable" → `ephemeral`.
   - A2.3 "job durable, worktree disposable" → `durable` (the session kind's
     durable ledger/job; the detached worktree is the disposable part and is
     represented as `ephemeral` on hop T2.2).
   - A2.4 "durable evidence, single writer" → `durable`.
   - T1.1 "durable relay; job durable" → `durable`; T1.3 "cursor durable, page
     ephemeral" → `durable` (output is the cursor); T1.4 "draft durable until
     sent" → `durable`.
   - T6.1 "ephemeral run, retained report" → `ephemeral` (output is the run
     directory; the retained report is not a separate hop here).
   If a consumer needs the exact compound wording, read the prose table cell.
2. **`name`** is taken from the charter H1 rather than the `@handle`, because the
   JSON `id` already carries the directory row label and the prose table carries
   the handle. This is a presentation choice, not an added fact.
3. **`source`** is metadata added to make the derivation self-describing; it is
   not an entry and does not name any agent, kind, or trajectory.
4. **No field was left underivable.** Every agent, session kind, and trajectory
   in AGENT_DIRECTORY.md is represented exactly once, and every value traces to a
   Part A1/A2 table row, a Part B hop row, a charter path/title, or the `source`
   metadata above.

## Verification run

- `node -e "const d=require('./docs/drafts/meta/agent-directory.json'); console.log('agents',d.agents.length,'kinds',d.sessionKinds.length,'trajectories',d.trajectories.length,'hops',d.trajectories.reduce((a,t)=>a+t.hops.length,0));"`
  → `agents 8 kinds 4 trajectories 6 hops 32`
- `jq -e '.agents|length' docs/drafts/meta/agent-directory.json` → `8`

Both commands were run from the checkout root
`/Users/a3fckx/Desktop/Attri/telepathy-shared-learning`; the JSON parsed.

## Authority boundary

This JSON is a projection of `docs/AGENT_DIRECTORY.md`, which is itself a draft.
It is not human acceptance, not a published artifact, and not a verified code
bundle. `docs/AGENT_DIRECTORY.md` and `docs/INDEX.md` were not modified.
