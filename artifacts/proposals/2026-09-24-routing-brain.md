# Routing brain: capability record + verb registry + learned router

**Status: SPEC — draft for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-decentralized-mesh.md` (system proposal)
**Scope:** the entire routing brain in one page — schema, registry, router θ, loop, acceptance.

---

## 1. Capability record schema

One record per node. Gossiped as a CRDT (LWW-map, see Merge below). Owner writes own.

| Field | Type | Gossiped? | Meaning |
|---|---|---|---|
| `node` | string | yes (key) | fleet name, e.g. `a3fckx-mini` (MagicDNS == identity) |
| `offers` | string[] | yes | capability tokens, e.g. `agent`, `ml.embed`, `ml.train`, `gpu.a40`, `storage` |
| `access` | object | yes | how to reach it: `{mesh: "http://a3fckx-mini:4096"}` and/or `{ssh: "mi300x"}` |
| `price` | map kind→float | yes | static base cost per job kind (market-lite ask); absent = default |
| `lamport` | int | yes | Lamport stamp of this record version |
| `src` | string | yes | `node` id of writer (== key under owner-writes-own) |
| `last_seen_mono` | float | **no** | local monotonic timestamp of last contact; expiry only, never ordered |

```json
{"node":"a3fckx-mini","offers":["agent"],"access":{"mesh":"http://a3fckx-mini:4096"},
 "price":{"default":10},"lamport":41,"src":"a3fckx-mini"}
{"node":"mi300x","offers":["ml.embed","ml.train","gpu.mi300x"],"access":{"ssh":"mi300x"},
 "price":{"ml.embed":2,"ml.train":5,"default":50},"lamport":18,"src":"mi300x"}
{"node":"a3fckx-air","offers":["agent","route"],"access":{"mesh":"http://a3fckx-air:4096"},
 "price":{"default":10},"lamport":63,"src":"a3fckx-air"}
```

*Note: `access` advertises intent; reachability is verified live (`401`), never assumed. The air URL above is post-Phase-0 — today air answers `000` via tailnet.*

**Merge (LWW-map):** per key, winner = `max` by `(lamport, node)` lexicographic. Identical on all replicas. Tombstone (`offers:["gone"]`) retires; a later live stamp resurrects. Owner-writes-own keeps conflicts rare; the rule settles the rest.

**Slow vs fast state (do not mix):** the record above is *slow* state (`offers`, `price`, `access` — changes rarely). *Fast* state (`load`, recent latency) lives in a separate ephemeral map keyed by `(node)`, merged by max-stamp with TTL expiry, never LWW-joined into the slow record. A load heartbeat must never bump the slow record's lamport or clobber `offers`/`price`.

## 2. Verb / tool registry (classify input)

Maps observable job features → `(kind, needs[])`. Checked in order: declared > inferred > learned.

| kind | verbs / tools / patterns | needs |
|---|---|---|
| `ml.train` | train, fit, finetune, torch, cuda, ckpt, safetensors, deepspeed | `[ml.train]` |
| `ml.embed` | embed, embedding, sentence-transformers, vectors, index | `[ml.embed]` |
| `ml.infer` | infer, generate, complete, llm, prompt-batch, eval-harness | `[ml.infer]` |
| `code.exec` | pytest, cargo test, build, lint, typecheck | `[code.exec]` (usually local) |
| `research` | browse, fetch, summarize, survey | `[research]` (usually local) |
| `move` | relocate, continue-elsewhere | `[agent]` on target + transfer |
| `default` | anything unmatched | `[]` (routable anywhere, prefers local) |

`needs` is matched against `offers` by subset: a node is a candidate iff `needs ⊆ offers` and `alive(node)`. `must_be_local` (secrets, local fs, keychain) short-circuits to `LOCAL` before routing.

## 3. Learned router θ

Agent-first primitive: agent state `s = (c, b, θ)` — `c` context (private: job content, live handles, secrets), `b` beliefs (shared CRDT incl. directory / offers / observed latency, failures, load, costs), `θ` policy params (shared, learned routing weights).

Router as policy `π(job) → distribution over nodes`. Features = job `(kind, needs, size, stakes)` + node `(offers, recent latency, failures, load)`. Two specified options (implement one):
- (a) gating network: scorer `f_θ(features)` → softmax over candidates; gradient update on accepts.
- (b) contextual bandit: per-node reward model with UCB / Thompson sampling over nodes.

Update rule (matching option):
- (a) policy-gradient step on `(job, node, latency, ok)`: reward `r = quality − cost`; `θ ← θ + η·r·∇_θ log π(node|job)`.
- (b) BoN-distill (STaR/ReST-style): sample N routings in `τ_int`, keep winners passing independent V (policy §2: tests/critic/exec/human — never self-scored by π alone), supervised distill step on winners only. τ_int verification is critic/sim; ground truth comes from τ_ext lessons.
Cold-start prior = static `price` from capability records (mesh `default: 10`, SSH `default: 50`); evidence reshapes weights from there. `α β γ` survive only as names inside that cold-start prior form (`price + α·lat + β·fail + γ·load`), never as fixed numbers — all weights are learned.

| Shared state | Written by / read by | Merge | Meaning |
|---|---|---|---|
| `θ` policy | local per node (τ_int trains, τ_ext acts) | gossip versioned deltas; merge by FedAvg round (or explicit LWW-owner) | learned routing weights |
| `b` beliefs (directory + costs) | both observe | CRDT join | shared directory, offers, observed costs |
| `g` goal | user sets, both read | LWW user-wins | standing goal / charter |
| `L` lessons `(features(job,node),a,r,θ-version)` | external appends, internal trains | G-set union | training data; never full `c`/`θ`/secrets |

Private forever (never gossiped, never merged): live external actions, discarded internal rollouts, un-gossiped observations, secrets.

Joint objective:

```
max  E[quality(τ_ext)] − λ·cost(τ_int + τ_ext) − μ·KL(π‖standing) + ν·diversity
```

- `E[quality(τ_ext)]`: maximize real-world outcome quality of the external trajectory.
- `λ·cost(τ_int + τ_ext)`: budget — penalizes test-time (internal) + execution (external) spend.
- `μ·KL(π‖standing)`: charter adherence — stay close to the standing / charter policy.
- `ν·diversity`: independent votes — reward diverse candidate sets, avoid collapse to one node.

Merge laws per table (unchanged — they now serve the learned update; convergence holds for directory/logs/kind-map only; θ converges only via the averaging protocol in the table above): observation logs for latency/failures are append-only G-sets (merge by union); every replica derives features/rewards deterministically from the merged log. `load` is TTL'd LWW per node (last reporter wins, expires). Learned kind map is LWW-map per signature by `(lamport, node)`, accept-only writes.

## 4. Two trajectories, one loop

- `τ_ext = (s, a_0, s_1, …)`, `a_t ~ π_ext(·|s_t; θ)` — world consequences, real-time, never blocks on learning.
- `τ_int = (s, â_0, ŝ_1, …)`, `â_t ~ π_int(·|ŝ_t; θ)` — simulated / reversible, test-time compute (BoN, refine, critic), never touches the world.

Coupling:

```
τ_int → (verification v, refined a*, ∇θ) → τ_ext / θ
τ_ext → experience (features, a, r, θ-version) → L → τ_int trains
```

Internal results (verification, refined action, gradient) flow forward into the external trajectory and the shared policy; external experience flows back into the lesson log that `τ_int` trains on.

```python
def classify(job):
    if job.kind: return job.kind, NEEDS.get(job.kind, [])
    tag = match_registry(job.text, job.tools)      # §2 inferred
    learned = jobtype_map.get(sig(job))            # learned from history
    kind = job.kind or tag or learned or "default"
    return kind, NEEDS[kind]

def route(job):
    kind, needs = classify(job)
    if needs_must_be_local(job): return LOCAL
    cands = [n for n, r in dir.items()
             if set(needs) <= set(r.offers) and alive(n)]
    if not cands: return LOCAL
    return sample_or_argmax(pi(job, cands, theta))  # queries π, not cost arithmetic

def observe(job, node, ok, latency):               # on every return
    kind, r = job.kind, reward(quality(job), spend(job, node, latency, ok))
    outbox += obs_log.append((job, node, ok, latency))  # G-set union (training features)
    outbox += lesson_log.append((features(job,node), node, r, θ-version))  # G-set union; never full c/θ/secrets
    jobtype_map[sig(job)] = kind;      outbox += delta   # accept-only
    # policy update (∇θ / distill) happens in τ_int, never here
```

`sig(job)` = hash of (normalized verbs + tool set + input shape class), never content. Lessons propagate; raw jobs don't.

## 5. Acceptance (verify the brain, not the vibes)

1. **Attraction:** publish a new capability (`ml.embed` on a fresh record) → matching jobs route to it within 3 gossip rounds.
2. **Convergence:** repeat one job shape 10× → routes settle on the stable winner; observation G-set digests identical across nodes and routes settle under π.
3. **Drain:** kill the winner mid-run → SWIM suspect → zero new jobs routed to it; traffic shifts to runner-up with no config change.
4. **One table:** an SSH-only and a mesh target compete for one job; the winner is by π (sample/argmax; cold-start prior = price), and the mechanism (ssh vs attach) follows the record's `access` field automatically.
5. **Learned recognition:** a job with no declared kind and novel wording routes correctly after ≤2 observed runs (registry miss → learned hit).
6. **No controller:** pass all of the above with any single node (including the "coordinator") powered off.
