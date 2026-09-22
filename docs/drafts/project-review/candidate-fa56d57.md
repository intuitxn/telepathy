# Review: native OpenCode, Buzz and Bend harness

Status: candidate awaiting Shubham's review. This file is a prepared review body,
not a submitted Buzz review or an acceptance record.

Repository: https://github.com/intuitxn/telepathy
Branch: `refactor/buzz-native-bend`
Candidate commit: `fa56d57daa2e1621e8dd11484cee6f85529f4c24`
Base commit: `d7a6c7b0930f6d91b691e58df84b775479380c0d`
GitHub review context: https://github.com/intuitxn/telepathy/pull/14
Reviewer: Shubham; resolve the actual existing Buzz identity before requesting review.

## Change and evidence

Use stock OpenCode through its native CLI/ACP, native Buzz coordination/memory,
and the one-file Bend worker. Retire the custom JavaScript learning stack,
beta SDK dependency and plugin loading. Remove model pins and obsolete tool
instructions from eight agent charters. Keep historical records and optional Desk.
The existing program gate now requires successful compiler exit as well as the
success marker before declaring a proof proven.

- `npm run check`: 12 Desk tests passed, including fake native CLI dispatch,
  worktree separation, configuration and failure handling.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_programs test_v11`
  from `runtime/programs`: 74 tests passed.
- OpenCode 1.18.32 native ACP initialization succeeded; all eight agents discovered.
- Bend source was unchanged; six protocol/evaluation checks passed during the
  earlier adapter retirement. Named laws cover their stated properties only.

The candidate does not demonstrate live Buzz-to-model execution, improved task
performance from memory, automatic shared-state synchronization, or key isolation.
Two incomplete Bend experiments and a new JavaScript retrieval mirror in the
other checkout are excluded. Existing Desk watcher behavior can send/land work
when configured; it is optional, not the native baseline.

## Acceptance criteria

1. The native baseline is documented consistently without an oc2 or custom-plugin
   prerequisite; stock OpenCode agent discovery works.
2. Relevant tests pass and compiler failure cannot be reported as proven.
3. Existing records remain intact; excluded experiments are not presented as proven.
4. The build plan requires fresh-session reuse, correction and held-out evaluation
   before claiming improvement, and keeps promotion distinct from proposal.

## Review and landing

Submit this candidate from the actual authorized agent author identity. Request
Shubham's verified identity using native Buzz PR review. The PR author must not
approve their own PR. Verify repository and full candidate commit in the review
surface; a changed tip requires a fresh review. A chat acknowledgement or workflow
status is not a native PR approval.

This request does not authorize merge, deployment, memory publication or acceptance
on Shubham's behalf. Landing requires the applicable human decision and a final
comparison of the reviewed tip with the candidate being landed.
