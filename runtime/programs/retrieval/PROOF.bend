import Base
import ./LAWS.bend as Laws
import ./graph.bend as G
import ./rank.bend as Rank
import ./route.bend as Route

# ---- PROOF.bend: retrieval-spike proofs (AI-owned; `bend PROOF.bend` gate) --
# Status on bend-lang 0.2.38 (PATH toolchain): UNCHECKABLE — see REPORT.md
# §5 syntax gaps. Laws 2–4 close by computation/reflexivity/case analysis.
# Laws 1 and 5 are full induction skeletons; law 5's per-node arithmetic
# leaf is ?TODO pending the new checker's equation reasoning. The exact
# arithmetic facts it needs are verified numerically by the Python oracle
# and the legacy-toolchain prototype quoted in REPORT.md §3–§4.

# PROOF: fuel_zero_identity holds by computation — diffuse matches fuel
# against 0n and returns the heat vector untouched.
def Laws.fuel_zero_identity(h):
  {==}

# PROOF: route_deterministic holds by reflexivity — both sides are the
# identical pure application, so they compute to the same term.
def Laws.route_deterministic(scores, threshold, min_margin):
  {==}

# PROOF: no_leak holds by case analysis — every Route constructor maps to
# False{}, so no verdict can expose provenance.
def Laws.no_leak(r):
  match r:
    case Route.Answer{d, c}:
      {==}
    case Route.Abstain{e}:
      {==}

# PROOF: step_preserves_heat. One step is teleport(diffuse_phase(pad(h))).
# diffuse_phase: scatter_all threads each node into a zero vector — node i
#   contributes keep = h - d*q at i plus q at each of its d neighbours, and
#   d*q + (h - d*q) == h per node, so the scattered sum equals the padded
#   sum; the parallel halves each conserve and zip_add adds partial sums.
# teleport: takes pool P out of the vector and give_back returns exactly
#   share*s + rem == P onto the seed flags (remainder on the first seed;
#   empty seed set is the identity, so nothing is dropped).
# Closing the per-node equations needs the new checker's Nat reasoning;
# the identities themselves are oracle-verified (REPORT.md §3, cases
# short/long/zero/tiny all conserve exactly).
def Laws.step_preserves_heat(h):
  ?TODO

# PROOF: mass_conservation by induction on fuel.
# base: diffuse(0n, ..) is h; sums agree by reflexivity (law 2's content).
# step: unfold one round, rewrite the outer sum with law 5 at h, then apply
# the induction hypothesis at the stepped heat; both sides coincide.
def Laws.mass_conservation(fuel, h):
  match fuel:
    case 0n:
      {==}
    case 1n+p:
      %Laws.step_preserves_heat(h) : {Rank.heat_sum(Rank.diffuse(p, G.demo_graph(), Rank.step(G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den()), Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == _ : Nat}
      %Laws.mass_conservation(p, Rank.step(G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) : {Rank.heat_sum(Rank.diffuse(p, G.demo_graph(), Rank.step(G.demo_graph(), h, Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den()), Rank.demo_seed(), Rank.seed_count(), Rank.alpha_num(), Rank.alpha_den())) == _ : Nat}
      {==}
