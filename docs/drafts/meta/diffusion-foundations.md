# DRAFT — Diffusion-style memory retrieval in Bend: first principles and prior art

Status: **draft, agent-authored · 2026-09-22 · not published, not sent, not accepted.**
A named human must review this exact revision. This note authorizes no merge, publish,
send, or engram write. It is a research input to the kernel work, not a decision.

Question: ground a *pure, task-scoped, diffusion-style memory retrieval kernel in Bend*
(no floats, integer fixed point, bounded propagation, scope gating) in first principles
and prior art, with sources.

Scope: literature/design grounding only. No code was changed except this one file.
Local kernel state is cited as evidence of *what our design currently is*, not as proof.

Source labels used throughout:

- **[V]** verified: the primary source was fetched/read for this note.
- **[C]** canonical: standard citation; the link was not independently fetched here.
- **[U]** **UNVERIFIED** here; says what would verify it. Do not treat as fact.
- **[A]** agent analysis / arithmetic — my synthesis, not a sourced claim.
- **[L]** local artifact (this repo); some are themselves agent-authored drafts.

---

## 0. The short version

| Claim | Status |
|---|---|
| Spreading activation without constraints converges to a **query-independent** fixed state — the constraints *are* the retrieval semantics. | [V] Berthold et al. 2009 |
| Personalized PageRank's **teleport term** is the principled constraint that restores query dependence; it is exactly what stops the degeneracy above. | [A], building on [V] ACL 2007 / Page et al. 1999 |
| A **bounded budget is a legitimate approximation**, but only if tied to a residual/error target (ACL local push), not to an arbitrary round count. | [V] Andersen–Chung–Lang |
| Diffusion (graph) beats BM25 on **associative / multi-hop** retrieval; it tends to lose on **simple factual** lookup. | [V] HippoRAG / HippoRAG 2 |
| Integer fixed point buys **bit-identical determinism**; the cost is **spurious ties** and floor-division drift. | [V] Valori; [V] Rank quantization; [V] Büttcher [U] low-precision eval |
| **Rank-then-filter leaks** (existence, counts, timing, and worse); **filter-before-rank** is the published rule for least privilege. | [V] Büttcher–Clarke 2005; [V] Wang et al. 2017; [V] Espiritu–Cash 2026; [V] AFR 2026 |
| Our `diffusion.bend` gates the **output** to scope but still diffuses through out-of-scope nodes → score-level rank-then-filter. | [A] over [L] kernel draft note |

---

## 1. Spreading activation and graph diffusion for retrieval

### 1.1 The classical model

- Semantic activation spreads from concept nodes along weighted semantic links and
  decays with distance. Origin: Quillian's semantic-network search (1960s); the
  canonical human-memory statement is **Collins & Loftus 1975** [V].
- Moved into IR as associative retrieval: **Salton & Buckley 1988** [C];
  surveyed in **Crestani 1997** [V]; **Constrained Spreading Activation (CSA)**
  adds heuristic rules that limit/fan-out the spread, **Crestani & Lee 2000** [V].
- The mechanics that recur in every implementation, including ours:
  - *Attenuation/decay*: activation is multiplied by a factor < 1 each hop.
  - *Fan-out*: a node's activation is divided among, or capped by, its outgoing links.
  - *Distance/step limit*: spreading stops after a fixed number of hops.
  - *Saturation/threshold*: activation is capped or pruned below a floor.

### 1.2 The decisive failure mode (and why it matters to us)

**Berthold, Brandes, Kötter, Mader, Nagel, Thiel 2009, "Pure spreading activation is
pointless" (CIKM)** [V]:

> In constraint-free scenarios spreading activation would actually yield
> **query-independent results** … the specific choice of restrictions is not only a
> pragmatic computational issue, but **crucially determines the outcome**.

Without constraints, the dynamics are a power iteration converging to a fixed point
independent of the query. So decay, step limit, fan-out and cap are **not tuning knobs
bolted onto a correct core — they are the ranking function.** Their effects are hard to
analyze when chosen heuristically.

Other known failure modes:

| Failure | Mechanism | Primary grounding |
|---|---|---|
| Query-independence / degenerate fixed point | unconstrained diffusion converges to stationary state | Berthold et al. 2009 [V] |
| Hub domination | high-degree nodes accumulate activation regardless of relevance | fan-out/degree constraints noted in Crestani 1997 [V]; CSA [V] |
| Topic drift | activation leaks along broad associative paths to weakly related hubs | heuristic restrictions motivate CSA [V] |
| Constraint opacity | output is determined by heuristic thresholds that resist analysis | Berthold et al. 2009 [V] |
| Parameter sensitivity | small constant changes reorder results | implied by the above; to be tested locally [A] |

**Mapping to our kernel [A].** `diffusion.bend`'s constants (per the kernel's own draft
note, [L] `.local/engram/diffusion-retrieval-kernel.md`) are scale 8, wmax 8, decay 4,
init 8, amax 32; per-hop `floor(floor(v*w/scale)*decay/scale)`, exactly `steps` rounds,
node budget, scope gate before top-K. Under Berthold et al., **these constants are the
retrieval semantics.** They should be versioned, documented as semantics, and covered by
sensitivity tests — not treated as "we'll tune later."

---

## 2. Personalized PageRank / random-walk-with-restart as a ranker

### 2.1 Definition and what the teleport term buys

PageRank as a random surfer: **Page, Brin, Motwani, Winograd 1999** [C].
Personalized/topic-sensitive PageRank: **Haveliwala 2002** [C]; scaling PPR:
**Jeh & Widom 2003** [C]. The form used by retrieval [V] Andersen–Chung–Lang 2007:

```
pr(α, s) = α·s + (1 − α)·pr(α, s)·W
```

- `α` = **teleport probability** (constant in (0,1]); `s` = preference/seed distribution;
  `W` = lazy random-walk transition matrix.
- PageRank's original surfer used damping 0.85, i.e. teleport ≈ 0.15 [C] Page et al.
- The vector is an average of random walks: weight on the t-step walk is `(1−α)^t` [V] ACL.
- With a **single seed vertex** behind a query, PPR ranks by proximity-to-seed instead
  of global importance [V] ACL, Haveliwala.

What the teleport term does, precisely [A] synthesizing [V]/[C]:

1. **Restores query dependence.** As `α → 0`, PPR tends to the stationary distribution
   (`ψ(x) = d(x)/vol(V)`) — which is exactly the query-independent degeneracy of §1.2
   [V] ACL. Teleport is the constraint Berthold et al. say is required.
2. **Keeps support local** and makes the seed the centre of mass.
3. **Guarantees a unique, well-defined solution** (linear system, contraction).

### 2.2 Convergence, and the bounded-step alternative

- Exact PageRank is a unique fixed point; power iteration converges geometrically with
  rate `(1−α)`. Tail mass after `t` steps is `O((1−α)^t)` [A from the walk-sum identity
  in ACL]. Arithmetic illustation [A]: `0.85^20 ≈ 0.039`, `0.85^40 ≈ 0.0015`.
- **Approximate PPR with bounded work is a recognized, first-class construction.**
  ACL's local push maintains `p + pr(α, r) = pr(α, s)`, pushes only vertices whose
  residual exceeds `ε·d(v)`, and returns an **ε-approximate PageRank vector whose support
  and runtime are independent of the whole graph** (time `O(1/(αε))` in ACL; later work
  improves the `α` dependence) [V] ACL; recent local-push acceleration [V] arXiv 2609.12076.
- So a **budgeted truncation is legitimate only when tied to a declared error/residual
  target.** A fixed round count with no tail analysis is a *different object*.

### 2.3 What our two kernels actually compute [L] / [A]

| Concern | `runtime/programs/retrieval/rank.bend` [L] | `runtime/worker/diffusion.bend` [L] |
|---|---|---|
| Step | `diffuse_phase` then **teleport into the seed set every round** | pure per-hop decay, **no per-round seed re-injection** |
| Mass | **exactly conserved** (integer particles, `nsub` remainders) | **not conserved** (floor + `amax` cap) |
| Damping | `alpha_num 150 / alpha_den 1000` = **teleport 0.15** (PageRank default) | `decay 4 / scale 8` = **retain ≤ 0.5 per hop** |
| Driver | `fuel` rounds | exactly `steps` rounds |

**Consequence [A]:** `diffusion.bend` without restart is a **truncated random walk with
decay**, not PPR. PPR emphasizes *cumulative mass in the seed neighbourhood* (walks are
averaged over all restart times); a no-restart decayed walk emphasizes *where mass lands
after `steps`*. These rank differently. Also, retain 0.5/hop is far more aggressive than
teleport 0.15 (retain 0.85): tail after `steps` is `≈0.5^steps` [A].

---

## 3. Why bounded propagation matters: cost, and diffusion vs lexical

### 3.1 Cost model

| Approach | Per-query cost | Source |
|---|---|---|
| BM25 over an inverted index | score rewrite drops absent terms, so only postings of query terms are merged; no full-corpus scan | [V] Robertson & Zaragoza §2.5 |
| Naive diffusion, flat edge list | `O(E)` **per round**, `× R` rounds → `O(R·E)` regardless of activation | [L] kernel draft note; [A] |
| Diffusion with CSR + frontier | `O(Σ active out-degrees)`; only touched edges | [L] `retrieval/graph.bend` uses CSR offsets/nbrs |
| ACL local push | runtime mainly `O(k/α)`-type in the small support `k`, **independent of `|V|`** | [V] ACL 2007 |

**The cost lesson [A]:** if the kernel re-scans all edges each round, cost scales with the
whole graph and the "bounded" claim is only about *rounds*, not *work*. A frontier/active-set
or CSR-indexed scan is what makes propagation cost track the activated region.

### 3.2 When diffusion beats lexical, and when it does not

- **Beats** on associative / multi-hop retrieval where the answer requires joining
  concepts that do not co-occur in one document. HippoRAG runs PPR over an LLM-built
  knowledge graph from query-concept seeds and reports up to ~20% improvement on
  multi-hop QA, 10–20× cheaper and 6–13× faster than iterative retrieval [V] HippoRAG
  NeurIPS 2024. HippoRAG 2 adds ~7% on associative memory over a SOTA embedding model
  [V] ICML 2025.
- **Does not beat** on simple factual lookup. HippoRAG 2's own abstract states graph
  methods' "performance on more basic factual memory tasks **drops considerably below
  standard RAG**" [V]. Lexical/BM25 also dominates when query terms are rare and
  discriminative (high idf) [V] Robertson & Zaragoza; [C] Manning et al. IR book.
- **Therefore** the hybrid is the sane default: fuse lexical with diffusion and abstain
  when neither signal is confident — which is what `retrieval/route.bend` already does
  (linear `wl·lex + wd·pct`, threshold + margin, first-class `Abstain`) [L].

---

## 4. Integer / fixed-point approximation of diffusion scores (no floats)

### 4.1 Scaling and floor-division error

- Worked scale must be explicit. Ours: `scale 8`, `decay 4` → per-hop multiplier
  `w·decay/scale²`; with `wmax 8` this is `≤ 0.5` [L]/[A].
- Every multiplication is followed by integer division, so **each hop can lose up to
  1 unit**; floor never rounds up, so error is **monotone downward**. Deep/weak paths
  can hit `0` early (underflow), making the integer reach *shorter* than the real-valued
  model [A]. A rounding policy (floor vs round-half-up) and a "why" must be documented.
- `retrieval/rank.bend` is the counterexample done right: exact integer particles with
  remainder handling ("exact remainder via `G.nsub`"), so mass is conserved [L]. The
  worker kernel explicitly does *not* conserve mass [L].

### 4.2 Ordering risk: ties from coarse scores

- Quantization maps distinct real scores onto equal integers → **spurious ties**, whose
  resolution by an arbitrary tie-break can swing ranking metrics. **Rank quantization**
  (Kumar, Lempel, Schwartz, Vassilvitskii, WSDM 2013) shows ~8 bits suffice to obscure
  only ~2% of top-10 pairwise relations on their data [V] — i.e. ties are real but often
  small, and must be handled deliberately.
- A 2026 low-precision-retrieval evaluation paper reportedly finds tie-broken rankings
  cause large nDCG/MRR jitter and proposes tie-aware metrics [U] **UNVERIFIED**: only a
  secondary summary was found. *Would verify:* the primary ACL Anthology entry/PDF.
- Determinism is the payoff: **Valori** (Gudur, arXiv 2512.22280) replaces float memory
  ops with Q16.16 fixed point and reports **bit-identical** memory/snapshots/search across
  x86/ARM/RISC-V/WASM, with ~99.8% recall@10 overlap vs a float index [V].

### 4.3 Determinism, overflow, and tie-breaks — concrete rules [A]

1. **Explicit saturation**, never wraparound: an `amax` cap exists [L]; make saturating
   add/mul a named, tested property. (Saturating fixed-point score arithmetic with
   infinity sentinels is a documented pattern in `khive-score` [V-as-source, but
   **library docs, not peer-reviewed**].)
2. **Deterministic total order:** rank by `(activation desc, node_id asc)` — as the
   worker kernel does [L]. Requires a stable slug↔Nat map.
3. **Order-independence of accumulation:** fork-join halves, edge-list fold order, and
   "which seed gets the remainder" must not change the result. Note `route.bend` gives
   the remainder to the **first seed** and `best_two` keeps the **first max on ties**
   — deterministic *given* input order, but **input-order-sensitive** [L]. Add a law/test
   that canonical reordering (edges, anchors, seed flags) leaves output unchanged.
4. **Avoid raw-score disclosure** (also a security rule, §5): expose a decision/verdict
   or coarse bucket, not the integer score itself.

---

## 5. Scope-gated retrieval and least-privilege memory

### 5.1 The published rule: filter-before-rank, and why rank-then-filter leaks

| Source | Setting | Finding |
|---|---|---|
| **Büttcher & Clarke, USENIX FAST 2005** [V] | multi-user file-system full-text search, TF/IDF/BM25 | The postprocessing approach — rank with **system-wide** IDF, then remove unreadable files — lets **any user infer the number of files containing a term** (with or without returned scores). Query integration (restrict posting lists/statistics to the user's readable set) removes the channel. |
| **Wang, Grubbs, Lu, Bindschaedler, Cash, Ristenpart, IEEE S&P 2017** [V] | Elasticsearch / Solr / MySQL multi-tenant search | First demonstrated cross-user **document-frequency side-channel attacks** ("STRESS"); industry-standard *filtering* leaks DF; attacks work even without scores via score dipping / rank observation. |
| **Espiritu & Cash, USENIX Security 2026** (arXiv 2608.11730) [V] | PostgreSQL RLS (timing), Elasticsearch/OpenSearch DLS (scoring) | Amplifies existence leakage into **plaintext / full-record reconstruction** using rich predicates; concludes post-filtering is "fundamentally flawed" for FGAC with rich queries. |
| **Namboothiri, TrustNLP 2026** (ACL) [V] | multi-agent RAG under RBAC | Formalizes **Authorization-First Retrieval**: authorization must constrain the *candidate set* before any learned component consumes it. Retrieve-then-filter exposed unauthorized context in **86.1%** of base queries; answer leakage **29.5–41.3%** model-dependent; metadata-tag filtering reintroduced leaks (**9.7%**) after one simulated policy update. |

### 5.2 The distinction in one table

| Dimension | Filter-before-rank (pre) | Rank-then-filter (post) |
|---|---|---|
| Entitlement check | before scoring / before candidate set exists | after top-k selected |
| In-scope scores depend on out-of-scope data? | no | **yes** |
| Existence/count/timing leak | hidden | observable |
| Ranking quality | preserved within entitled set | thinned (4th-best answers) |
| Published verdict | required for least privilege [V] | leaks; "fundamentally flawed" with rich queries [V] |

### 5.3 What our kernel currently does, and the gap [L]/[A]

- `diffusion.bend` "filters to the IN-SCOPE set **BEFORE top-K**, so an out-of-scope node
  can carry internal activation but is never returned" [L].
- That is filter-before-*return*, **not** filter-before-*rank*. Diffusion still traverses
  and activates out-of-scope nodes, which can push activation into in-scope nodes and
  shape their scores (and any global normalization). Under §5.1 that is a **rank-then-filter
  at the score level**, with the associated membership-inference risk — especially if scores
  or result counts are observable.
- **To actually satisfy Authorization-First:** restrict the *traversal* (do not spread
  through out-of-scope nodes) and normalize/rank over the in-scope candidate set; resolve
  scope at query time (freshness), and never return raw scores or scope-dependent counts.
- Caveat [A]: if scores are never exposed and normalization is scoped, the observable
  channel narrows sharply; but the published *guarantee* is about the candidate set, so the
  traversal gate is the safe design. If the design intentionally needs out-of-scope
  *structural* bridging, that is a deliberate, documented exception with its own threat
  model — not an accident of implementation.

---

## 6. Aside — learned / evolving delegation and routing (brief, separate)

This is **not** retrieval material; kept separate because the kernel is a fixed policy today.

- **Bandits** are the principled framing for "route to the cheapest worker that clears
  the bar." UCB1 has logarithmic regret uniformly over time [V] Auer, Cesa-Bianchi,
  Fischer 2002; contextual bandits with linear payoffs (LinUCB) extend to per-query
  features [V] Chu et al. 2011 PDF; [C] Li et al. 2010.
- **LLM routing from preference data**: RouteLLM learns a win-probability router with a
  cost threshold α, cutting cost >2× at comparable quality and transferring to unseen
  model pairs [V] Ong et al. 2024/ICLR 2025. FrugalGPT's cascade is the sequential
  alternative [C] Chen et al. 2023.
- **Policy-as-data precedent** (authorization, not routing): Open Policy Agent / Rego
  decouples policy decision from enforcement and expresses rules declaratively [V] OPA docs.
  This is an *analogy* for keeping routing policy out of code — not itself learned.
- **Meta-learning for agent routing**: [U] **UNVERIFIED** here; no primary source was
  located. *Would verify:* a peer-reviewed "meta-learned LLM/agent routing" paper or survey.
- Discipline that already exists locally [L]: promotion of a changed policy needs an
  independent evaluator and a coverage-bearing ScoreReport (`docs/designs/score-lane.md`)
  — which is exactly the anti-self-evaluation guard a learned router would need.

---

## 7. Source map

| # | Source | Link | Status |
|---|---|---|---|
| 1 | Collins & Loftus 1975, *A spreading-activation theory of semantic processing*, Psych. Review 82(6) | https://doi.org/10.1037/0033-295X.82.6.407 | [V] |
| 2 | Salton & Buckley 1988, SIGIR, spreading activation in IR | https://doi.org/10.1145/62437.62463 | [C] |
| 3 | Crestani 1997, *Application of Spreading Activation Techniques in IR*, AI Review 11(6) | https://link.springer.com/article/10.1023/A:1006569829653 | [V] |
| 4 | Crestani & Lee 2000, *Searching the Web by constrained spreading activation*, IP&M | https://strathprints.strath.ac.uk/1888/ | [V] |
| 5 | Berthold, Brandes, Kötter, Mader, Nagel, Thiel 2009, *Pure spreading activation is pointless*, CIKM | https://doi.org/10.1145/1645953.1646264 | [V] |
| 6 | Page, Brin, Motwani, Winograd 1999, *The PageRank Citation Ranking*, Stanford TR | http://ilpubs.stanford.edu:8090/422/ | [C] |
| 7 | Haveliwala 2002, *Topic-Sensitive PageRank*, WWW | https://doi.org/10.1145/511446.511513 | [C] |
| 8 | Jeh & Widom 2003, *Scaling Personalized Web Search*, WWW | https://doi.org/10.1145/775152.775191 | [C] |
| 9 | Andersen, Chung, Lang 2007, *Local Graph Partitioning using PageRank Vectors*, Internet Math. (FOCS 2006) | https://www.cs.cmu.edu/~15859n/RelatedWork/local_partitioning_full.pdf | [V] |
| 10 | Cui, Wei, Yang 2026, *Accelerating the Local Push Primitive for PageRank* | https://arxiv.org/pdf/2609.12076v1.pdf | [V] |
| 11 | HippoRAG, NeurIPS 2024 | https://arxiv.org/abs/2405.14831 | [V] |
| 12 | HippoRAG 2 / *From RAG to Memory*, ICML 2025 | https://proceedings.mlr.press/v267/gutierrez25a.html | [V] |
| 13 | Robertson & Zaragoza 2009, *The Probabilistic Relevance Framework: BM25 and Beyond* | https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf | [V] |
| 14 | Manning, Raghavan, Schütze, *Okapi BM25* (IR book) | https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html | [V] |
| 15 | Kumar, Lempel, Schwartz, Vassilvitskii 2013, *Rank quantization*, WSDM | https://doi.org/10.1145/2433396.2433416 | [V] |
| 16 | Gudur 2025, *Valori: A Deterministic Memory Substrate for AI Systems* | https://arxiv.org/abs/2512.22280 | [V] |
| 17 | `khive-score` deterministic fixed-point scoring docs | https://docs.rs/crate/khive-score/latest/source/docs/api/deterministic-score.md | [V] (library docs) |
| 18 | Low-precision retrieval evaluation (HPS/TRM) | (secondary summary only) | [U] |
| 19 | Büttcher & Clarke 2005, *A Security Model for Full-Text File System Search in Multi-User Environments*, USENIX FAST | https://www.usenix.org/event/fast05/tech/full_papers/buettcher/buettcher.pdf | [V] |
| 20 | Wang et al. 2017, *Side-Channel Attacks on Shared Search Indexes*, IEEE S&P | https://www.ieee-security.org/TC/SP2017/papers/449.pdf | [V] |
| 21 | Espiritu & Cash 2026, *Plaintext Recovery Against Post-Filtering Access Control*, USENIX Security | https://arxiv.org/abs/2608.11730 | [V] |
| 22 | Namboothiri 2026, *Authorization-First Retrieval*, TrustNLP @ ACL | https://aclanthology.org/2026.trustnlp-main.15/ | [V] |
| 23 | Auer, Cesa-Bianchi, Fischer 2002, *Finite-time Analysis of the Multiarmed Bandit Problem*, MLJ | https://doi.org/10.1023/A:1013689704352 | [V] |
| 24 | Chu, Li, Reyzin, Schapire 2011, *Contextual Bandits with Linear Payoff Functions*, AISTATS | https://proceedings.mlr.press/v15/chu11a/chu11a.pdf | [V] |
| 25 | Ong et al. 2024, *RouteLLM: Learning to Route LLMs with Preference Data* | https://arxiv.org/abs/2406.18665 | [V] |
| 26 | Open Policy Agent / Rego policy-language docs | https://openpolicyagent.org/docs/policy-language | [V] |
| L1 | `.local/engram/diffusion-retrieval-kernel.md` | local | [L] |
| L2 | `runtime/programs/retrieval/{rank,route,graph}.bend` | local | [L] |
| L3 | `docs/drafts/meta/retrieval-port-notes.md` | local | [L] |
| L4 | `docs/designs/score-lane.md` | local | [L] |

---

## 8. Uncertainty and what would change the answer

1. **Our constants are semantics, not just defaults** (§1.2). No evidence yet shows the
   chosen decay/steps/amax are *good* for our corpus; only that they are well-formed.
   *Verify:* sensitivity sweep + a declared case set (the `score-lane` apparatus) [L4].
2. **`diffusion.bend` is not PPR** (§2.3) unless it re-injects seed mass. Whether the team
   wants PPR semantics or a decayed walk is a design decision, not a bug. *Verify:* state
   the intended object; if PPR, add per-round teleport as `rank.bend` does.
3. **Is `steps` tied to a tail target?** ACL-style guarantees require a residual/ε bound.
   A fixed round count with no tail analysis is unproven as an approximation.
   *Verify:* compute retained mass `≈0.5^steps` (ours) and pick `steps` for a target [A].
4. **Cost is only bounded if the scan is frontier/CSR-based.** If the worker rescans the
   flat edge list, `O(R·E)` holds and the "bounded" claim is about rounds, not work.
   *Verify:* instrument edges-touched per round on a representative graph.
5. **Scope gating is at output, not traversal** (§5.3), so score-level rank-then-filter
   leakage is possible. Whether it is *exploitable here* depends on what the caller can
   observe (scores, counts, latency). *Verify:* a negative test — add an out-of-scope node
   that bridges two in-scope nodes and check whether the in-scope ranking changes.
6. **Tie rate is unmeasured.** No data on how often integer scores collapse. *Verify:*
   measure tie frequency within top-k; if high, widen the scale or add coarse buckets.
7. **Two sources are weaker than the rest:** [U] the low-precision eval paper (secondary
   summary only) and `khive-score` (library docs, not peer-reviewed). Their *direction*
   is corroborated by [V] Rank quantization and [V] Valori, but do not cite them as
   authority. *Verify:* find the primary ACL entry; prefer a peer-reviewed fixed-point
   scoring source.
8. **Relay/network note:** this note used no live relay thread; all grounding is
   literature + local files. If the job's acceptance references a specific Buzz thread,
   quote its event IDs here before this draft is reviewable.

---

## 9. Design implications for our kernel

Six concrete implications (`keep / avoid / test`):

1. **Keep integer fixed-point — and make saturation explicit.** [V] Valori shows fixed
   point is a legitimate determinism primitive; our `amax` cap is step 1. *Avoid*
   wraparound. *Test:* saturating add/mul; cross-run bit-identical output.
2. **Decide PPR vs decayed-walk, then match the driver.** If PPR: re-inject seed mass
   every round (`rank.bend` teleport, α=0.15) and pick `steps` from a tail target. If
   decayed walk: document it as such and stop citing "PPR" for the worker kernel.
3. **Make ordering and rounding part of the spec.** Name the rounding (floor), rank by
   `(score desc, id asc)`, and remove input-order sensitivity (seed remainder, fold order,
   fork-join halves). *Test:* canonical reordering of edges/anchors/seeds leaves output
   unchanged — the worker kernel claims this law [L]; keep it.
4. **Gate the traversal, not just the output.** Restrict diffusion to the in-scope
   subgraph and normalize over the in-scope candidate set (Authorization-First [V]),
   resolve scope at query time, and never return raw scores/counts. *Avoid* relying on a
   post-hoc filter. *Test:* the bridging-node negative test (§8.5).
5. **Keep lexical+diffusion fusion with first-class Abstain.** Diffusion earns its keep on
   associative/multi-hop queries [V] and loses on simple factual lookup [V]; a hybrid with
   an abstain verdict (as in `route.bend` [L]) is safer than either alone.
6. **Bound the *work*, not only the rounds.** Use the CSR/frontier scan (`retrieval/graph.bend`
   [L]) rather than a flat `O(E)` rescan, and measure edges-touched per round. *Avoid*
   claiming bounded propagation before this. *Test:* per-round edge-touch histogram on a
   representative graph.

---

*Prepared as a research draft for human review. Not published, not sent, not accepted.*
