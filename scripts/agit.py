#!/usr/bin/env python3
"""agit: git as the state store for agentic jobs.

Thin wrapper implementing docs/designs/agentic-git.md section 2 (object model)
and section 3 (CLI sketch), with the gate/law semantics of
docs/designs/agit-in-bend.md sections 1-7.

Every state transition is a git object (commit, note, or tag). agit never
invents digests; it copies them from telepathy-program receipts and proof
envelopes. Nudge stays thin, Bend proves, git stores.

Conventions:
  - All git invocations use an absolute git binary path with an absolute
    repo cwd, and all file operations use absolute paths.
  - Commit trailers: Job/Stage/Bundle-Digest/Proof-Digest/Proof-Result/
    Candidate-Digest/Receipt-Id/Reviewer (+ Parent-Digest for lesson flow).
  - Notes refs: refs/notes/agit-state | refs/notes/agit-proof |
    refs/notes/agit-review.
  - Tags: agit/<id>/resolved (annotated), agit/<id>/cancelled (annotated),
    agit/<id>/review-<n> (lightweight).
  - Gate re-checks before merge+tag: proof pass, exact digests, human
    reviewer != worker, no open law. Any gate failure aborts with a named
    rule and no partial write.
  - Pre-commit leak scan rejects transcripts/credentials/sourceIds.
  - Pure-python stdlib only. No network, no credentials.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Errors: every failure carries a machine-readable rule name.
# ---------------------------------------------------------------------------

class AgitError(Exception):
    def __init__(self, rule, message):
        super().__init__(message)
        self.rule = rule
        self.message = message

# ---------------------------------------------------------------------------
# Constants from the designs.
# ---------------------------------------------------------------------------

STAGES = ("proposed", "ready", "active", "waiting", "review",
          "resolved", "cancelled")
COMMIT_STAGES = ("proposed", "active", "review", "resolved")

NOTES_STATE = "refs/notes/agit-state"
NOTES_PROOF = "refs/notes/agit-proof"
NOTES_REVIEW = "refs/notes/agit-review"

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RECEIPT_RE = re.compile(r"^[A-Za-z0-9_:.@-]{4,128}$")
JOB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
PROOF_RESULTS = ("pass", "fail", "not-evaluated")

AGENT_NAME_RE = re.compile(
    r"(?i)(bot|agent|model|opencode|codex|worker|\bai\b|assistant|system"
    r"|auto[_-]?accept|llm|\bgpt\b|claude|gemini|deepseek)")

# Pre-commit leak scan: credentials, private keys, transcript markers.
CREDENTIAL_RES = [
    r"BUZZ_PRIVATE_KEY", r"BUZZ_AUTH_TAG",
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY",
    r"(?i)\b(api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret)"
    r"\b\s*[:=]\s*\S+",
    r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]+=*",
    r"(?i)\bpassword\s*[:=]\s*\S+",
    r"(?i)\baws_(secret|session|access)[A-Za-z_]*\s*[:=]\s*\S+",
    r"xox[bap]-",
    r"gh[pousr]_[A-Za-z0-9]+",
]
TRANSCRIPT_RES = [
    r"(?i)\btranscript\b",
    r"(?i)session[\s_-]?id\s*[:=]",
    r"(?i)conversation[\s_-]?history",
]

# Canonical law order (agit-in-bend.md section 4, agentic-git.md section 4).
LAWS = ("exact-revision", "source-separation", "human-authorship",
        "acceptance-shape", "lineage")
LAW_ALIASES = {
    "exact": "exact-revision", "exact_revision": "exact-revision",
    "exact-revision": "exact-revision",
    "separation": "source-separation", "source_separation": "source-separation",
    "source-separation": "source-separation", "hygiene": "source-separation",
    "authorship": "human-authorship", "human_authorship": "human-authorship",
    "human-authorship": "human-authorship",
    "shape": "acceptance-shape", "acceptance_shape": "acceptance-shape",
    "acceptance-shape": "acceptance-shape",
    "lineage": "lineage",
}

# ---------------------------------------------------------------------------
# Git plumbing: absolute binary, absolute cwd, no prompts.
# ---------------------------------------------------------------------------

def git_binary():
    found = shutil.which("git")
    if not found:
        raise AgitError("git-missing", "git binary not found on PATH")
    return os.path.realpath(found)


def run_git(repo, args, check=True, input_text=None):
    git = git_binary()
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    proc = subprocess.run(
        [git] + list(args), cwd=str(repo), env=env,
        input=input_text, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise AgitError("git-failed",
                        "git %s failed: %s" % (" ".join(args),
                                               (proc.stderr.strip()
                                                or proc.stdout.strip())[:500]))
    return proc


def find_repo(explicit=None):
    if explicit:
        repo = Path(explicit).expanduser().resolve()
        if not (repo / ".git").exists() and not (repo / "HEAD").exists():
            # Bare repos have HEAD at top level; worktrees have .git file.
            pass
        return repo
    git = git_binary()
    proc = subprocess.run([git, "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise AgitError("not-a-repo",
                        "not inside a git repo; pass --repo <path>")
    return Path(proc.stdout.strip()).resolve()


def branch_exists(repo, branch):
    proc = run_git(repo, ["rev-parse", "--verify", "--quiet",
                          "refs/heads/" + branch], check=False)
    return proc.returncode == 0


def tag_exists(repo, tag):
    proc = run_git(repo, ["rev-parse", "--verify", "--quiet",
                          "refs/tags/" + tag], check=False)
    return proc.returncode == 0


def rev_parse(repo, rev):
    return run_git(repo, ["rev-parse", "--verify", rev]).stdout.strip()


def clean_tree(repo):
    out = run_git(repo, ["status", "--porcelain"]).stdout
    # Untracked files (??) never belong to a job branch transition and are
    # left alone; any staged/modified/tracked change blocks branch moves.
    tracked = [line for line in out.splitlines()
               if line and not line.startswith("??")]
    return not tracked


def require_clean(repo):
    if not clean_tree(repo):
        raise AgitError("dirty-worktree",
                        "working tree is dirty; stash or commit before agit "
                        "touches branches")


def read_note(repo, ref, sha):
    proc = run_git(repo, ["notes", "--ref", ref, "show", sha], check=False)
    if proc.returncode != 0:
        return None
    return proc.stdout


def write_note(repo, ref, sha, content, append=False):
    if append:
        existing = read_note(repo, ref, sha)
        if existing:
            content = existing.rstrip("\n") + "\n---\n" + content
    tmp = None
    try:
        fd, tmppath = tempfile.mkstemp(prefix="agit-note-")
        tmp = tmppath
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
        run_git(repo, ["notes", "--ref", ref, "add", "-f", "-F", tmppath, sha])
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)

# ---------------------------------------------------------------------------
# Validation helpers.
# ---------------------------------------------------------------------------

def validate_job_id(job):
    if not job or not JOB_RE.match(job):
        raise AgitError("bad-job-id",
                        "job id must match [A-Za-z0-9._-], got %r" % (job,))
    return job


def validate_digest(value, field, allow_none=True):
    if allow_none and value in ("none", None):
        return "none"
    if value and DIGEST_RE.match(value):
        return value
    raise AgitError("invalid-digest",
                    "%s must be sha256:<64 hex>%s, got %r"
                    % (field, " or 'none'" if allow_none else "", value))


def validate_receipt(value, allow_none=True):
    if allow_none and value in ("none", None):
        return "none"
    if value and RECEIPT_RE.match(value) and " " not in value:
        return value
    raise AgitError("invalid-receipt",
                    "Receipt-Id must be a whitespace-free token%s, got %r"
                    % (" or 'none'" if allow_none else "", value))


def validate_intent(intent):
    if not intent or not intent.strip():
        raise AgitError("invalid-intent", "intent must be non-empty")
    intent = intent.strip().splitlines()[0]
    if len(intent) > 80:
        raise AgitError("invalid-intent",
                        "intent must fit in 80 cols, got %d" % len(intent))
    return intent


def looks_human_reviewer(name):
    if not name or not name.strip():
        return False
    text = name.strip()
    if text.lower() == "none":
        return False
    if not 2 <= len(text) <= 80:
        return False
    if not re.search(r"[A-Za-z]", text):
        return False
    if AGENT_NAME_RE.search(text):
        return False
    return True


def reviewer_distinct(reviewer, worker_bits):
    low = reviewer.strip().lower()
    for bit in worker_bits:
        if not bit:
            continue
        other = str(bit).strip().lower()
        if not other or other == "none":
            continue
        if low == other:
            return False
        if len(other) >= 4 and (other in low or low in other):
            return False
    return True


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def digest_of_bytes(data):
    return "sha256:" + sha256_hex(data)


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def scan_leaks(text, source_ids=(), receipt_ids=(), label="content"):
    """Return a list of leak descriptions; empty means clean."""
    hits = []
    if text is None:
        return hits
    for pattern in CREDENTIAL_RES + TRANSCRIPT_RES:
        match = re.search(pattern, text)
        if match:
            hits.append("%s: matches %r" % (label, match.group(0)[:40]))
    for sid in source_ids or ():
        if sid and len(sid) >= 1 and sid in text:
            hits.append("%s: contains supplied sourceId %r" % (label, sid[:24]))
    for rid in receipt_ids or ():
        if rid and rid != "none" and len(rid) >= 8 and rid in text:
            hits.append("%s: contains receipt id %r" % (label, rid[:16]))
    return hits


def check_shape(candidate_bytes):
    """Acceptance-shape law over candidate bytes (shell side)."""
    if not candidate_bytes or not candidate_bytes.strip():
        return False
    if len(candidate_bytes) > 1000000:
        return False
    stripped = candidate_bytes.strip()
    if stripped[:1] in (b"{",):
        try:
            data = json.loads(stripped.decode("utf-8"))
        except Exception:
            return False
        if not isinstance(data, dict):
            return False
        return bool(isinstance(data.get("title"), str) and data["title"].strip()
                    and isinstance(data.get("body"), str) and data["body"].strip())
    return True

# ---------------------------------------------------------------------------
# Commit message model (agentic-git.md section 2.1).
# ---------------------------------------------------------------------------

TRAILER_KEYS = ("Job", "Stage", "Bundle-Digest", "Proof-Digest",
                "Proof-Result", "Candidate-Digest", "Receipt-Id",
                "Reviewer", "Parent-Digest")


def parse_trailers(message):
    found = {}
    for line in message.splitlines():
        match = re.match(r"^([A-Za-z-]+):\s*(.*?)\s*$", line)
        if match and match.group(1) in TRAILER_KEYS:
            found.setdefault(match.group(1), match.group(2))
    return found


def build_message(verb, job, intent, stage, trailers, body=""):
    if stage not in STAGES:
        raise AgitError("invalid-trailer", "unknown stage %r" % (stage,))
    lines = ["%s %s: %s \u2014 %s" % (verb, job, intent, stage), ""]
    order = ["Job", "Stage", "Bundle-Digest", "Proof-Digest", "Proof-Result",
             "Candidate-Digest", "Receipt-Id", "Reviewer", "Parent-Digest"]
    merged = dict(trailers)
    merged["Job"] = job
    merged["Stage"] = stage
    for key in order:
        if key in merged and merged[key] is not None:
            lines.append("%s: %s" % (key, merged[key]))
    if body:
        lines += ["", body]
    return "\n".join(lines) + "\n"


def check_trailer_stage_consistency(stage, trailers, rule_prefix=""):
    """Reviewer trailer: mandatory on resolved, forbidden earlier."""
    reviewer = trailers.get("Reviewer", "none")
    if stage == "resolved":
        if not looks_human_reviewer(reviewer):
            raise AgitError(rule_prefix + "self-accept" if rule_prefix else "self-accept",
                            "resolved commit needs a named human Reviewer")
    else:
        if reviewer != "none":
            raise AgitError("invalid-trailer",
                            "Reviewer must be 'none' before resolution "
                            "(no agent pre-accept)")
    if stage in ("active", "waiting", "review"):
        for key in ("Bundle-Digest", "Proof-Digest", "Proof-Result",
                    "Candidate-Digest"):
            if key not in trailers:
                raise AgitError("invalid-trailer",
                                "%s trailer is mandatory from Active onward"
                                % key)
    pr = trailers.get("Proof-Result", "not-evaluated")
    if pr not in PROOF_RESULTS:
        raise AgitError("invalid-trailer",
                        "Proof-Result must be pass|fail|not-evaluated")

# ---------------------------------------------------------------------------
# Proof envelope (refs/notes/agit-proof).
# ---------------------------------------------------------------------------

def normalize_proof_envelope(data):
    if not isinstance(data, dict):
        raise AgitError("invalid-proof", "proof file must hold a JSON object")
    lowered = {}
    for key, value in data.items():
        lowered[str(key).strip().lower()] = value
    digest = (lowered.get("proofdigest") or lowered.get("proof_digest")
              or lowered.get("digest") or lowered.get("proof"))
    result = lowered.get("result")
    candidate = (lowered.get("candidatedigest")
                 or lowered.get("candidate_digest")
                 or lowered.get("candidate"))
    laws = lowered.get("laws") or {}
    bend = lowered.get("bend") or lowered.get("version") or "unknown"
    if not isinstance(digest, str) or not DIGEST_RE.match(digest):
        raise AgitError("invalid-proof",
                        "proof needs proofDigest sha256:<64 hex>")
    if result not in ("pass", "fail"):
        raise AgitError("invalid-proof",
                        "proof result must be 'pass' or 'fail'")
    if candidate is not None and not DIGEST_RE.match(str(candidate)):
        raise AgitError("invalid-proof",
                        "proof candidateDigest must be sha256:<64 hex>")
    if not isinstance(laws, dict):
        raise AgitError("invalid-proof", "proof laws must be an object")
    norm_laws = {}
    for key, value in laws.items():
        canon = LAW_ALIASES.get(str(key).strip().lower())
        if not canon:
            continue
        text = str(value).strip().lower()
        if text not in ("pass", "fail", "not-evaluated", "not_evaluated"):
            raise AgitError("invalid-proof",
                            "law %r must be pass|fail|not-evaluated" % key)
        norm_laws[canon] = "not-evaluated" if text == "not_evaluated" else text
    return {"proofDigest": digest, "result": result,
            "candidateDigest": candidate, "laws": norm_laws, "bend": bend}


def evaluate_gate(envelope):
    """Bend gate verdict over law outcomes (agit-in-bend.md section 5).

    Returns (verdict, detail) where verdict is 'allow', 'deny:<law>', or
    'need:<law|review-input>'. First Fail wins and names its law.
    """
    laws = envelope.get("laws", {})
    ordered = [(law, laws.get(law, "not-evaluated")) for law in LAWS]
    for law, outcome in ordered:
        if outcome == "fail":
            return "deny:" + law, "law %d %s failed" % (LAWS.index(law) + 1, law)
    pending = [law for law, outcome in ordered if outcome != "pass"]
    if envelope.get("result") != "pass":
        return "need:result", "proof result is not pass"
    if pending:
        return "need:" + pending[0], "law %s is not pass" % pending[0]
    return "allow", "all five laws pass"

# ---------------------------------------------------------------------------
# Job record reconstruction from git (SQLite is never consulted).
# ---------------------------------------------------------------------------

def job_branch(job):
    return "agit/job-" + job


def resolved_tag(job):
    return "agit/%s/resolved" % job


def cancelled_tag(job):
    return "agit/%s/cancelled" % job


def collect_job_commits(repo, job, ref):
    """All commits on ref carrying this job's trailers, oldest first."""
    try:
        out = run_git(repo, ["log", "--topo-order", "--reverse",
                             "--format=%H%x1f%s%x1f%B%x1e", ref]).stdout
    except AgitError:
        return []
    commits = []
    for chunk in out.split("\x1e"):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        parts = chunk.split("\x1f")
        if len(parts) < 3:
            continue
        sha, subject, body = parts[0].strip(), parts[1], parts[2]
        trailers = parse_trailers(subject + "\n" + body)
        if trailers.get("Job") == job:
            commits.append({"sha": sha, "subject": subject.strip(),
                            "trailers": trailers})
    return commits


def review_tags(repo, job):
    proc = run_git(repo, ["tag", "--list", "agit/%s/review-*" % job])
    tags = sorted(t.strip() for t in proc.stdout.splitlines() if t.strip())
    def key(tag):
        try:
            return int(tag.rsplit("-", 1)[1])
        except ValueError:
            return 0
    return sorted(tags, key=key)


def current_record(repo, job):
    """Rebuild the job record from git objects alone."""
    validate_job_id(job)
    branch = job_branch(job)
    rtag, ctag = resolved_tag(job), cancelled_tag(job)
    has_resolved = tag_exists(repo, rtag)
    has_cancelled = tag_exists(repo, ctag)
    commits = []
    if branch_exists(repo, branch):
        commits = collect_job_commits(repo, job, branch)
    elif has_resolved:
        commits = collect_job_commits(repo, job, rtag)
    notes = {}
    for commit in commits:
        sha = commit["sha"]
        notes[sha] = {
            "state": read_note(repo, NOTES_STATE, sha),
            "proof": read_note(repo, NOTES_PROOF, sha),
            "review": read_note(repo, NOTES_REVIEW, sha),
        }
    record = {"job": job, "branch": branch, "commits": commits,
              "notes": notes, "review_tags": review_tags(repo, job),
              "resolved_tag": rtag if has_resolved else None,
              "cancelled_tag": ctag if has_cancelled else None,
              "resolved_sha": rev_parse(repo, rtag) if has_resolved else None,
              "cancelled_sha": rev_parse(repo, ctag) if has_cancelled else None}
    if has_resolved and has_cancelled:
        record["stage"] = "tampered"
        record["blockers"] = ["history-tampering: both resolved and "
                              "cancelled tags exist; human must intervene "
                              "with a new job"]
        return record
    if has_resolved:
        record["stage"] = "resolved"
        record["blockers"] = []
        return record
    if has_cancelled:
        record["stage"] = "cancelled"
        record["blockers"] = []
        return record
    if not commits:
        raise AgitError("not-found", "no agit record for job %r" % job)
    tip = commits[-1]
    tip_stage = tip["trailers"].get("Stage", "")
    tip_notes = notes[tip["sha"]]
    if tip_stage == "proposed":
        if tip_notes["state"]:
            record["stage"] = "ready"
        else:
            record["stage"] = "proposed"
    elif tip_stage == "active":
        if tip_notes["proof"]:
            record["stage"] = "waiting"
        else:
            record["stage"] = "active"
    elif tip_stage == "review":
        record["stage"] = "review"
    elif tip_stage == "resolved":
        record["stage"] = "resolved"
    else:
        raise AgitError("invalid-trailer",
                        "tip commit has unknown Stage %r" % (tip_stage,))
    record["blockers"] = describe_blockers(record)
    return record


def parse_proof_note(text):
    try:
        data = json.loads(text)
    except Exception:
        raise AgitError("invalid-proof",
                        "agit-proof note is not valid JSON")
    return normalize_proof_envelope(data)


def freshest_proof(record):
    """Prefer a proof note on the newest Review commit, else Active."""
    for commit in reversed(record["commits"]):
        if commit["trailers"].get("Stage") == "review":
            text = record["notes"][commit["sha"]]["proof"]
            if text:
                return commit, parse_proof_note(text)
    for commit in reversed(record["commits"]):
        if commit["trailers"].get("Stage") == "active":
            text = record["notes"][commit["sha"]]["proof"]
            if text:
                return commit, parse_proof_note(text)
    return None, None


def active_commit(record):
    for commit in record["commits"]:
        if commit["trailers"].get("Stage") == "active":
            return commit
    return None


def review_tip(record):
    reviews = [c for c in record["commits"]
               if c["trailers"].get("Stage") == "review"]
    return reviews[-1] if reviews else None


def run_envelope(repo, record):
    try:
        out = run_git(repo, ["show", job_branch(record["job"])
                             + ":RUN.envelope.json"], check=False)
        if out.returncode != 0:
            return {}
        return json.loads(out.stdout)
    except Exception:
        return {}


def candidate_bytes_at(repo, job, sha):
    for path in ("CANDIDATE.md", "CANDIDATE.bin", "CANDIDATE"):
        proc = run_git(repo, ["show", "%s:%s" % (sha, path)], check=False)
        if proc.returncode == 0:
            return proc.stdout.encode("utf-8", "ignore")
    # Fallback: hash of the whole tree diff is out of scope; report absence.
    return None


def describe_blockers(record):
    stage = record.get("stage")
    if stage in ("resolved", "cancelled", "tampered"):
        return record.get("blockers", [])
    commits = record["commits"]
    tip = commits[-1]
    trailers = tip["trailers"]
    if stage == "proposed":
        return ["run `agit ready --job %s` to record readiness" % record["job"]]
    if stage == "ready":
        return ["run `agit run --job %s` to record the Active commit"
                % record["job"]]
    if stage == "active":
        return ["run `agit prove --job %s --proof proof.json` to record the "
                "Waiting proof note" % record["job"]]
    if stage == "waiting":
        return ["run `agit review --job %s --candidate FILE` to record the "
                "Review commit" % record["job"]]
    if stage == "review":
        blockers = []
        _, proof = freshest_proof(record)
        if proof is None:
            blockers.append("missing-proof: no refs/notes/agit-proof note; "
                            "run `agit prove` on the Review tip")
        else:
            verdict, detail = evaluate_gate(proof)
            if verdict != "allow":
                blockers.append("open-law: %s" % detail)
            if not proof.get("candidateDigest"):
                blockers.append("exact-revision: proof note carries no "
                                "candidateDigest")
            elif (proof["candidateDigest"]
                    != trailers.get("Candidate-Digest")):
                blockers.append("exact-revision: proof candidate != reviewed "
                                "candidate")
            active = active_commit(record)
            if (active and trailers.get("Bundle-Digest") !=
                    active["trailers"].get("Bundle-Digest")):
                blockers.append("stale-digest: review bundle != active bundle")
        blockers.append("run `agit accept --job %s --reviewer NAME` once the "
                        "gate is green" % record["job"])
        return blockers
    return ["unknown stage; inspect with `agit log %s`" % record["job"]]

# ---------------------------------------------------------------------------
# SQLite divergence (best effort, read-only, never repaired).
# ---------------------------------------------------------------------------

SQLITE_STAGE_MAP = {"queued": "proposed", "running": "active",
                    "needs_review": "review", "needs_attention": "waiting",
                    "resolved": "resolved"}


def sqlite_projection(repo, job):
    """Best-effort read of a Desk SQLite cache; None when absent."""
    try:
        import sqlite3
    except ImportError:
        return None
    candidates = sorted((repo / ".local").glob("*.sqlite*")) + \
        sorted((repo / ".local").glob("*.db"))
    for dbpath in candidates:
        try:
            conn = sqlite3.connect("file:%s?mode=ro" % dbpath, uri=True)
            try:
                rows = conn.execute(
                    "SELECT state FROM jobs WHERE id=?", (job,)).fetchall()
            finally:
                conn.close()
            if rows:
                return {"db": str(dbpath), "state": rows[0][0]}
        except Exception:
            continue
    return None


def check_divergence(repo, job, git_stage):
    proj = sqlite_projection(repo, job)
    if not proj:
        return
    mapped = SQLITE_STAGE_MAP.get(str(proj["state"]))
    terminal_git = git_stage in ("resolved", "cancelled")
    if mapped and mapped != git_stage and not (
            terminal_git and proj["state"] == "resolved"):
        # resolved/cancelled granularity differs; only flag real conflicts.
        if git_stage == "cancelled" and proj["state"] == "resolved":
            pass
        else:
            raise AgitError("divergence",
                            "SQLite (%s=%s) disagrees with git (%s); git "
                            "wins and advancement is blocked until a human "
                            "reconciles" % (proj["db"], proj["state"],
                                            git_stage))

# ---------------------------------------------------------------------------
# Subcommands.
# ---------------------------------------------------------------------------

def load_request_meta(path):
    if not path:
        return "none", []
    data = Path(path).expanduser().resolve().read_bytes()
    req_digest = digest_of_bytes(data)
    try:
        parsed = json.loads(data.decode("utf-8"))
        ids = parsed.get("sourceIds") or parsed.get("source_ids") or []
        source_ids = [str(x) for x in ids if isinstance(x, str) and x]
    except Exception:
        source_ids = []
    return req_digest, source_ids


def cmd_propose(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    intent = validate_intent(args.intent or args.job)
    branch = job_branch(job)
    if branch_exists(repo, branch) or tag_exists(repo, resolved_tag(job)) \
            or tag_exists(repo, cancelled_tag(job)):
        raise AgitError("already-exists",
                        "agit record for job %r already exists" % job)
    if args.bundle_digest:
        bundle = validate_digest(args.bundle_digest, "Bundle-Digest")
        bundle_reason = ""
    else:
        bundle = "none"
        bundle_reason = args.bundle_reason or "program not yet compiled"
    base = args.base or run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    rev_parse(repo, base)
    req_digest, req_source_ids = load_request_meta(args.request)
    source_ids = list(dict.fromkeys(req_source_ids + (args.source_id or [])))
    proof_src = None
    if args.proof_src:
        proof_src = Path(args.proof_src).expanduser().resolve().read_bytes()
    else:
        proof_src = ("# PROOF.bend skeleton for job %s\n# Laws: %s\n" % (
            job, ", ".join(LAWS))).encode()
    body_bits = ["Program: %s" % (args.program or "unspecified"),
                 "Request: %s" % req_digest]
    if bundle == "none":
        body_bits.append("Bundle: none (%s)" % bundle_reason)
    body = "\n".join(body_bits)
    trailers = {"Bundle-Digest": bundle, "Proof-Digest": "none",
                "Proof-Result": "not-evaluated", "Candidate-Digest": "none",
                "Receipt-Id": "none", "Reviewer": "none"}
    message = build_message("propose", job, intent, "proposed", trailers, body)
    check_trailer_stage_consistency("proposed", parse_trailers(message))
    leaks = scan_leaks(message + proof_src.decode("utf-8", "ignore"),
                       source_ids, (), label="propose")
    if leaks:
        raise AgitError("leakage", "propose blocked: " + "; ".join(leaks[:5]))
    require_clean(repo)
    run_git(repo, ["checkout", "-b", branch, base])
    try:
        job_file = repo / "JOB.nudge.md"
        job_file.write_text(
            "# Job %s \u2014 intent\n\nProgram: %s\nIntent: %s\n"
            "Request-SHA256: %s\nBundle-Digest: %s\nCreated-At: %s\n" % (
                job, args.program or "unspecified", intent, req_digest,
                bundle, utcnow()))
        (repo / "PROOF.bend").write_bytes(proof_src)
        run_git(repo, ["add", "--", "JOB.nudge.md", "PROOF.bend"])
        run_git(repo, ["commit", "-m", message])
        sha = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    except AgitError:
        run_git(repo, ["checkout", "--force", base], check=False)
        raise
    print("proposed %s on %s (%s)" % (job, branch, sha[:12]))
    return 0


def cmd_ready(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    record = current_record(repo, job)
    check_divergence(repo, job, record["stage"])
    if record["stage"] == "ready":
        raise AgitError("bad-stage", "job %r is already Ready" % job)
    if record["stage"] != "proposed":
        raise AgitError("bad-stage",
                        "ready needs Proposed, job %r is %s"
                        % (job, record["stage"]))
    tip = record["commits"][-1]["sha"]
    base = args.base or run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    rev_parse(repo, base)
    context_lines = []
    for ctx in args.context or []:
        path = Path(ctx).expanduser().resolve()
        data = path.read_bytes()
        if len(data) > 120000:
            raise AgitError("bad-context",
                            "context file %s exceeds 120 KB" % ctx)
        try:
            rel = str(path.relative_to(repo))
        except ValueError:
            rel = path.name
        context_lines.append("  %s: %s" % (rel, digest_of_bytes(data)))
    note = "\n".join([
        "job: %s" % job,
        "stage: ready",
        "base: %s" % base,
        "context:",
    ] + (context_lines or ["  (none)"]) + [
        "model: %s" % (args.model or "unspecified"),
        "adapter: %s" % (args.adapter or "unspecified"),
        "recordedAt: %s" % utcnow(),
    ]) + "\n"
    leaks = scan_leaks(note, args.source_id, (), label="ready-note")
    if leaks:
        raise AgitError("leakage", "ready blocked: " + "; ".join(leaks[:5]))
    write_note(repo, NOTES_STATE, tip, note)
    print("ready %s (note on %s)" % (job, tip[:12]))
    return 0


def receipt_from_args(args):
    bundle, receipt = args.bundle_digest, args.receipt_id
    if args.receipt_json:
        data = json.loads(Path(args.receipt_json).expanduser().resolve()
                          .read_text())
        inner = data.get("receipt", data)
        bundle = bundle or inner.get("bundleDigest")
        receipt = receipt or inner.get("id")
    return bundle, receipt


def cmd_run(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    intent = validate_intent(args.intent or args.job)
    record = current_record(repo, job)
    check_divergence(repo, job, record["stage"])
    if record["stage"] != "ready":
        raise AgitError("bad-stage",
                        "run needs Ready, job %r is %s"
                        % (job, record["stage"]))
    bundle_raw, receipt_raw = receipt_from_args(args)
    if not bundle_raw:
        raise AgitError("invalid-digest",
                        "run needs --bundle-digest or --receipt-json with "
                        "receipt.bundleDigest (agit never invents digests)")
    if not receipt_raw:
        raise AgitError("invalid-receipt",
                        "run needs --receipt-id or --receipt-json with "
                        "receipt.id")
    bundle = validate_digest(bundle_raw, "Bundle-Digest",
                             allow_none=False)
    receipt = validate_receipt(receipt_raw, allow_none=False)
    model = args.model or "unspecified"
    adapter = args.adapter or "unspecified"
    base = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    brief_hash = "none"
    if args.brief:
        brief_hash = digest_of_bytes(
            Path(args.brief).expanduser().resolve().read_bytes())
    body = "\n".join(["Model: %s" % model, "Adapter: %s" % adapter,
                      "Base: %s" % base, "Brief: %s" % brief_hash])
    trailers = {"Bundle-Digest": bundle, "Proof-Digest": "none",
                "Proof-Result": "not-evaluated", "Candidate-Digest": "none",
                "Receipt-Id": receipt, "Reviewer": "none"}
    message = build_message("run", job, intent, "active", trailers, body)
    check_trailer_stage_consistency("active", parse_trailers(message))
    # The Receipt-Id trailer is the sanctioned carrier of the receipt id, so
    # the message scan excludes it; it must never appear anywhere else.
    leaks = scan_leaks(message + model + adapter, args.source_id,
                       (), label="run")
    if leaks:
        raise AgitError("leakage", "run blocked: " + "; ".join(leaks[:5]))
    require_clean(repo)
    branch = job_branch(job)
    run_git(repo, ["checkout", branch])
    try:
        envelope = {"job": job, "bundleDigest": bundle, "receiptId": receipt,
                    "model": model, "adapter": adapter, "base": base,
                    "briefHash": brief_hash, "createdAt": utcnow(),
                    "worker": "%s|%s" % (model, adapter)}
        (repo / "RUN.envelope.json").write_text(
            json.dumps(envelope, indent=2, sort_keys=True) + "\n")
        run_git(repo, ["add", "--", "RUN.envelope.json"])
        run_git(repo, ["commit", "-m", message])
        sha = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    except AgitError:
        raise
    print("active %s (%s)" % (job, sha[:12]))
    return 0


def cmd_prove(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    record = current_record(repo, job)
    check_divergence(repo, job, record["stage"])
    stage = record["stage"]
    if stage not in ("active", "waiting", "review"):
        raise AgitError("bad-stage",
                        "prove needs Active or Review, job %r is %s"
                        % (job, stage))
    if stage == "waiting":
        raise AgitError("bad-stage",
                        "job %r already carries a proof note; clearing a law "
                        "means a new Review commit, never editing the proof"
                        % job)
    tip = record["commits"][-1]["sha"]
    if record["notes"][tip]["proof"]:
        raise AgitError("bad-stage",
                        "proof note already exists on %s; record a new "
                        "Review commit first" % tip[:12])
    raw = Path(args.proof).expanduser().resolve().read_text()
    envelope = normalize_proof_envelope(json.loads(raw))
    envelope["evaluatedAt"] = utcnow()
    envelope["job"] = job
    note_text = json.dumps(envelope, indent=2, sort_keys=True) + "\n"
    leaks = scan_leaks(note_text + raw, args.source_id, (), label="proof")
    if leaks:
        raise AgitError("leakage", "prove blocked: " + "; ".join(leaks[:5]))
    write_note(repo, NOTES_PROOF, tip, note_text)
    print("proved %s (%s -> %s)" % (job, tip[:12], envelope["result"]))
    return 0


def cmd_review(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    intent = validate_intent(args.intent or args.job)
    record = current_record(repo, job)
    check_divergence(repo, job, record["stage"])
    stage = record["stage"]
    cand_path = Path(args.candidate).expanduser().resolve()
    candidate = cand_path.read_bytes()
    if not candidate.strip():
        raise AgitError("acceptance-shape",
                        "candidate is empty; refusing Review commit")
    if not check_shape(candidate):
        raise AgitError("acceptance-shape",
                        "candidate fails the acceptance-shape law (JSON needs "
                        "non-empty title/body)")
    cand_digest = digest_of_bytes(candidate)
    if stage == "review":
        tip_cand = review_tip(record)["trailers"].get("Candidate-Digest")
        if cand_digest == tip_cand:
            raise AgitError("bad-stage",
                            "candidate unchanged; fix the candidate before a "
                            "new Review commit")
    elif stage != "waiting":
        raise AgitError("bad-stage",
                        "review needs Waiting (prove first), job %r is %s"
                        % (job, stage))
    active = active_commit(record)
    if active is None:
        raise AgitError("not-found", "no Active commit for job %r" % job)
    bundle = active["trailers"].get("Bundle-Digest", "none")
    receipt = active["trailers"].get("Receipt-Id", "none")
    _, proof = freshest_proof(record)
    if proof is None:
        proof_digest, proof_result = "none", "not-evaluated"
    else:
        proof_digest, proof_result = proof["proofDigest"], proof["result"]
    score = args.score_status or "not_evaluated"
    body = "\n".join(["Candidate: %s" % cand_digest,
                      "Proof: %s (%s)" % (proof_digest, proof_result),
                      "scoreStatus: %s" % score])
    trailers = {"Bundle-Digest": bundle, "Proof-Digest": proof_digest,
                "Proof-Result": proof_result,
                "Candidate-Digest": cand_digest, "Receipt-Id": receipt,
                "Reviewer": "none"}
    message = build_message("review", job, intent, "review", trailers, body)
    check_trailer_stage_consistency("review", parse_trailers(message))
    text = candidate.decode("utf-8", "ignore")
    # Receipt-Id trailer in the message is the sanctioned carrier; the
    # receipt id must never appear in candidate bytes (source-separation).
    leaks = scan_leaks(message, args.source_id, (), label="review-msg")
    leaks += scan_leaks(text, args.source_id, (receipt,),
                        label="candidate")
    if leaks:
        raise AgitError("leakage",
                        "review blocked: " + "; ".join(leaks[:5]))
    require_clean(repo)
    branch = job_branch(job)
    run_git(repo, ["checkout", branch])
    (repo / "CANDIDATE.md").write_bytes(candidate)
    (repo / "CANDIDATE.sha256").write_text(cand_digest + "\n")
    run_git(repo, ["add", "--", "CANDIDATE.md", "CANDIDATE.sha256"])
    # Trailers carry the Review transition; the tree may be unchanged when
    # candidate bytes repeat a prior job's, so allow an empty commit.
    run_git(repo, ["commit", "--allow-empty", "-m", message])
    sha = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    existing = review_tags(repo, job)
    nums = []
    for tag in existing:
        try:
            nums.append(int(tag.rsplit("-", 1)[1]))
        except ValueError:
            continue
    num = (max(nums) + 1) if nums else 1
    while tag_exists(repo, "agit/%s/review-%d" % (job, num)):
        num += 1
    run_git(repo, ["tag", "agit/%s/review-%d" % (job, num), sha])
    print("review %s (%s) tag agit/%s/review-%d"
          % (job, sha[:12], job, num))
    return 0


def gate_accept(repo, record, reviewer, source_ids):
    """Full gate re-check. Returns context dict or raises named AgitError."""
    job = record["job"]
    if not looks_human_reviewer(reviewer):
        raise AgitError("self-accept",
                        "reviewer %r is not a named human (deny law 3 "
                        "human-authorship)" % (reviewer,))
    tip = review_tip(record)
    if tip is None:
        raise AgitError("bad-stage", "no Review commit for job %r" % job)
    trailers = tip["trailers"]
    bundle_r = trailers.get("Bundle-Digest", "none")
    cand_r = trailers.get("Candidate-Digest", "none")
    if not DIGEST_RE.match(bundle_r or ""):
        raise AgitError("stale-digest",
                        "review Bundle-Digest is not an exact digest")
    if not DIGEST_RE.match(cand_r or ""):
        raise AgitError("exact-revision",
                        "review Candidate-Digest is not an exact digest")
    active = active_commit(record)
    if active is None:
        raise AgitError("not-found", "no Active commit for job %r" % job)
    bundle_a = active["trailers"].get("Bundle-Digest", "none")
    if bundle_r != bundle_a:
        raise AgitError("stale-digest",
                        "review bundle %s != active bundle %s (deny law 5 "
                        "lineage)" % (bundle_r, bundle_a))
    proof_commit, proof = freshest_proof(record)
    if proof is None:
        raise AgitError("missing-proof",
                        "no refs/notes/agit-proof note; refusing merge "
                        "(rule 3: no merge on open law)")
    verdict, detail = evaluate_gate(proof)
    if verdict.startswith("deny:"):
        law = verdict.split(":", 1)[1]
        rule = {"exact-revision": "exact-revision",
                "source-separation": "source-separation",
                "human-authorship": "self-accept",
                "acceptance-shape": "acceptance-shape",
                "lineage": "stale-digest"}.get(law, "open-law")
        raise AgitError(rule, "proof gate denies: %s" % detail)
    if verdict != "allow":
        raise AgitError("open-law",
                        "proof gate is not green: %s (rule 3: no merge on "
                        "open law)" % detail)
    if not proof.get("candidateDigest"):
        raise AgitError("exact-revision",
                        "proof note carries no candidateDigest (deny law 1 "
                        "exact-revision)")
    if proof["candidateDigest"] != cand_r:
        raise AgitError("exact-revision",
                        "proof candidate %s != reviewed candidate %s "
                        "(deny law 1 exact-revision)"
                        % (proof["candidateDigest"], cand_r))
    stored = candidate_bytes_at(repo, job, tip["sha"])
    if stored is None:
        raise AgitError("exact-revision",
                        "no CANDIDATE file on Review tip; cannot verify "
                        "exact revision")
    if digest_of_bytes(stored) != cand_r:
        raise AgitError("exact-revision",
                        "CANDIDATE bytes != reviewed digest (deny law 1)")
    if not check_shape(stored):
        raise AgitError("acceptance-shape",
                        "candidate fails acceptance-shape (deny law 4)")
    receipt = active["trailers"].get("Receipt-Id", "none")
    hygiene = scan_leaks(stored.decode("utf-8", "ignore"), source_ids,
                         (receipt,), label="candidate")
    if hygiene:
        raise AgitError("source-separation",
                        "candidate fails source-separation (deny law 2): "
                        + "; ".join(hygiene[:5]))
    envelope = run_envelope(repo, record)
    worker_bits = [envelope.get("model"), envelope.get("adapter")]
    if not reviewer_distinct(reviewer, worker_bits):
        raise AgitError("self-accept",
                        "reviewer %r is not distinct from the worker %s "
                        "(deny law 3 human-authorship)"
                        % (reviewer, envelope.get("worker", "unknown")))
    return {"tip": tip, "trailers": trailers, "proof": proof,
            "proof_commit": proof_commit, "receipt": receipt,
            "bundle": bundle_r, "candidate": cand_r}


def resolve_into_branch(repo, job, requested):
    branch = job_branch(job)
    if requested:
        if not branch_exists(repo, requested):
            # Allow a raw sha as --into for fixture repos.
            try:
                rev_parse(repo, requested)
                return requested
            except AgitError:
                raise AgitError("bad-branch",
                                "merge target %r does not exist" % requested)
        if requested == branch:
            raise AgitError("bad-branch",
                            "cannot merge a job branch into itself")
        return requested
    for name in ("main", "master"):
        if branch_exists(repo, name):
            return name
    current = run_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]
                      ).stdout.strip()
    if current == branch:
        raise AgitError("bad-branch",
                        "no main/master branch; pass --into <branch>")
    return current


def cmd_accept(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    reviewer = (args.reviewer or "").strip()
    record = current_record(repo, job)
    if record["stage"] == "resolved":
        raise AgitError("history-tampering",
                        "job %r is already resolved; refusing to resolve "
                        "twice" % job)
    if record["stage"] == "cancelled":
        raise AgitError("bad-stage", "job %r is cancelled" % job)
    if record["stage"] != "review":
        raise AgitError("bad-stage",
                        "accept needs Review, job %r is %s"
                        % (job, record["stage"]))
    check_divergence(repo, job, record["stage"])
    # Gate first: any failure below writes nothing.
    ctx = gate_accept(repo, record, reviewer, args.source_id)
    intent = validate_intent(args.intent or args.job)
    subject = ("land %s: %s \u2014 accepted by %s" % (job, intent, reviewer))
    trailers = {"Bundle-Digest": ctx["bundle"],
                "Proof-Digest": ctx["proof"]["proofDigest"],
                "Proof-Result": "pass",
                "Candidate-Digest": ctx["candidate"],
                "Receipt-Id": ctx["receipt"], "Reviewer": reviewer}
    body = ("Proof laws: %s\nMerge candidate verified exact."
            % ", ".join("%s=%s" % (law, ctx["proof"]["laws"].get(law))
                        for law in LAWS))
    message = subject + "\n\n" + "\n".join(
        "%s: %s" % pair for pair in
        [("Job", job), ("Stage", "resolved")] +
        [(k, trailers[k]) for k in
         ("Bundle-Digest", "Proof-Digest", "Proof-Result",
          "Candidate-Digest", "Receipt-Id", "Reviewer")]) + "\n\n" + body + "\n"
    check_trailer_stage_consistency("resolved", parse_trailers(message))
    review_note = "\n".join(["reviewer: %s" % reviewer,
                             "candidate: %s" % ctx["candidate"],
                             "verdict: accept",
                             "at: %s" % utcnow()]) + "\n"
    leaks = scan_leaks(message + review_note + reviewer,
                       args.source_id, (), label="accept")
    if leaks:
        raise AgitError("leakage", "accept blocked: " + "; ".join(leaks[:5]))
    require_clean(repo)
    into = resolve_into_branch(repo, job, args.into)
    # Writes, in order; stop at the first git failure (no further writes).
    write_note(repo, NOTES_REVIEW, ctx["tip"]["sha"], review_note)
    try:
        existing_review = read_note(repo, NOTES_REVIEW, ctx["tip"]["sha"])
        if existing_review and "reviewer: %s" % reviewer not in existing_review:
            raise AgitError("divergence",
                            "a different review note already records this "
                            "candidate; human must reconcile")
    except AgitError as exc:
        if exc.rule == "divergence":
            raise
    run_git(repo, ["checkout", into])
    run_git(repo, ["merge", "--no-ff", job_branch(job), "-m", message])
    merge_sha = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    tagmsg = ("agit %s resolved\n\n%s" % (job, "\n".join(
        "%s: %s" % pair for pair in
        [("Job", job), ("Reviewer", reviewer),
         ("Candidate-Digest", ctx["candidate"]),
         ("Bundle-Digest", ctx["bundle"]),
         ("Proof-Digest", ctx["proof"]["proofDigest"])])))
    run_git(repo, ["tag", "-a", resolved_tag(job), "-m", tagmsg, merge_sha])
    print("resolved %s: %s tag %s" % (job, merge_sha[:12],
                                      resolved_tag(job)))
    print("Buzz reply (human sends): resolved %s as %s (%s)"
          % (job, merge_sha[:12], resolved_tag(job)))
    return 0


def cmd_cancel(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    by = (args.by or "").strip()
    reason = (args.reason or "").strip()
    if not looks_human_reviewer(by):
        raise AgitError("self-accept",
                        "canceller must be a named human, got %r" % (args.by,))
    if not reason:
        raise AgitError("invalid-intent", "cancel needs --reason")
    record = current_record(repo, job)
    if record["stage"] in ("resolved", "cancelled", "tampered"):
        raise AgitError("bad-stage",
                        "job %r is already terminal (%s)"
                        % (job, record["stage"]))
    tip = record["commits"][-1]["sha"]
    closing = "\n".join(["job: %s" % job, "stage: cancelled",
                         "closedState: %s" % record["stage"],
                         "closedCommit: %s" % tip,
                         "canceller: %s" % by, "reason: %s" % reason,
                         "at: %s" % utcnow()]) + "\n"
    leaks = scan_leaks(closing, args.source_id, (), label="cancel")
    if leaks:
        raise AgitError("leakage", "cancel blocked: " + "; ".join(leaks[:5]))
    write_note(repo, NOTES_STATE, tip, closing, append=True)
    tagmsg = "agit %s cancelled\n\ncanceller: %s\nreason: %s\nstate: %s" % (
        job, by, reason, record["stage"])
    run_git(repo, ["tag", "-a", cancelled_tag(job), "-m", tagmsg, tip])
    print("cancelled %s at %s" % (job, tip[:12]))
    return 0


def cmd_log(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    record = current_record(repo, job)
    for commit in record["commits"]:
        sha = commit["sha"][:12]
        stage = commit["trailers"].get("Stage", "?")
        present = [name for name, key in
                   (("state", "state"), ("proof", "proof"),
                    ("review", "review"))
                   if record["notes"][commit["sha"]][key]]
        tags = [t for t in record["review_tags"]
                if rev_parse(repo, t) == commit["sha"]]
        print("%s %s %s notes=[%s] tags=[%s]" % (
            sha, stage, commit["subject"][:80], ",".join(present),
            ",".join(tags)))
    if record["resolved_tag"]:
        print("%s resolved tag=%s" % (record["resolved_sha"][:12],
                                      record["resolved_tag"]))
    if record["cancelled_tag"]:
        print("%s cancelled tag=%s" % (record["cancelled_sha"][:12],
                                       record["cancelled_tag"]))
    return 0


def cmd_state(args):
    repo = find_repo(args.repo)
    job = validate_job_id(args.job)
    record = current_record(repo, job)
    tip = record["commits"][-1] if record["commits"] else None
    proj = sqlite_projection(repo, job)
    info = {
        "job": job,
        "stage": record["stage"],
        "branch": record["branch"],
        "commits": [{"sha": c["sha"], "stage": c["trailers"].get("Stage"),
                     "bundle": c["trailers"].get("Bundle-Digest"),
                     "candidate": c["trailers"].get("Candidate-Digest"),
                     "proof": c["trailers"].get("Proof-Digest"),
                     "result": c["trailers"].get("Proof-Result")}
                    for c in record["commits"]],
        "review_tags": record["review_tags"],
        "resolved_tag": record["resolved_tag"],
        "cancelled_tag": record["cancelled_tag"],
        "sqlite": proj,
        "blockers": record.get("blockers", []),
    }
    _, proof = freshest_proof(record)
    if proof:
        info["proof"] = proof
    if getattr(args, "json", False):
        print(json.dumps(info, indent=2))
        return 0
    print("job:   %s" % job)
    print("stage: %s" % record["stage"])
    print("branch: %s (%d commits)" % (record["branch"],
                                       len(record["commits"])))
    if tip:
        for key in ("Bundle-Digest", "Candidate-Digest", "Proof-Digest",
                    "Proof-Result", "Receipt-Id"):
            print("%s: %s" % (key, tip["trailers"].get(key, "-")))
    if proof:
        print("proof: %s laws=%s" % (
            proof["result"],
            ",".join("%s=%s" % (law, proof["laws"].get(law, "?"))
                     for law in LAWS)))
    if proj:
        print("sqlite: %s=%s (git wins on disagreement)"
              % (proj["db"], proj["state"]))
    else:
        print("sqlite: not found (git is the record)")
    if info["blockers"]:
        print("blocked:")
        for blocker in info["blockers"]:
            print("  - %s" % blocker)
    else:
        print("blocked: none (terminal)")
    return 0

# ---------------------------------------------------------------------------
# CLI wiring.
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        prog="agit", description="git as the state store for agentic jobs")
    parser.add_argument("--repo", default=None,
                        help="repo path (default: autodiscover)")
    parser.add_argument("--version", action="version", version=VERSION)
    subs = parser.add_subparsers(dest="command", required=True)

    common_job = argparse.ArgumentParser(add_help=False)
    common_job.add_argument("--job", required=True, help="job id")

    leak = argparse.ArgumentParser(add_help=False)
    leak.add_argument("--source-id", action="append", default=[],
                      help="supplied sourceId that must not leak "
                           "(repeatable)")

    propose = subs.add_parser("propose", parents=[common_job, leak],
                              help="Proposed commit on agit/job-<id>")
    propose.add_argument("--program", default=None)
    propose.add_argument("--request", default=None)
    propose.add_argument("--intent", default=None)
    propose.add_argument("--bundle-digest", default=None)
    propose.add_argument("--bundle-reason", default=None)
    propose.add_argument("--proof-src", default=None)
    propose.add_argument("--base", default=None)

    ready = subs.add_parser("ready", parents=[common_job, leak],
                            help="readiness note (Proposed -> Ready)")
    ready.add_argument("--base", default=None)
    ready.add_argument("--context", action="append", default=[])
    ready.add_argument("--model", default=None)
    ready.add_argument("--adapter", default=None)

    run = subs.add_parser("run", parents=[common_job, leak],
                          help="Active commit (Ready -> Active)")
    run.add_argument("--bundle-digest", default=None)
    run.add_argument("--receipt-id", default=None)
    run.add_argument("--receipt-json", default=None)
    run.add_argument("--model", default=None)
    run.add_argument("--adapter", default=None)
    run.add_argument("--brief", default=None)
    run.add_argument("--intent", default=None)

    prove = subs.add_parser("prove", parents=[common_job, leak],
                            help="proof note (Active -> Waiting)")
    prove.add_argument("--proof", required=True)

    review = subs.add_parser("review", parents=[common_job, leak],
                             help="Review commit (Waiting -> Review)")
    review.add_argument("--candidate", required=True)
    review.add_argument("--intent", default=None)
    review.add_argument("--score-status", default=None)

    accept = subs.add_parser("accept", parents=[common_job, leak],
                             help="gate re-check + merge + tag")
    accept.add_argument("--reviewer", required=True)
    accept.add_argument("--into", default=None)
    accept.add_argument("--intent", default=None)

    cancel = subs.add_parser("cancel", parents=[common_job, leak],
                             help="cancel a non-terminal job")
    cancel.add_argument("--by", required=True)
    cancel.add_argument("--reason", required=True)

    log = subs.add_parser("log", help="transition history from git")
    log.add_argument("job")
    log.add_argument("--repo", default=argparse.SUPPRESS)

    state = subs.add_parser("state", help="current stage from git")
    state.add_argument("job")
    state.add_argument("--repo", default=argparse.SUPPRESS)
    state.add_argument("--json", action="store_true")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    # log/state take job positionally and their own --repo.
    if args.command in ("log", "state") and not getattr(args, "job", None):
        parser.error("job id required")
    try:
        if args.command == "propose":
            return cmd_propose(args)
        if args.command == "ready":
            return cmd_ready(args)
        if args.command == "run":
            return cmd_run(args)
        if args.command == "prove":
            return cmd_prove(args)
        if args.command == "review":
            return cmd_review(args)
        if args.command == "accept":
            return cmd_accept(args)
        if args.command == "cancel":
            return cmd_cancel(args)
        if args.command == "log":
            return cmd_log(args)
        if args.command == "state":
            return cmd_state(args)
    except AgitError as exc:
        print("agit: %s: %s" % (exc.rule, exc.message), file=sys.stderr)
        return 1
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
