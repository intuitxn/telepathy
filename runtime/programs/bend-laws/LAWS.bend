import Base

# ---- Telepathy boundary model -------------------------------------------
# Machine-checked form of the "tools prepare, humans accept" invariant and
# the meta-agent "You must not" rules. These laws are the formal twin of the
# prose charters in .opencode/agents/*.md. Humans write LAWS.bend; the AI
# writes PROOF.bend. `bend PROOF.bend` is the gate.

type Actor is Data:
  Human{}
  Agent{}

type Stage is Data:
  Proposed{}
  Active{}
  Review{}
  Resolved{}

type Job is Data:
  Job{stage: Stage, acceptedBy: Maybe<&2, Actor>}

# accept: the only transition that may close a Job. A Human may accept; an
# Agent may not — its attempt is a no-op and returns the Job unchanged.
def accept(job: Job, who: Actor) -> Job:
  match who:
    case Human{}:
      Job{Resolved{}, Some{Human{}}}
    case Agent{}:
      job

def stage_of(job: Job) -> Stage:
  match job:
    case Job{s, a}:
      s

# Orientation: stage rank never regresses. Proposed 0n -> Active 1n ->
# Review 2n -> Resolved 3n. Full-lifecycle orientation (Ready/Waiting/
# Cancelled, proof counts, freshness bit) lives in the agit kernel
# (docs/designs/agit-in-bend.md); this law pins the checkable core:
# accept either no-ops or jumps forward.
def stage_rank(s: Stage) -> Nat:
  match s:
    case Proposed{}:
      0n
    case Active{}:
      1n
    case Review{}:
      2n
    case Resolved{}:
      3n

def rank_le(a: Nat, b: Nat) -> Bool:
  Nat.is_le(a, b)

# Fuel: every kernel step spends fuel. advance applies at most one accept
# per fuel unit; zero fuel is a no-op by definition. Multi-step drivers
# (diffusion rank, rework loops) thread fuel the same way: one recursion
# level per step, so steps taken never exceed fuel granted.
def advance(job: Job, who: Actor, fuel: Nat) -> Job:
  match fuel:
    case 0n:
      job
    case 1n+p:
      accept(job, who)

def used(job: Job, who: Actor, fuel: Nat) -> Nat:
  match fuel:
    case 0n:
      0n
    case 1n+p:
      1n

# LAW 1: an Agent can never change a Job — it cannot accept, resolve, or mutate.
law agent_is_effect_free:
  for job: Job
  {accept(job, Agent{}) == job : Job}

# LAW 2: a Human acceptance always moves the Job to Resolved.
law human_accept_resolves:
  for job: Job
  {stage_of(accept(job, Human{})) == Resolved{} : Stage}

# LAW 3: acceptance is idempotent — a Resolved Job stays Resolved.
law accept_is_idempotent:
  for job: Job
  {accept(accept(job, Human{}), Human{}) == accept(job, Human{}) : Job}

# LAW 4: orientation is monotone — accept never moves a Job backward.
law orientation_monotone:
  for job: Job
  for who: Actor
  {rank_le(stage_rank(stage_of(job)), stage_rank(stage_of(accept(job, who)))) == True{} : Bool}

# LAW 5: steps taken never exceed fuel granted.
law fuel_bound:
  for job: Job
  for who: Actor
  for fuel: Nat
  {rank_le(used(job, who, fuel), fuel) == True{} : Bool}
