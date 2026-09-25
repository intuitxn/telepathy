# Keyless discovery pilot

This is an executable **synthetic** prediction → experiment → observation →
updated hypothesis frontier → held-out score loop. It makes no claim about a
real-world scientific discovery. It runs without a model account or API key.

```sh
node benchmarks/discovery/run.mjs > /tmp/discovery.json
node --test benchmarks/discovery/run.test.mjs
# Reproduce the checked example exactly:
node benchmarks/discovery/run.mjs 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The default run draws a fresh private 256-bit seed. Its final JSON reveals the
seed **after** every policy has finished, so the whole case set can be replayed
and audited. Do not reuse a revealed seed to test a learning agent. The report
also binds the exact benchmark source, Bend source, each case, and the case set
with SHA-256 or a seed-keyed SHA-256 commitment. The case commitment includes
the simulator law, censor rule, and held-out domain before any probe runs.

## Protocol

- Eight cases alternate additive `a*x + b*z + c (mod 5)` and interaction
  `a*x*z + b*x + c (mod 5)` model banks, each with 125 possible laws. Two
  undisclosed-to-policy cases have an extra term outside their announced bank.
- A policy may choose at most six points from a 4×4 experimental grid. Nine
  disjoint points with `x=4` or `z=4` are held out. The simulator returns
  `unknown` at probe zero and one seed-selected extra probe; a censored result
  never eliminates a law. The extra censor changes the subsequent probe path
  in some cases.
  A measured zero is a **negative** result and does eliminate inconsistent
  laws. Positive, negative, and unknown receipts all spend an experiment call.
- The evidence policy filters every measured result; recency filters only the
  last measured result; no-context filters none. The policies submit bounded
  probe values to the checked `runtime/core/telepathy.bend` frontier selector.
  The highest funded score wins. Information score is
  `N² − Σ_y count(y)²`, proportional to expected laws eliminated. Once one law
  remains, the evidence policy funds a distant falsification probe. A
  contradiction empties the bank and produces an abstention.
- Before the oracle returns a result, the host commits the case digest,
  source/kernel digests, round, probe, predicted response, frontier digest,
  and prior receipt hash. Observation receipts chain to those commitments.
  The independent scorer receives one final law or an abstention only after
  the bounded transcript ends. An agent-provided `claimed_score` is ignored.
- The host reports held-out correct predictions, exact in-bank laws, supported
  out-of-bank abstentions, false law claims, negative/unknown results, and
  total simulated compute. Compute units are counted model evaluations plus
  Bend candidate scans plus 1,000 units for each experiment and each held-out
  check. The ratio `correct_per_1000_compute` uses that entire denominator.
  These units are declared work, **not** wall time, tokens, or joules.

With the fixed example seed and Bend 2.0.21, the evidence policy scored **54/72
held-out predictions, six exact laws, two supported abstentions, zero false law
claims, and 0.328180 correct per 1,000 compute units**. Recency scored 19/72,
one exact law, zero supported abstentions, seven false claims, and 0.110261 per
1,000 units. No-context scored 12/72, zero exact laws, zero supported
abstentions, eight false claims, and 0.094661 per 1,000 units. The checked run
took about four seconds on the development machine; wall time is not a
portable performance metric. The test independently recomputes the hidden
responses from the revealed seed, commitments, receipts, held-out scores, and
compute totals. It also shows that a forged agent score does not change the
host score and that an unfunded probe is rejected before observation.

## Boundary and next connection

The hidden law and held-out responses stay in the host closure during a run;
the proposal callback sees only the case name, announced model family, and
its own receipts. This is an honest local policy benchmark, not an adversarial
process sandbox. A local process that can inspect benchmark memory or a
previously revealed seed is outside the claim. The fixed model banks and the
falsification corner favor these small synthetic families; other seeds,
families, costs, and held-out distributions need separate measurement.

The DSH host can later pin `source_sha256` and `case_set_sha256` in a task spec,
admit the prediction commitment and observation receipt as causal events, and
settle the result with a host-only evaluator. This pilot makes no DSH session,
task-control write, provider call, or resident-service change. Arbitrary
papers, pseudocode, and real experiments need domain-specific source and
measurement adapters with the same separation of proposal from evaluation.
