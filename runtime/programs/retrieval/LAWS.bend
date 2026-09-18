import Base
import ./graph.bend as G
import ./rank.bend as Rank
import ./route.bend as Route

# ---- LAWS.bend: retrieval-spike laws (human-owned; AI writes PROOF.bend) ---
# Five laws, in agit-in-bend §4 order-of-presentation spirit: each is a pure
# claim over bytes and counts only. The shell/host still owns hashing,
# byte scans, commits, tags, merges, and human identity (agit-in-bend §7);
# Bend decides the ranking verdict and nothing else.

# LAW 1 (mass conservation): diffusion + teleport never create or destroy
# heat particles, for ANY fuel and ANY input vector (rank pads short inputs
# up to the graph count, so the claim needs no well-formedness premise).
# Ranking only reorders fixed mass; it cannot invent evidence.
law mass_conservation:
  for fuel: Nat
  for +h: +List<Nat>
  {Rank.heat_sum(Rank.diffuse(fuel, G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == Rank.heat_sum(h) : Nat}

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

# LAW 5 (one-step preservation): a single diffuse+teleport round preserves
# the heat sum. The induction step of law 1, stated separately so the
# per-node arithmetic (keep + d*q == h; takes pool fully repatriated) has
# one home. Scatter keeps exact remainders via G.nsub; teleport returns
# share*s + rem == pool with the remainder on the first seed.
law step_preserves_heat:
  for +h: +List<Nat>
  {Rank.heat_sum(Rank.step(G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == Rank.heat_sum(h) : Nat}
