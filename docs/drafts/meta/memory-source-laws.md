# memory-source-laws — pure read point for the host memory contract

Status: draft, agent-authored. Nothing here is acceptance or a merge.
Only a named human reviewing the exact revision resolves a job.

## Host contract (fixed)

Verified against `scripts/memory-sync.sh` and `runtime/` (kernel has NO
memory support: no import, no Memory verb; shell routes `memory` to
`scripts/memory-sync.sh`):

- `<root>/memory.in` holds one `slug|digest` line per entry, sorted by slug.
  `digest` is sha256 hex of the body bytes (checked by the shell, not Bend).
- Bodies at `<root>/memory/<slug>` with `/` replaced by `__`.
- `runtime/memory.bend` is the single pure read point: `parse_index(text)`
  returns `MemIndex{entries, bad}`. `entries` stay sorted by slug;
  `bad` holds quarantined raw lines (malformed + duplicate second-wins).

## Pure core (`runtime/memory.bend`, ~20 laws)

- `parse_index(text) -> MemIndex`; `memory_slugs` sorted+deduped;
  `memory_find` total (`Hit{digest}` / explicit `Miss{}`);
  `index_entry_count` / `index_bad_count`; `mem_body_path` with `/`->`__`;
  `render_entries` for round-trip.
- Malformed (`no |`, `a|b|c`, `|d`, `s|`) and duplicate slugs are
  QUARANTINED (first file-order wins), never silently merged.
  Empty lines are SKIPPED (trailing newline), not quarantined.

Laws (20, each with same-named proof `def`): `mem_empty`,
`mem_singleton`, `mem_all_malformed`, `mem_malformed_no_pipe`,
`mem_malformed_extra_pipe`, `mem_empty_slug`, `mem_empty_digest`,
`mem_duplicate_first_wins`, `mem_duplicate_counts`, `mem_slugs_sorted`,
`mem_slugs_deduped`, `mem_find_hit`, `mem_find_miss`, `mem_find_total`,
`mem_parse_deterministic`, `mem_slugs_deterministic`, `mem_roundtrip`,
`mem_counts_mixed`, `mem_work_bound` (>=20 records: 20 entries, 0 bad),
`mem_escape_slash`.

## PROVEN vs DESIGNED

- PROVEN (`bend runtime/memory.bend --check-only` -> `All terms check.`):
  round-trip, sortedness, dedupe, lookup totality, duplicate/malformed
  quarantine, determinism, counterexamples (empty / all-malformed /
  duplicate / empty-digest), work bound, escape.
- DESIGNED (shell owns, not proven): sha256==digest, body-file existence,
  on-disk sorting, empty-line skipping, `mkdir` (Base has no mkdir).

## Deferred

Wiring into `runtime/mundus.bend` is a separate deferred step. This file
does not import mundus; no existing file was touched. Demo runs on scratch
outside the repo via `bend runtime/memory.bend -- <root> [slug]`.
