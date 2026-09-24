# Policy decision draft — DEFAULT policy recommendation

> DRAFT FOR HUMAN REVIEW — do not send anywhere. Not acceptance.
> Nothing here authorizes publication, spend, or retirement.
> Only a named human reviewing the exact runtime/policy.bend revision
> resolves anything. This doc is a suggested mem/policy/default content.

## Minimal default rule set (narrow scopes, read-heavy)

| slug | role | action | max_scope | max_budget | review |
|---|---|---|---|---|---|
| `default-builder-read` | Builder | Read | `proj-doc` (`[1n,2n]`) | `10n` | false |
| `default-scout-read` | Scout | Read | `proj-doc` (`[1n]`) | `4n` | false |
| `default-reviewer-read` | Reviewer | Read | `proj-doc` (`[1n,2n]`) | `4n` | false |
| `default-forge-write` | Forge | Write | `proj-sandbox` (`[2n]`) | `3n` | false |
| `default-builder-delegate` | Builder | Delegate | `proj-doc` (`[1n]`) | `2n` | false |
| `default-builder-publish` | Builder | Publish | `proj-doc` (`[1n,2n]`) | `5n` | true |
| `default-orchestrator-retire` | Orchestrator | Retire | `proj-doc` (`[1n]`) | `1n` | true |
| `default-orchestrator-spend` | Orchestrator | Spend | `proj-ledger` (`[3n]`) | `1n` | true |

Notes:
- Read-heavy allows; Write/Delegate narrow; Publish/Retire/Spend review-gated.
- decide in runtime/policy.bend is the only decision site (deny-by-default,
  first-match-wins on `(role,action)`, subset scope check, review gate).
- Empty policy denies; unknown role/action denies; scope violation denies.

## Suggested slugs (all slug-safe, <=64B per segment)

- `default-builder-read`
- `default-scout-read`
- `default-reviewer-read`
- `default-forge-write`
- `default-builder-delegate`
- `default-builder-publish`
- `default-orchestrator-retire`
- `default-orchestrator-spend`
- `mem-policy-default` (single-segment alias; canonical entry `mem/policy/default`
  uses segments `mem`, `policy`, `default`)

Slug rule: lowercase, first byte `[a-z0-9]`, rest `[a-z0-9_-]`, `<=64B` per segment.

## Open questions

1. Should `actor_scope` stay conjunctive (`target ⊆ max` AND `target ⊆ actor_scope`)?
2. Budget units: are `max_budget` numbers tasks, tokens, or currency?
3. Should Delegate require review above a budget threshold?
4. Do we need a Forge/Read allow for sandbox inspection?
5. Should Retire narrow to a per-item scope instead of `proj-doc`?
6. Confirm `mem/policy/default` segment naming vs single-key alias.
