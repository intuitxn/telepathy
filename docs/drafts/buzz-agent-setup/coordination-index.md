# Coordination index (draft)

Status: draft · Updated: 2026-09-22. This index identifies owning documents and
remaining drift. It is not an execution authority and grants no publication
permission. Use section names and explicit revisions for historical evidence;
line numbers and the branch's current HEAD change during development.

## Current owning documents

| Path | Responsibility |
|---|---|
| `BUZZ_SETUP.md` | Standard OpenCode/Buzz/Bend setup; optional legacy Desk behavior and its external effects. |
| `runtime/worker/BUZZ.md` | Installed native Buzz commands, ACP configuration, memory boundaries and reviewed sends. |
| `runtime/adaptive/META.md` | One-file Bend worker protocol and private snapshot sequence used by `/meta agents`. |
| `runtime/worker/README.md` | Packaged Bend source identity, checked laws, independent protocol tests and limitations. |
| `runtime/adaptive/HARNESS.md` | Active native baseline and explicitly retired custom JavaScript learning stack. |
| `.opencode/agents/` | Canonical execution charters and their scoped responsibilities. |
| `plugins/telepathy-meta-agents/registry.json` | Five-interface product catalog; not a complete catalog of every execution charter. |
| `docs/AGENT_MAP.md` and `docs/AGENT_ROLES.md` | Human-readable agent roles and proposed persona pairings. Confirm deployed personas separately. |
| `docs/designs/a2a-protocol.md` | Active baseline at the top; dated oc2 probes and optional federation roadmap below. |
| `docs/HARNESS_STATE.md` | Dated historical job/verification observations, not current host health. |
| `runtime/adaptive/LEARNING.md` | Retained findings with explicit historical scope and limits. |
| `docs/INDEX.md` | Repository navigation; owning sources determine behavior. |

The retired shared-registry source and operational documentation are preserved at
Git revision `d7a6c7b0930f6d91b691e58df84b775479380c0d`. That is a historical
reproduction reference, not an assertion about today's HEAD. Removed adapter
commands must not be invoked from current instructions. Existing records have
not been migrated into Buzz.

## Remaining reconciliation before activation

- **Persona mapping:** Pollen/Fizz/Honey assignments remain proposed until
  confirmed through authorized read access to Buzz. The historical aliases
  `atlas`, `forge`, `ledger`, `scout`, and `diplomat` map to current charters
  `prime`, `build`, `steward`, `research`, and `relationships`. `pilot` has no
  current charter. Historical aliases should stay labeled historical.
- **Draft registry:** `buzz-agent-registry.draft.json` now uses canonical charters
  and marks all persona assignments as proposed. It does not certify a currently
  deployed agent, current provider availability or an authenticated binding.
- **Earlier async proposal:** `async-first-coordination.md` contains a historical
  oc2/Lamport design and dated observations. Its old roadmap, current-state labels,
  test counts and line references require reconciliation before active use. The
  native [implementation plan](buzz-implementation-plan.md) supersedes it as the
  proposed local execution sequence.
- **Credential boundary:** owner-controlled signing and keyless workers are the
  target. Prior inherited-identity observations remain evidence of a gap until
  deployment isolation is checked. Removing environment variables alone is not
  filesystem/keychain isolation.
- **State boundary:** local Bend claims/corrections, Buzz engrams and the optional
  Desk ledger are different stores. Do not promise shared global claims,
  automatic dependency invalidation in Buzz, or registry migration.

## Deliberately deferred

Federation, a new directory bridge, custom network intent schemas, tiers and
Lamport integration need an actual multi-node requirement. Standard OpenCode's
native ACP interface already handles the local host connection. Neither the
old oc2 fork nor port 4110 is a prerequisite; preserve existing unrelated state.

Read-only persona inspection and local tests need no invented human-only gate.
Outbound content remains a draft until Shubham reviews its exact revision and
audience and the owner-controlled signer sends it. Draft files in this directory
are not automatically registered with Buzz, the plugin catalog, or the site.
