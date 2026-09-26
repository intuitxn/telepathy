# Exploration and drift simulation

This fixed-oracle benchmark compares two evidence ordering policies at the same
predeclared per-round grant. Both execute the checked, compiled
`runtime/core/telepathy.bend` kernel for scoped retrieval, funded frontier
selection, and final event/calibration audit. The evaluator holds the one-time
action payoffs; selector inputs contain action IDs and evidence estimates, never
payoffs. It records the Bend source and fixture SHA-256 digests.

```sh
BEND_BINARY=/absolute/path/to/bend node benchmarks/exploration/run.mjs
BEND_BINARY=/absolute/path/to/bend node --test benchmarks/exploration/run.test.mjs
```

The 12-round `distractor-drift` fixture gives four actions prior estimates. One
verified estimate is wrong under the current oracle, and each round adds four
new unsupported claims favoring that action. `bounded-evidence` presents the
latest verified record per action before other records; `recency` presents the
newest records first. Bend scans at most four documents and all four candidates
per round. An oracle observation becomes verified evidence only after the
chosen action is evaluated. The second fixture, `stale-verified-counterexample`,
changes the payoff so an older verified estimate is misleading and a recent
unverified estimate happens to be useful. It tests that the bounded policy can
lose, not just win on a tailored flood.

The bounded policy keeps one latest verified pointer per action as records
arrive. Each round it reads those pointers and at most a scan-sized recent
fallback, so it does not rescan the full archive. This is a simulated host
policy around the Bend retrieval and frontier calls. It is not the current
`task-control.view` implementation or a deployed long-session governor.

`verified_gain` sums unique, oracle-confirmed action payoffs. An attempted
action has no second discovery payoff. `duplicate_proposals` counts attempts of
an already tried action; `unsupported_claims` counts positive estimated gain
followed by zero measured gain. Prediction error is the absolute difference
between estimated and measured gain. `simulated_compute_units` sum host evidence
admissions, index writes and reads, Bend document/candidate/event scans, and oracle calls;
`verified_gain_per_compute` divides gain by those units. Both strategies get the
same maximum rounds, scan caps, and at most one oracle call per round. Actual
usage can differ when one abstains. Native build and process startup time are
not in this synthetic compute measure; report them separately for a latency
study.

The fixture has a fully disclosed synthetic oracle so others can reproduce or
challenge the result. It is not a held-out scientific test, a model-based long
session, or evidence of autonomous discovery. The policies use trusted
`verified` labels supplied by the fixture, and a stale verified estimate still
fails in the counterexample. Real knowledge work needs source provenance,
domain-specific independent measurements, and fresh tasks protected from the
agent that proposes a policy. The benchmark runner is an exploratory check;
the repository's exact-revision release and promotion gates remain separate.
