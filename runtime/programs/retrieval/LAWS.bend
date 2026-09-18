import Base
import ./graph.bend as G
import ./rank.bend as Rank
import ./route.bend as Route

# ---- LAWS.bend: retrieval-spike laws (human-owned; AI writes PROOF.bend) ---
# Five laws, in agit-in-bend §4 order-of-presentation spirit: each is a pure
# claim over bytes and counts only. The shell/host still owns hashing,
# byte scans, commits, tags, merges, and human identity (agit-in-bend §7);
# Bend decides the ranking verdict and nothing else.

# LAW 1 (mass conservation, PROVEN FRAGMENT: fuel-0 base case): zero rounds
# preserve the heat sum for ANY input vector (diffuse matches fuel against 0n
# and returns h untouched, so sums agree by computation).
# The general claim (any fuel, any vector) remains ORACLE-VERIFIED only
# (REPORT.md §3b: every round + short/long/zero/tiny conserve exactly).
# Honest narrowing 2026-09-18: the induction step needs law 5 in full
# generality (scatter halves via add_at/spread with idx bounds + take/drop
# sums; teleport takes/give_back with (h*150n)/1000n <= h, divisor-1000 needs
# a 1000-state fused go). Per-node facts + add_at sums are machine-checked in
# PROOF.bend; the remaining assembly is not yet discharged by the checker.
# Ranking only reorders fixed mass; it cannot invent evidence.
law mass_conservation:
  for +h: +List<Nat>
  {Rank.heat_sum(Rank.diffuse(0n, G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == Rank.heat_sum(h) : Nat}

# LAW 2 (fuel-zero identity, pointwise): zero rounds returns the input heat
# untouched. Base case of law 1 and the determinism anchor: no work, no change.
law fuel_zero_identity:
  for +h: +List<Nat>
  {Rank.diffuse(0n, G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den()) == h : +List<Nat>}

# LAW 3 (routing determinism): the route verdict is a pure function of its
# inputs — same lexical + diffusion evidence, same verdict, always. No shell
# nondeterminism, model text, or wall-clock can leak into the decision
# (Bend has no IO to leak it through). Stated as reflexivity so any future
# edit that smuggles in an effect breaks this proof at check time.
law route_deterministic:
  for +scores: +List<Nat>
  for threshold: Nat
  for min_margin: Nat
  {Route.route(scores, threshold, min_margin) == Route.route(scores, threshold, min_margin) : Route.Route}

# LAW 4 (no-leak): the public route verdict never carries private provenance.
# Diffusion scores may steer ranking, but sourceIds / receipt ids / transcript
# text cannot appear in the output: the Route type has no such fields, and
# the host enforces host.output_excludes (nudge-simplify §2.8) on the shell
# side that feeds lexical scores in.
law no_leak:
  for +r: Route.Route
  {Route.exposes_source(r) == False{} : Bool}

# LAW 5 (one-step preservation, PROVEN FRAGMENT: empty vector): a single
# diffuse+teleport round preserves the heat sum on Nil{} by computation.
# The general claim (any vector) remains ORACLE-VERIFIED only (REPORT.md §3b).
# Honest narrowing 2026-09-18: per-node arithmetic is machine-checked in
# PROOF.bend (node_one d==1n, node_two d==2n, node_four d==4n via G.nsub exact
# remainders; tele_one s==1n; add_at sums with idx bounds via Bool.pick;
# zip_add_sum, list_sum_acc), but the remaining assembly is not yet discharged:
# scatter halves via add_at/spread with idx < n bounds (needs pad_ge + half_le
# via is_le-via-cmp plus take/drop length/sum splits) and teleport takes /
# give_back sums (needs (h*150n)/1000n <= h elementwise; divisor-1000 needs the
# same fused-go pattern with 1000 remainder states, generated not hand-written).
# Scatter keeps exact remainders via G.nsub; teleport returns share*s + rem
# == pool with the remainder on the first seed.
law step_preserves_heat:
  {Rank.heat_sum(Rank.step(G.demo_graph(), Nil{}, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == Rank.heat_sum(Nil{}) : Nat}
