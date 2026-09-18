# bend-laws — canonical boundary laws (new-Bend gated)

Status: canonical spec, gated on new toolchain 2026-09-18 (`bend 2.0.5`, see `TOOLCHAIN.md`). Root strays cleaned per owner: `New bend-laws dir` + `Migrate fully`.

## Files
- `LAWS.bend` — human-owned: `agent_is_effect_free`, `human_accept_resolves`, `accept_is_idempotent`, `orientation_monotone`, `fuel_bound`. New-Bend syntax (`import Base`, `type ... is Data`, `law`).
- `PROOF.bend` — AI-owned proofs (`{==}`), same names under `Laws.*`. Gate: `bend PROOF.bend`.
- `../bend-pilot/` — removed 2026-09-18 (owner call); legacy 5-case enumeration retired with the 2.0.5 gate.
- `../../docs/designs/job-contract.md` — causal nodes for traversal (Job→states→timeline→artifacts→resolution, example `5046e555→05afab1`). Preserved per owner for graph diffusion, not deleted.

## Verifiable gate (2.0.5)
1. `~/.bend/bin/bend runtime/programs/bend-laws/PROOF.bend` → `All terms check.`, exit 0 (`LAWS.bend` alone correctly fails with `5 TODOs found`).
2. No `bend check <file>` on 2.0.5 — not a subcommand. Legacy `0.2.38` removed; no fallback.
3. `agit accept` re-checks proof digest + exact candidate digest before merge. See `TOOLCHAIN.md` for canonical commands; use absolute paths, never bare `bend` in scripts.

Current gap closed 2026-09-18: `bend 2.0.5` at `/Users/a3fckx/.bend/bin/bend` gates the laws (`bend PROOF.bend` → `All terms check.`). Single-run v1.1 only; `lesson-proposal` keeps reserved inputs `source`/`parentDigest` under the one-release exception in `../v11.py`.
