# DRAFT — Regularized recursion foundations for recursive agent systems

Status: draft, agent-authored · 2026-09-24 · For human review only.
Do NOT accept, merge, publish, or send. Only a named human reviewing the
exact revision resolves anything. No external effect.

Question: our agent system grows by recursive delegation (tasks split into
budgeted subtasks, planners calling planners) and by recursive improvement
(retrieved learning re-enters planning; merged knowledge re-enters retrieval).
What keeps such recursion convergent rather than divergent?

Local context read (not authority): `docs/drafts/meta/crdt-foundations.md`
(state/op/delta CRDT comparison, join-semilattice merge). Relay threads cited
here are context, not authority; no relay claims are relied on below.

---

## 0. Thesis in one paragraph

Recursion converges when each cycle either (a) shrinks distance to a fixed
point by a factor < 1, (b) is forcibly stopped by a budget/depth rule that
preserves a usable partial answer, (c) pays a penalty for complexity so
iteration cannot chase noise, or (d) is restricted to operations that cannot
diverge by construction (monotonic merge, idempotent retry). Without one of
these, recursion in agent systems diverges in the familiar ways: fan-out,
cost/context explosion, error amplification, silent drift.

---

## 1. Fixed-point iteration and convergence

Plain terms: iterate `x_{n+1} = T(x_n)`. If `T` brings every pair of points
strictly closer by a uniform factor `q < 1` —

`d(T(x),T(y)) ≤ q·d(x,y)` —

then there is exactly one fixed point `x* = T(x*)`, and iteration from *any*
start converges to it, with error shrinking like `q^n`. This is the Banach
fixed-point (contraction mapping) theorem, first stated by Banach in 1922.

- Definition + theorem + `q < 1` condition and successive-approximation
  construction: Wikipedia summary —
  https://en.wikipedia.org/wiki/Banach_fixed-point_theorem
- Accessible proof, uniqueness argument, and remark that mere
  `d(Tx,Ty) < d(x,y)` without uniform `q < 1` is NOT enough (counterexample
  `T(x) = x + 1/x` on `[1,∞)` has no fixed point): Conrad notes —
  https://wiki.math.ntnu.no/_media/tma4145/2015h/conrad-contractionthm.pdf
- Statement with completeness requirement and continuity of contractions:
  Stanford Math 51H notes —
  https://web.stanford.edu/class/math51h/contraction.pdf

What the contraction factor buys:

- Uniqueness (two fixed points would have to be closer to each other than
  they are — impossible when `q < 1`).
- Rate: error after `n` steps is `O(q^n)`; smaller `q` = fewer iterations to
  a tolerance. The standard inequality set is collected in Remark 1 of the
  Wikipedia article above.
- A stopping rule: stop when `d(x_{n+1},x_n)` is small relative to `1−q`.

What happens without one:

- No guarantee of existence, uniqueness, or convergence. Non-expansive or
  merely strictly-decreasing maps can cycle, drift to infinity, or depend on
  the start point. The `x + 1/x` counterexample above is the canonical
  illustration.
- **Transfer to agents (analogy, not theorem): UNVERIFIED** — we have no
  metric `d` over plan/knowledge states with a proven `q < 1` for
  "plan → subplan → merged plan" or "retrieve → learn → retrieve". Treat
  "contraction" as a design aspiration (damping, averaging, quorum) rather
  than a proven property. No primary source proves LLM-planner contraction.

---

## 2. Bounded rationality in planning

Herbert Simon's 1955 "behavioral model of rational choice" introduced
satisficing: agents with limits on knowledge and computation stop at "good
enough" against an aspiration level rather than maximizing. The term "bounded
rationality" itself dates to Simon 1957.

- Milestone retrospective on Simon (1955), QJE 69(1):99–118 —
  https://link.springer.com/article/10.1007/s10203-024-00436-2
- Simon's own summary (knowledge + computational limits; satisficing vs
  maximizing) —
  https://web.stanford.edu/~knutson/jdm/simon87.pdf
- Modern restatement (limited alternatives evaluated, aspiration levels):
  Schwarz et al. 2022 —
  https://onlinelibrary.wiley.com/doi/10.1111/puar.13540

Three stopping technologies that preserve usefulness:

1. **Depth-limited search.** DFS to a fixed depth `M`: `O(b·M)` space, but
   incomplete if the solution lies deeper than `M`. Standard reference is
   Russell & Norvig, *AIMA* Ch. 3 (depth-limited + iterative deepening
   pseudocode) — book site https://aima.cs.berkeley.edu/ , pseudocode index
   https://github.com/aimacode/aima-pseudocode , tutorial notes
   https://cseweb.ucsd.edu//~elkan/130/itdeep.html
2. **Iterative deepening.** Repeat depth-limited DFS with increasing limit;
   simulates BFS completeness with `O(b·k)` space and `O(b^k)` time. Same
   sources as above. Lesson for delegation: fixed max planner-depth with
   deepening is the oldest convergent-by-budget trick.
3. **Anytime algorithms + deliberation scheduling.** Dean & Boddy (AAAI 1988)
   defined anytime algorithms: interruptible at any point, quality monotone
   non-decreasing in deliberation time; allocate time via performance
   profiles. Original paper —
   https://mlanthology.org/aaai/1988/dean1988aaai-analysis/ ; survey
   (interruptibility, performance profiles, composition, monitoring) —
   http://anytime.cs.umass.edu/shlomo/papers/Zaimag96.pdf ; optimal
   stopping under uncertainty via monitoring —
   https://www.cs.cmu.edu/~eugene/refs/f-thesis/Hansen-zilberstein-96.pdf ;
   metareasoning framing (when to stop deliberation and act) —
   http://anytime.cs.umass.edu/shlomo/papers/Zaaai08ws1.pdf

Stopping rules that carry over: aspiration/satisficing thresholds, hard
depth + token/time budgets, contract vs. interruptible anytime modes, and
monitored stopping (stop when expected improvement < cost of thinking).

---

## 3. Regularization as practiced (conceptual only)

A regularizer adds a penalty for complexity/instability to an objective that
would otherwise chase noise or blow up on ill-posed problems.

- Canonical form (Tikhonov): minimize `empirical error + λ·‖f‖²`. The
  smoothness term avoids overfitting; numerically, `(K + nλI)` stabilizes a
  possibly ill-conditioned inverse. Source: MIT 9.520 scribe notes —
  https://www.mit.edu/~9.520/scribe-notes/cl7.pdf
- Stability theory: Tikhonov regularization is a stable method for nonlinear
  ill-posed problems with `O(√δ)`-style rates under source conditions, where
  `δ` bounds data noise. Source: Engl, Kunisch & Neubauer 1989 —
  https://iopscience.iop.org/article/10.1088/0266-5611/5/4/007

Why iteration stays stable: the penalty selects among many near-fits the one
with small norm / smooth shape, so small input perturbations cause small
solution changes. For agents, the analogue is: penalize plan size, delegation
fan-out, retrieval volume, and rewrite magnitude — **UNVERIFIED** as a formal
stability claim for LLM pipelines; borrowed as a heuristic, no primary source
proves the transfer.

---

## 4. Convergence-by-construction

Some iterations cannot diverge because the math forbids it.

- **CRDT merge (state-based).** If states form a join-semilattice and merge
  computes the least upper bound (commutative, associative, idempotent), and
  updates are inflations, then assuming eventual delivery every replica
  converges (Strong Eventual Consistency), tolerating loss/reorder/duplication.
  Sources: Shapiro et al. RR-7687 §2.3, Thm 2.1 —
  https://inria.hal.science/inria-00609399v1/document ; full study —
  https://inria.hal.science/inria-00555588/document
- **Op-based variant.** Concurrent ops must commute + causal delivery holds;
  otherwise convergence is lost. Same sources, §2.4. Lesson: prefer
  state/merge where transport is lossy (mailbox), reserve op-style for
  causally-ordered logs.
- **CALM: consistency as logical monotonicity.** A program has a consistent,
  coordination-free distributed implementation iff it is monotonic.
  Non-monotonic logic requires coordination (retraction/consensus). Sources:
  Hellerstein & Alvaro 2019 —
  https://arxiv.org/abs/1901.01930 ; CACM version —
  https://cacm.acm.org/research/keeping-calm
- **Idempotence + monotonic accumulation.** Retries and merges that are
  idempotent (`merge(x,x)=x`; re-applying an effect changes nothing) and
  monotone (state only moves "up") make repetition safe. This is the same
  semilattice property above, restated operationally for planners: re-run,
  re-deliver, re-merge must be no-ops after convergence.

Design reading: put knowledge/memory on the monotonic path (grow-only sets,
versioned entries, LUB merge); keep non-monotonic acts (delete, overwrite,
verdict) behind coordination (human gate / quorum / log order).

---

## 5. Failure modes of recursive agent systems → structural fixes

| # | Failure mode | What happens | Known structural fix (source) |
|---|---|---|---|
| 1 | Unbounded fan-out | Planner spawns planners; branching `b` × depth `k` explodes work | Hard depth limit + per-level fan-out cap + iterative deepening (AIMA Ch.3; https://cseweb.ucsd.edu//~elkan/130/itdeep.html). Treat as depth-limited search, not open recursion. |
| 2 | Context / cost explosion | Retrieved learning re-enters planning; prompts, tool calls, tokens grow superlinearly | Anytime budget + performance-profile scheduling; contract vs interruptible modes; monitor-and-stop when marginal gain < cost (Dean & Boddy 1988; Zilberstein 1996; Hansen & Zilberstein 1996 — links in §2). Cap retrieval volume per cycle (regularizer, §3). |
| 3 | Feedback loops amplifying error | One root-cause error propagates through plan→act→observe steps, compounding into task failure; naïve self-revision without causal diagnosis underperforms targeted debugging | Symptom-driven backward tracing to the earliest error-inducing step + targeted corrective feedback (AgentDebug: +26% relative recovery on ALFWorld/GAIA/WebShop) — https://arxiv.org/abs/2509.25370 . Gate learning writes on verified-before-write / causal attribution — **UNVERIFIED** as a general law; supported only by the cited benchmark. |
| 4 | Silent drift | Repeated retrieve→learn→retrieve cycles shift semantics without failing loudly; redundant action loops (43% of early OSWorld failures in one study) burn budget until a step cap | Infinite Agentic Loop (IAL) analysis: retry/tool/multi-agent/workflow loops without effective bounds are the structural cause; fix is explicit termination bounds (e.g. `max_iterations`, recursion limits, turn bounds) — https://arxiv.org/pdf/2607.01641v1 . Complementary evidence on redundant loops + grounding/knowledge gaps — https://arxiv.org/html/2606.31270v1 . Plus monotonic/grow-only memory + quarantine on conflict (CRDT §4) so drift is visible, not overwriting. |

Additional UNVERIFIED notes: quantitative claims about *our* fan-out or
context growth have no measurement source yet; the table's fixes are
transferred from search/planning and recent agent benchmarks, not proven for
our Buzz/relay topology.

---

## 6. Uncertainty — what we do not know

1. No metric + contraction factor for our planner recursion has been defined
   or measured; §1's convergence guarantee does not formally apply.
   **UNVERIFIED**: any claim that "our delegation shrinks error by q per
   level."
2. Performance profiles for our anytime components (planner quality vs.
   tokens/time) do not exist; optimal deliberation scheduling cannot be
   computed yet. Needs instrumentation.
3. Regularization transfer (§3) is analogical; no source proves `λ`-style
   penalties stabilize LLM plan-rewrite loops.
4. CRDT/CALM results assume stated delivery models (eventual / causal);
   our mailbox+relay-log transport has not been mapped to those assumptions
   in this dossier — see `crdt-foundations.md` for the transport analysis,
   which this dossier does not re-prove.
5. Agent failure statistics cited (§5) come from OSWorld/ALFWorld/GAIA/WebShop
   and 6,549 public agent repos; generalization to our workload is
   **UNVERIFIED**.
6. Relay messages were not used as evidence; if relay context is later
   invoked, cite thread + event ID per source discipline.

What would change the answer: a defined distance over plan/knowledge states
with a measured `q`; recorded quality-vs-budget curves per subtask type;
a transport proof (mailbox loss/duplication tolerance) for the chosen merge;
ablation showing gated vs ungated learning-write drift.

---

## 7. Design implications for OUR recursion (for human decision)

1. **Cap plan depth and fan-out as depth-limited search.** E.g. max delegation
   depth 2–3, max fan-out per node (numbers are proposal only —
   **UNVERIFIED**, set by human after cost review); deeper needs explicit
   re-authorization. Iterative deepening, not open recursion.
2. **Split budgets parent→child as deliberation scheduling.** Parent keeps a
   reserve; each child gets a contract budget (tokens/tool-calls/time);
   interruptible anytime return (best-so-far + confidence) required. Stop when
   expected gain < thinking cost.
3. **Bound total work per job.** Global token/tool/latency ceiling + per-cycle
   retrieval cap (regularizer). Exceeding the ceiling stops with a partial,
   usable artifact — never silently continues.
4. **Prefer merge over fold for shared knowledge.** Accumulate monotonically
   (versioned, grow-only, LUB merge); folds/overwrites and deletes require
   ordered log + quorum/human gate (CALM: non-monotonic ⇒ coordinate).
5. **Make retry idempotent and re-merge safe.** Same effect applied twice =
   same state; same merge delivered twice = same state. Required for
   mailbox-loss tolerance.
6. **Gate the improvement loop.** Retrieved learning re-enters planning only
   through verified-before-write: causal attribution (which step/agent caused
   the error), quarantine on conflict, human accept for semantic changes.
   Ungated self-rewrite is the drift path.

---

## Sources

1. Banach fixed-point theorem — definition, `q<1`, iteration construction —
   https://en.wikipedia.org/wiki/Banach_fixed-point_theorem
2. Conrad, contraction mapping theorem + `x+1/x` counterexample —
   https://wiki.math.ntnu.no/_media/tma4145/2015h/conrad-contractionthm.pdf
3. Stanford Math 51H contraction notes —
   https://web.stanford.edu/class/math51h/contraction.pdf
4. Simon (1955) milestone retrospective —
   https://link.springer.com/article/10.1007/s10203-024-00436-2
5. Simon (1987) bounded rationality summary —
   https://web.stanford.edu/~knutson/jdm/simon87.pdf
6. Schwarz et al. (2022) satisficing restatement —
   https://onlinelibrary.wiley.com/doi/10.1111/puar.13540
7. Russell & Norvig AIMA (depth-limited / iterative deepening) —
   https://aima.cs.berkeley.edu/ ; pseudocode
   https://github.com/aimacode/aima-pseudocode ; notes
   https://cseweb.ucsd.edu//~elkan/130/itdeep.html
8. Dean & Boddy (1988) anytime algorithms —
   https://mlanthology.org/aaai/1988/dean1988aaai-analysis/
9. Zilberstein (1996) anytime survey —
   http://anytime.cs.umass.edu/shlomo/papers/Zaimag96.pdf
10. Hansen & Zilberstein monitoring/stopping —
    https://www.cs.cmu.edu/~eugene/refs/f-thesis/Hansen-zilberstein-96.pdf
11. Zilberstein (2008) metareasoning/bounded rationality —
    http://anytime.cs.umass.edu/shlomo/papers/Zaaai08ws1.pdf
12. MIT 9.520 Tikhonov/ERM notes (penalty stabilizes ill-posed inverse) —
    https://www.mit.edu/~9.520/scribe-notes/cl7.pdf
13. Engl, Kunisch & Neubauer (1989) Tikhonov stability —
    https://iopscience.iop.org/article/10.1088/0266-5611/5/4/007
14. Shapiro et al. RR-7687 CRDTs (CvRDT Thm 2.1; CmRDT) —
    https://inria.hal.science/inria-00609399v1/document
15. Shapiro et al. comprehensive CRDT study —
    https://inria.hal.science/inria-00555588/document
16. Hellerstein & Alvaro (2019) Keeping CALM —
    https://arxiv.org/abs/1901.01930 ; CACM
    https://cacm.acm.org/research/keeping-calm
17. Zhu et al. (2025) AgentDebug error compounding + targeted recovery —
    https://arxiv.org/abs/2509.25370
18. Infinite Agentic Loops study (bounds as fix) —
    https://arxiv.org/pdf/2607.01641v1
19. Failure-driven self-improvement / redundant loops (OSWorld) —
    https://arxiv.org/html/2606.31270v1
