# DRAFT — CRDT foundations for shared agent-system state

Status: draft, agent-authored · 2026-09-24 · For human review only.
Do NOT accept, merge, publish, or send. Only a named human reviewing the
exact revision resolves anything. No external effect.

Question: shared agent-system state (memory entries keyed by slug, plans,
verdicts, proposals) that converges when concurrent sessions merge, so the
system improves with use. Ground in CRDT prior art, with sources.

Local context read (not authority): `docs/drafts/meta/mundus-kernel-laws.md`
(state-directory model, verdict fold, no merge/accept in kernel),
`docs/drafts/meta/memory-source-laws.md` (`memory.in` slug|digest index,
first-wins + quarantine on duplicates), `docs/drafts/meta/policy-decision.md`
(slug rules), `docs/drafts/meta/op-dispatch-convention.md` (effects in driver,
never in kernel). Relay threads cited here are context, not authority; no
relay claims are relied on below.

---

## 1. Three families: what each guarantees, what each demands of transport

One comparison table (details below):

| Family | Converges if | Transport demand | Fits our transport? |
|---|---|---|---|
| State-based (CvRDT) | merge = join of a join-semilattice (commutative, associative, idempotent); mutators are inflations | Eventual delivery of *some* state that subsumes each update; loss / reorder / duplication OK | **Yes** — best fit for ephemeral mailbox + signed relay log |
| Op-based (CmRDT) | concurrent ops commute; causal delivery holds | Reliable **causal** broadcast: exactly-once, no loss/dup, causal order | **No, not on mailbox alone** — mailbox is ephemeral, lossy, unordered |
| Delta-state (δ-CRDT) | same lattice as state-based; deltas are joinable fragments; causal consistency additionally needs the causal delta-merging condition | Eventual delivery of deltas for convergence; causal consistency needs delta-intervals + ack/sequence tracking | **Yes, with care** — small messages over mailbox, periodic full-state via relay log as fallback |

### State-based (CvRDT)

- Model: each replica holds a state in a join-semilattice; updates move state
  "up" (inflations); replicas exchange full states and apply `merge = join`
  (least upper bound). Theorem: assuming eventual delivery, any CvRDT is
  strongly eventually consistent (SEC). Source: Shapiro et al., RR-7687 §2.3,
  Thm 2.1 — https://inria.hal.science/inria-00555588 and
  https://www.lip6.fr/Marc.Shapiro/papers/RR-7687.pdf
- Transport tolerance is the point: join is idempotent/commutative/associative,
  so duplicates, reordering, and loss are absorbed as long as *some* later state
  covering the update eventually arrives (gossip/anti-entropy, "infinitely
  often" between connected replicas). Source: same RR-7687 §2.1–2.3; survey
  treatment in Baquero et al., "Approaches to CRDTs" (ACM Comput. Surv. 2025) —
  https://dl.acm.org/doi/10.1145/3695249
- Cost: full-state shipping. Motivating pain for large sets/maps/counters is
  stated explicitly as the δ-CRDT motivation. Source: Almeida–Shoker–Baquero,
  "Delta State Replicated Data Types" (JPDC 2018) §1 —
  https://arxiv.org/abs/1603.01529 and
  https://www.sciencedirect.com/science/article/abs/pii/S0743731517302332

### Op-based (CmRDT)

- Model: update splits into side-effect-free `prepare` at source + `effect`
  applied at all replicas; convergence requires concurrent effects to commute
  **and** causal delivery. Theorem: assuming causal delivery + termination,
  concurrent-commuting ops give SEC. Source: RR-7687 §2.4, Thm 2.2 (links above).
- Transport demand is strict: reliable exactly-once causal broadcast; logs must
  be retained to suppress duplicates; membership is hard under churn. This is why
  op-based is cheap per message but brittle on unreliable nets. Source: Almeida
  et al., JPDC 2018 §1 (op-based "demand exactly-once delivery and are prone to
  message duplication"); also "Efficient State-Based CRDTs by Delta-Mutation"
  (PaPoC 2015) — https://doi.org/10.1007/978-3-319-26850-7_5
- Consequence for us: our mailbox (ephemeral, no exactly-once, no causal order)
  **cannot** carry raw op-based CRDT effects safely. Op-based is usable only if
  the signed relay log is promoted to the reliable causal broadcast (append-only,
  sequenced, replayable) — i.e. effects ride the log, not the mailbox.
  The mailbox can then be a hint/notify channel. UNVERIFIED: no primary source
  was checked for *our* mailbox's exact loss/reorder semantics; the "mailbox
  alone is insufficient for op-based" claim follows from the cited transport
  demand *conditional on* that characterization of our mailbox.

### Delta-state (δ-CRDT)

- Model: still a join-semilattice, but mutators return small *delta-states* in
  the same lattice, joined locally and shipped (singly or batched as
  delta-groups). Convergence needs only eventual delivery of deltas; full state
  is the degenerate fallback (new members, partition heal). Source: Almeida et
  al., arXiv:1603.01529 §§4–4.1 — https://arxiv.org/abs/1603.01529
- Causal consistency is **not** free with deltas: fragments must satisfy the
  *causal delta-merging condition* (join a delta-interval only into a state that
  subsumes what the interval's first delta was joined into), implemented by a
  delta-interval anti-entropy algorithm with per-neighbor ack maps. Proposition:
  executions satisfying the condition correspond to standard state-based
  executions (Prop. 1/2 + Corollary 1). Source: same paper §§5–6; journal version
  (JPDC 2018) Prop. 6.4.
- Consequence for us: deltas fit the mailbox (small, idempotent, reorder-safe
  for *convergence*); causality needs sequence numbers + per-peer acks, which
  must live in the driver/relay-log layer, never in the pure merge kernel
  (consistent with our op-dispatch convention: effects outside Bend).

---

## 2. Structures that fit keyed memory

### LWW-register (one value per key, total order decides)

- State `(value, timestamp, replicaID)`; merge = `max` under lexicographic
  `(timestamp, replicaID)`. Total order ⇒ trivially a semilattice. Source:
  RR-7506 portfolio (§3, registers) —
  https://webarchive.di.uminho.pt/haslab.uminho.pt/cbm/files/techreport.pdf ;
  compact statement in Whittaker's summary —
  https://mwhittaker.github.io/papers/html/shapiro2011conflict.html
- Tie-break by replica ID is load-bearing (distinct writers, equal clocks must
  still converge deterministically). Production statement: Akka LWWRegister
  merges by highest timestamp, ties by lowest node address, and warns it
  "relies on synchronized clocks" / only when choice within skew is unimportant —
  https://doc.akka.io/japi/akka-core/2.10.22/akka/cluster/ddata/LWWRegister.html
- Practice: stamp as `max(wallclock, last+1)` per writer and never reuse
  `(timestamp, replicaID)` for different values; after restart use fresh ID or
  restored clock. Source: lattice_registers LWW docs (Elixir, states the rule
  explicitly) — https://lattice-registers.hexdocs.pm/lattice_registers/lww_register.html

### Multi-value register (keep concurrent writes, resolve later)

- Read returns the *set* of causally-maximal concurrent writes:
  `F_mvr(E,hb)` = writes not happened-before any other write. Concurrency is
  first-class; resolution is the application's job. Source: "Eventually
  Consistent Register Revisited" (PaPoC) —
  https://webarchive.di.uminho.pt/haslab.uminho.pt/cbm/files/mvreg_papoc_camera.pdf
- Can be refined by a value order (`resolve≺` keeps maxima; LWW is the special
  case where the order is on `(value, timestamp)` pairs). Same source.
- Needs causality (vector/DVV, § below), not just a scalar clock — Lamport
  alone cannot tell "overwrote" from "concurrent". Secondary/illustrative
  source: Tantamanlands note "Do LWW registers need vector clocks?"
  (2022-10-18) — https://tantaman.com/2022-10-18-lamport-sufficient-for-lww.html
  (blog, not peer-reviewed; used only for the integer intuition).

### Grow-only set and friends (G-Set, 2P-Set, OR-Set)

- G-Set (add-only): merge = union. 2P-Set (add + remove-once): two G-Sets;
  element present iff added and not removed; re-add after remove is
  impossible. Source: RR-7506 §§sets; summary —
  https://mwhittaker.github.io/papers/html/shapiro2011conflict.html
- OR-Set / Observed-Remove (add-wins): each add carries a unique tag (dot);
  remove cancels only tags *observed* at source; concurrent add's fresh tag
  survives. Concurrent add+add commute (distinct tags); add vs concurrent
  remove commute (remove can't see the new tag). Source: RR-7506 Spec. 15 +
  Fig. 14; "Approaches" survey Fig. 5 (optimized op-based OR-Set) —
  https://dl.acm.org/doi/10.1145/3695249
- OR-Map: map of keys to nested CRDTs; observed-remove semantics per key;
  the composable unit behind Riak DT Maps. Sources: Almeida et al. JPDC 2018
  §7.4.9 (generic map composition); Riak DT Map product discussion (secondary) —
  https://docs.riak.com/riak/kv/2.2.3/learn/concepts/crdts/ (UNVERIFIED: Riak docs
  link not re-fetched for this draft; composition claim rests on JPDC paper).

### Causality: version vectors → dotted version vectors (DVV)

- Version vectors (one entry per replica) summarize causal past; `Va ≤ Vb`
  iff entry-wise ≤. Limitation with one entry per *server* under many
  *clients*: concurrent client writes via the same server get linearized or
  mis-tracked. Source: Preguiça et al., "Dotted Version Vectors" (the
  per-server-vs-per-client analysis + Fig. 3) —
  https://webarchive.di.uminho.pt/haslab.uminho.pt/psa/files/dvv-arxiv.pdf and
  http://gsd.di.uminho.pt/members/cbm/ps/podc-dotted.pdf
- DVV = (dot `(id, n)` identifying the event, version-vector past). Decouples
  *which event* from *what it saw*; causality check in O(1) (`na ≤ vb[ia]`);
  size bounded by replication degree, not client count. Adopted in Riak 2.0+
  (DVVs recommended over plain VVs to bound sibling explosion). Sources: same
  DVV papers; Riak causal-context docs —
  https://docs.riak.com/riak/kv/2.2.3/learn/concepts/causal-context/index.html
- Causal CRDT pattern built on dots: state = dot-store (tagged payload) +
  causal context (compressed history); join defined per dot-map/dot-set.
  Source: "Approaches" survey § on Causal CRDTs + state-based OR-Set over
  DotMap (Fig. 18) — https://dl.acm.org/doi/10.1145/3695249

### Tombstones and unbounded growth

- Removes in 2P-Sets/OR-Sets leave metadata: 2P-Set's removed-set only grows;
  naive OR-Set accumulates tags. The portfolio paper studies GC of metadata
  explicitly (RR-7506 §4). Garbage-collecting dots/tombstones safely needs
  *causal stability* (all replicas have seen the event) — otherwise a late
  duplicate resurrects or drops data. Source: RR-7506 §4; pure-op-based +
  causal-stability treatment in "Approaches" §4 —
  https://dl.acm.org/doi/10.1145/3695249
- Production echo: Yjs (YATA) keeps tombstones for ordering; it merges runs,
  strips deleted content, and GCs only when order no longer matters (e.g.
  parent deleted). Source: Yjs INTERNALS —
  https://raw.githubusercontent.com/yjs/yjs/main/INTERNALS.md and
  https://docs.yjs.dev/readme ; YATA paper (2016) via ResearchGate listing
  (UNVERIFIED: original PDF not re-fetched; claim rests on Yjs INTERNALS text).
- Automerge (JSON CRDT, RGA-family + columnar storage in v3, Peritext for text)
  as existence proof that JSON-shaped state with history can ship; not a claim
  about its internals here. Sources: https://automerge.org/ ,
  https://github.com/automerge/automerge/ ; history/landscape 2026 survey (use
  only for orientation, vendor-adjacent) —
  https://www.taskade.com/blog/crdt-history

---

## 3. What breaks in practice

1. **Clock skew kills naive wall-clock LWW.** Two writers with skewed clocks:
   the ahead-clock writer wins everything for the skew window; a far-future
   stamp can "lock out" all later legitimate writes. Akka's doc says exactly
   this (use LWW only when choice within skew doesn't matter). Mitigations with
   sources: (a) Hybrid Logical Clocks — wall time + counter + ID, monotonic per
   writer, causally pushed forward on receive (explainer —
   https://adamwulf.me/2021/05/distributed-clocks-and-crdts/ ; primary: Kulkarni
   et al., "Logical Physical Clocks", OPODIS 2014 — UNVERIFIED: cited from
   memory, PDF not re-fetched); (b) `max(wall, last+1)` + replica-ID tiebreak
   (lattice_registers doc above); (c) restrict timestamps to arbitrating
   *concurrent* values only, so a future stamp cannot suppress a causally-later
   write (MV-register §3 of PaPoC paper above).
2. **Concurrent same-key writes need an explicit policy.** LWW silently drops
   all but max(timestamp, replicaID) — simple, convergent, lossy by design.
   MV-register preserves concurrents and forces explicit resolution (human or
   deterministic `resolve≺`). For agent memory these are *different products*:
   LWW = "one canonical tip per slug"; MV = "show me the disagreement."
   Source for semantics: PaPoC MV-register paper above.
3. **Deletes vs tombstones: remove-wins does not exist for free.** In add-wins
   OR-Set/Map, remove only cancels observed tags; a concurrent add resurrects
   the key. There is no "remove-wins" without changing the type (or layering a
   separate arbitration). Deleting the tombstone early reintroduces the element
   on merge with a replica that hasn't seen the remove. Sources: RR-7506 OR-Set
   semantics; "Approaches" §5–6; Yjs tombstone discussion (links above).
4. **Merging structured values is not "merge the JSON."** Composing registers/
   sets inside a map requires per-field lattice semantics (each key maps to a
   CRDT, join is component-wise) plus a causality layer (dots/context) shared
   across the composition — the Riak-DT-Map lesson formalized as the generic map
   composition in JPDC 2018 §7. A plain union of JSON blobs is UNVERIFIED as a
   CRDT (it is not, in general, idempotent under concurrent field edits).
   Structured plans/verdicts therefore need a *schema-to-lattice* mapping per
   field (e.g. counters → G-Counter/PN-Counter, scalar tip → LWW with HLC,
   alternatives → MV-register, membership → OR-Set), not a single global rule.
5. **Op-based "just broadcast the edit" fails on our mailbox.** Without
   exactly-once causal delivery, op replay duplicates or reorders effects and
   breaks the commutativity precondition in practice (duplicate delivery is the
   textbook failure). If we want op-style small messages, use δ-state over the
   mailbox (idempotent join) with the relay log as the durability/causal backstop.
   Source for the demand: JPDC 2018 §1; PaPoC 2015 (links above).

---

## 4. Prior art on merging agent memory across sessions — separated, thin-marked

> This section is deliberately separated. CRDT theory above is mature;
> *agent-memory merge* below is thin, mostly preprints, vendor docs, and
> practitioner posts. Treat every item as lead, not authority.

- **MELD (preprint, thin).** Per-claim five-outcome admission
  (insert/merge/relate/conflict/reject from claim-key + embedding + NLI
  signals); per-claim *status* carried by a CRDT over pub/sub; contradictions
  preserved, never silently resolved; reports HotpotQA-distractor recall and
  30/30 partition-heal reconvergence vs 11/30 for LWW. Source: arXiv HTML
  (Aug 2025-class preprint) — https://arxiv.org/html/2608.16357 — THIN:
  unrefereed preprint, self-reported evals, no independent replication checked.
- **LWW-Element-Set memory mesh (practitioner post, thin).** Fleet of agent
  hosts, each with SQLite; entries keyed by origin UUID; merge = max(version),
  `updated_at` tiebreak; origin-guard against echo loops; Atom/JSON-Feed poll
  transport; LLM "archivist" for synthesis/dedup as a *separate* agent, not in
  the merge path; author notes version-counter should have been a vector clock.
  Source: DEV post 2026-05-28 —
  https://dev.to/nimbus_data/building-a-crdt-replicated-memory-mesh-for-ai-agents-5d5d
  — THIN: single-author field report, no proofs, edge cases admitted.
- **agentcrdt (OSS repo, thin).** Content-addressed facts
  `(domain, entity, attribute)` → slot; LWW merge (version, then timestamp);
  first-order semantic rules fire `ContradictionEvent`s at merge instead of
  silent overwrite; SQLite + REST + MCP. Source: https://github.com/sandeep-alluru/agentcrdt
  — THIN: small unrefereed codebase, LLM-generated-looking docs, no evaluation.
- **crdt-merge guides (vendor docs, thin).** Two-layer story: CRDT set-union
  layer (LWWMap/ORSet/PNCounter + Bloom dedup) then deterministic resolution
  (lww/max-confidence/priority/union); "composition of CRDTs is a CRDT" invoked
  from Shapiro et al. 2011. Sources:
  https://github.com/mgillr/crdt-merge/blob/main/docs/guides/convergent-multi-agent-ai.md ,
  https://github.com/mgillr/crdt-merge/blob/main/docs/guides/agentic-memory-at-scale.md
  — THIN: product docs, no proofs or independent evals; composition theorem
  itself is genuine (RR-7506/RR-7687) but the product claims are not evidence.
- **crdt.ms (vendor hub, thin).** Marketing-level mapping of OR-Sets/LWW-Maps/
  sequences onto agent scratchpads and memory; useful as a pattern vocabulary
  only. Source: https://crdt.ms/ — THIN: no technical content to verify.
- What was **not** found: no peer-reviewed result on LLM-agent engram/plan/
  verdict merge with convergence proofs; no standard for semantic (embedding/
  NLI-gated) merge that preserves CRDT convergence. UNVERIFIED: absence claim
  reflects this scout's search only, not an exhaustive review.

---

## 5. Uncertainty (explicit)

1. Transport characterization is assumed from the question (ephemeral mailbox +
   signed relay log, no reliable broadcast). If the relay log already gives
   total order + exactly-once replay, op-based becomes viable — confirm before
   ruling it out. UNVERIFIED.
2. HLC primary (Kulkarni et al. OPODIS 2014) not re-fetched; HLC mechanics above
   rest on a secondary explainer. UNVERIFIED as primary.
3. Riak DT Map composition details rest on the JPDC paper's §7.4.9 citation as
   remembered; Riak product docs not re-verified. UNVERIFIED.
4. YATA original PDF not re-fetched; Yjs claims rest on Yjs INTERNALS text.
   UNVERIFIED as primary.
5. All of §4 is thin by declaration; nothing there grounds a convergence claim
   for *semantic* merge. Semantic dedup/synthesis (embeddings, LLM archivist)
   is outside the CRDT convergence envelope — any such step must sit *above*
   the merge as a new causally-tracked write, never inside `join`.
6. No performance sizing was done (delta sizes, tombstone growth, relay-log
   throughput). Any capacity claim would be UNVERIFIED.

---

## 6. Design implications for OUR artifacts (engram slugs, plans, verdicts, census proposals)

1. **State-based (or δ-state) merge; mailbox carries idempotent deltas/full
   states, relay log is the backstop.** Op-based effects must not ride the bare
   mailbox. Concretely: engram write = delta-state joined locally, shipped as a
   signed delta; periodic full OR-Map state + relay-log anchor covers
   partition heal and new replicas. Matches the driver-owns-effects rule.
2. **One lattice per field, not one rule for the slug.** Suggested mapping:
   engram body tip → LWW-register with HLC `(wall, counter, sessionID)` +
   digest tiebreak (replaces wall-clock-only and today's first-wins/quarantine);
   concurrent alternatives → MV-register surfaced for review, never silently
   dropped; plan decompositions → OR-Set of subtask dots / G-Counter budgets;
   verdicts → keep the proven `worse` fold for *folding labor*, but cross-session
   verdict *merge* is itself LWW-or-MV per verdict-key (fold ≠ merge);
   census proposals → OR-Map entries with add-wins + explicit tombstones.
3. **Deletes are tombstones with causal stability, not erasure.** Today's
   "duplicate second-wins/quarantine" in `memory.in` does not converge across
   sessions; replace with add-wins + dots and GC tombstones only after the relay
   log shows all live sessions have observed the remove (causal stability).
   Until that signal exists, grow the tombstone set and say so.
4. **HLC + (sessionID, counter) dots from day one; never bare wall-clock.**
   Every engram/plan/verdict write gets `(hlc, sessionID, monotonic counter)`;
   merge compares HLC then sessionID then content digest. This removes the skew
   lockout (§3.1) while staying total and deterministic.
5. **Semantic steps (embeddings, LLM dedup/synthesis, MELD-style relate/conflict
   classification) are new writes above the lattice, fully audited.** The merge
   function stays pure (bytes/dots only, Bend-checkable like the verdict fold);
   any "these two engrams are the same" judgment emits a new causally-tracked
   patch (link/supersede/contradiction object), never rewrites history inside
   `join`. Contradictions are preserved as first-class objects pending human
   adjudication — agents draft, humans accept.
6. **Prove the small core; demo the rest.** Candidate Bend surface: `merge`
   associativity/commutativity/idempotence laws + inflation + LWW-tiebreak
   totality + OR-Set add-wins witness + tombstone-GC precondition, each with a
   falsification mutation (per the op-dispatch convention). Everything about
   recall quality, HLC sizing, and relay-log throughput stays *designed*, not
   proven, until measured.

---

## Source list (fetchable)

1. Shapiro, Preguiça, Baquero, Zawirski — "A comprehensive study of Convergent
   and Commutative Replicated Data Types" (INRIA RR-7506, Jan 2011) —
   https://inria.hal.science/inria-00555588
2. Shapiro et al. — "Conflict-Free Replicated Data Types" (INRIA RR-7687 v2,
   Aug 2011) — https://www.lip6.fr/Marc.Shapiro/papers/RR-7687.pdf ; also
   https://inria.hal.science/file/index/docid/617341/filename/RR-7687.pdf ; SSS
   2011 version — https://link.springer.com/chapter/10.1007/978-3-642-24550-3_29
3. Baquero et al. — "Approaches to Conflict-Free Replicated Data Types"
   (ACM Comput. Surv., 2025) — https://dl.acm.org/doi/10.1145/3695249
   (also https://dl.acm.org/doi/full/10.1145/3695249)
4. Almeida, Shoker, Baquero — "Delta State Replicated Data Types" (arXiv 2016)
   — https://arxiv.org/abs/1603.01529 ; journal (JPDC 111, 2018) —
   https://www.sciencedirect.com/science/article/abs/pii/S0743731517302332 ;
   early version (PaPoC 2015) — https://doi.org/10.1007/978-3-319-26850-7_5
5. Almeida et al. — "Efficient Synchronization of State-Based CRDTs"
   (join-decomposition) — https://members.loria.fr/CIgnat/files/replication/EfficientSynchronisation.pdf
6. Preguiça et al. — Dotted Version Vectors —
   https://webarchive.di.uminho.pt/haslab.uminho.pt/psa/files/dvv-arxiv.pdf ;
   PODC variant — http://gsd.di.uminho.pt/members/cbm/ps/podc-dotted.pdf ;
   Riak causal context — https://docs.riak.com/riak/kv/2.2.3/learn/concepts/causal-context/index.html
7. "Eventually Consistent Register Revisited" (MV-register + resolve≺, PaPoC) —
   https://webarchive.di.uminho.pt/haslab.uminho.pt/cbm/files/mvreg_papoc_camera.pdf
8. Whittaker summary of Shapiro 2011 (orientation only) —
   https://mwhittaker.github.io/papers/html/shapiro2011conflict.html
9. Akka LWWRegister docs (clock-skew warning + tiebreak) —
   https://doc.akka.io/japi/akka-core/2.10.22/akka/cluster/ddata/LWWRegister.html
10. lattice_registers LWW doc (`max(wall,last+1)`, no-reuse rule) —
    https://lattice-registers.hexdocs.pm/lattice_registers/lww_register.html
11. HLC explainer (secondary; primary UNVERIFIED) —
    https://adamwulf.me/2021/05/distributed-clocks-and-crdts/
12. Yjs docs + INTERNALS (YATA/tombstones/state vectors) —
    https://docs.yjs.dev/readme ;
    https://raw.githubusercontent.com/yjs/yjs/main/INTERNALS.md ;
    https://github.com/yjs/yjs
13. Automerge — https://automerge.org/ ; https://github.com/automerge/automerge/
14. Tantamanlands LWW-vs-vector-clock note (illustrative blog) —
    https://tantaman.com/2022-10-18-lamport-sufficient-for-lww.html
15. THIN agent-memory leads (§4, do not cite as authority):
    MELD — https://arxiv.org/html/2608.16357 ;
    memory mesh — https://dev.to/nimbus_data/building-a-crdt-replicated-memory-mesh-for-ai-agents-5d5d ;
    agentcrdt — https://github.com/sandeep-alluru/agentcrdt ;
    crdt-merge guides — https://github.com/mgillr/crdt-merge/blob/main/docs/guides/convergent-multi-agent-ai.md ,
    https://github.com/mgillr/crdt-merge/blob/main/docs/guides/agentic-memory-at-scale.md ;
    crdt.ms — https://crdt.ms/

(End of draft — human review required.)
