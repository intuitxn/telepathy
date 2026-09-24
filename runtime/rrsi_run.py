#!/usr/bin/env python3
"""Measure one RRSI harness candidate with isolated meta nodes and fixed verifiers.

The supplied suite and critic are trusted inputs. This runner records evidence
and applies the admission gate; it never integrates, publishes or deploys code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

from rrsi import COMPONENTS, assess, edit_budget

COMMIT = re.compile(r"[0-9a-f]{40,64}\Z")


def digest_tree(root: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"suite must not contain symlinks: {path}")
        if path.is_file():
            h.update(str(path.relative_to(root)).encode() + b"\0")
            h.update(path.read_bytes())
    return h.hexdigest()


def command(*argv, cwd=None, timeout=120):
    result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{argv[0]} failed: {(result.stderr or result.stdout)[-2000:]}")
    return result.stdout


def api(state: Path, port: int, method: str, params=None, timeout=10):
    token = (state / "token").read_text().strip()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api",
        json.dumps({"method": method, "params": params or {}}).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def load_suite(path: Path):
    root = path.parent.resolve()
    suite = json.loads(path.read_text())
    if not isinstance(suite, dict) or not isinstance(suite.get("cases"), list) or not suite["cases"]:
        raise ValueError("suite requires a nonempty cases array")
    ids = set()
    for case in suite["cases"]:
        if not isinstance(case, dict) or not isinstance(case.get("id"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", case["id"]):
            raise ValueError("each case needs a simple ID")
        if case["id"] in ids:
            raise ValueError("duplicate suite case ID")
        ids.add(case["id"])
        if not all(isinstance(case.get(key), str) and case[key].strip() for key in ("task", "acceptance", "fixture")):
            raise ValueError("each case needs task, acceptance and fixture")
        fixture = (root / case["fixture"]).resolve()
        if not fixture.is_relative_to(root) or not fixture.is_dir():
            raise ValueError("fixture must be a directory inside the pinned suite")
        verify = case.get("verify")
        if not isinstance(verify, list) or not verify or any(not isinstance(x, str) or not x for x in verify):
            raise ValueError("verify must be an argv array")
        if "{project}" not in " ".join(verify):
            raise ValueError("verify must reference {project} explicitly")
        if not isinstance(case.get("verify_timeout", 120), int) or case.get("verify_timeout", 120) < 1:
            raise ValueError("verify_timeout must be a positive integer")
    return suite, root, digest_tree(root)


def checkout(repo: Path, revision: str, target: Path):
    if not COMMIT.fullmatch(revision):
        raise ValueError("revision must be a full jj/Git commit ID")
    name = "rrsi-" + uuid.uuid4().hex[:12]
    command("jj", "--no-pager", "workspace", "add", "--name", name,
            "-r", revision, str(target), cwd=repo)
    # jj creates a new empty working change above the requested immutable base.
    actual = command("jj", "--no-pager", "log", "-r", "@-", "--no-graph", "-T", "commit_id", cwd=target).strip()
    empty = command("jj", "--no-pager", "log", "-r", "@", "--no-graph", "-T", "empty", cwd=target).strip()
    if actual != revision or empty != "true":
        subprocess.run(["jj", "--no-pager", "--ignore-working-copy", "workspace", "forget", name],
                       cwd=repo, capture_output=True)
        raise RuntimeError("jj workspace is not an empty child of the requested commit")
    return name


class NodeProcess:
    def __init__(self, root: Path, state: Path, args):
        self.root, self.state, self.args = root, state, args
        self.port = free_port()
        self.process = None

    def __enter__(self):
        self.state.mkdir(mode=0o700, parents=True)
        script = self.root / "runtime/meta_shell.py"
        kernel = self.root / "runtime/worker/system.bend"
        if not script.is_file() or not kernel.is_file():
            raise ValueError("revision lacks the meta shell and Bend kernel")
        log = (self.state / "node.log").open("w")
        self.process = subprocess.Popen(
            [self.args.python, str(script), "--state", str(self.state),
             "--source", str(kernel), "--port", str(self.port),
             "--bend", self.args.bend, "--acp-agent", self.args.acp_agent,
             "--model", self.args.model, "serve"],
            cwd=self.root, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True, env={k: v for k, v in os.environ.items() if not k.startswith("BUZZ_")},
        )
        log.close()
        try:
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError(f"candidate node exited; inspect {self.state / 'node.log'}")
                try:
                    status = api(self.state, self.port, "status")
                    if status["ready"] and Path(status["state"]) == self.state:
                        return self
                except (OSError, urllib.error.URLError, json.JSONDecodeError):
                    pass
                time.sleep(0.25)
            raise TimeoutError(f"candidate node did not become ready; inspect {self.state / 'node.log'}")
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self, *_):
        if self.process:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()

    def run(self, case, project: Path, request_id: str):
        job = api(self.state, self.port, "submit", {
            "task": case["task"], "acceptance": case["acceptance"],
            "project": str(project), "conversation": request_id,
            "request_id": request_id,
        })
        deadline = time.monotonic() + self.args.task_timeout
        while time.monotonic() < deadline:
            job = api(self.state, self.port, "task", {"id": job["id"]})
            if job["status"] not in {"queued", "running"}:
                return job
            time.sleep(1)
        raise TimeoutError(f"task {job['id']} exceeded {self.args.task_timeout}s; evidence retained in {self.state}")


def token_usage(node: NodeProcess, job):
    if job.get("usage_tokens") is not None:
        return job["usage_tokens"]
    events = node.state / "tasks" / job["id"] / "events.jsonl"
    if events.is_file():
        for row in reversed(events.read_text().splitlines()):
            event = json.loads(row)
            if event.get("kind") == "completed":
                return (event.get("response", {}).get("usage") or {}).get("totalTokens")
    return None


def one_trial(node, case, suite_root: Path, side: str, repeat: int, out: Path):
    project = out / "fixtures" / side / case["id"] / str(repeat)
    project.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(suite_root / case["fixture"], project, symlinks=False)
    job = node.run(case, project, f"rrsi:{side}:{case['id']}:{repeat}:{uuid.uuid4().hex}")
    tokens = token_usage(node, job)
    if tokens is None and side == "candidate" and job["status"] != "reported":
        tokens = 0  # Failed candidate is a zero-reward trial; the domain guard blocks adoption.
    if tokens is None or not isinstance(tokens, int) or tokens < 0:
        raise RuntimeError(f"task {job['id']} lacks measured ACP token usage")
    verify_args = [part.replace("{project}", str(project)) for part in case["verify"]]
    result = subprocess.run(verify_args, cwd=suite_root, capture_output=True, text=True,
                            timeout=case.get("verify_timeout", 120))
    record = {"task": case["id"], "reward": int(job["status"] == "reported" and result.returncode == 0),
              "tokens": tokens, "job_id": job["id"], "status": job["status"],
              "verify_returncode": result.returncode,
              "verify_stdout": result.stdout[-4000:], "verify_stderr": result.stderr[-4000:]}
    evidence = out / "trials" / side / case["id"]
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / f"{repeat}.json").write_text(json.dumps(record, indent=2))
    return {key: record[key] for key in ("task", "reward", "tokens")}


def run(args):
    repo = args.repo.resolve()
    out = args.out.resolve()
    if out.exists():
        raise ValueError("output directory already exists; choose a new run ID")
    if out.is_relative_to(repo):
        raise ValueError("run output must be outside the evaluated repository")
    suite, suite_root, suite_digest = load_suite(args.suite.resolve())
    if out.is_relative_to(suite_root):
        raise ValueError("run output must be outside the fixed suite")
    if not 2 <= args.repeats <= 20:
        raise ValueError("repeats must be 2..20 for an empirical noise estimate")
    if args.task_timeout < 1:
        raise ValueError("task_timeout must be positive")
    for revision in (args.incumbent, args.candidate):
        if not COMMIT.fullmatch(revision):
            raise ValueError("use full incumbent and candidate commit IDs")
    if args.incumbent == args.candidate:
        raise ValueError("candidate and incumbent must differ")
    patch = command("jj", "--no-pager", "--color=never", "--ignore-working-copy", "diff", "--from",
                    args.incumbent, "--to", args.candidate, "--git", cwd=repo)
    patch_hash = hashlib.sha256(patch.encode()).hexdigest()
    critic = json.loads(args.critic.read_text())
    if (not isinstance(critic, dict) or critic.get("revision") != args.candidate or critic.get("diff_sha256") != patch_hash
            or critic.get("passed") is not True or not critic.get("evidence")):
        raise ValueError("pre-score critic must approve the exact candidate diff")
    edits = json.loads(args.edits.read_text())
    if not isinstance(edits, list) or not edits:
        raise ValueError("edits must list independent hypotheses and components")
    for edit in edits:
        if (not isinstance(edit, dict) or edit.get("component") not in COMPONENTS
                or not isinstance(edit.get("hypothesis"), str) or not edit["hypothesis"].strip()):
            raise ValueError("each edit needs a known component and nonempty hypothesis")
    if len(edits) > edit_budget(args.round, args.rounds, args.min_edits, args.max_edits):
        raise ValueError("candidate exceeds the annealed edit budget before evaluation")
    history = json.loads(args.history.read_text()) if args.history else []
    if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
        raise ValueError("history must be an array of edit records")
    for row in history:
        if row.get("accepted") and "selected_score" not in row:
            raise ValueError("accepted history entries require selected_score")
    out.mkdir(mode=0o700, parents=True)
    (out / "candidate.diff").write_text(patch)
    (out / "manifest.json").write_text(json.dumps({"incumbent": args.incumbent,
        "candidate": args.candidate, "suite_sha256": suite_digest, "diff_sha256": patch_hash,
        "model": args.model, "agent": args.acp_agent, "repeats": args.repeats}, indent=2))
    roots, workspaces = {}, []
    trials = {"incumbent": [], "candidate": []}
    try:
        for side, revision in (("incumbent", args.incumbent), ("candidate", args.candidate)):
            target = out / "checkouts" / side
            target.parent.mkdir(parents=True, exist_ok=True)
            workspaces.append(checkout(repo, revision, target))
            roots[side] = target
        with NodeProcess(roots["incumbent"], out / "nodes" / "incumbent", args) as incumbent, \
             NodeProcess(roots["candidate"], out / "nodes" / "candidate", args) as candidate:
            for repeat in range(args.repeats):
                for case in suite["cases"]:
                    for side, node in (("incumbent", incumbent), ("candidate", candidate)):
                        trials[side].append(one_trial(node, case, suite_root, side, repeat, out))
                        if digest_tree(suite_root) != suite_digest:
                            raise RuntimeError("fixed suite changed during evaluation")
    finally:
        # Retain files and evidence while avoiding stale workspace registrations.
        for name in workspaces:
            subprocess.run(["jj", "--no-pager", "--ignore-working-copy", "workspace", "forget", name],
                           cwd=repo, capture_output=True)
    scores = []
    for repeat in range(args.repeats):
        scores.append(sum(json.loads((out / "trials" / "incumbent" / case["id"] / f"{repeat}.json").read_text())["reward"]
                          for case in suite["cases"]) / len(suite["cases"]))
    noise = max(scores) - min(scores)
    baseline = sum(row["reward"] for row in trials["incumbent"]) / len(trials["incumbent"])
    best = max([baseline] + [float(row["selected_score"]) for row in history if row.get("accepted")])
    candidate_statuses = [json.loads(path.read_text())["status"]
                          for path in (out / "trials" / "candidate").rglob("*.json")]
    record = {"suite": [case["id"] for case in suite["cases"]], "repeats": args.repeats,
              "revision": args.candidate, "incumbent_revision": args.incumbent,
              "incumbent_trials": trials["incumbent"], "candidate_trials": trials["candidate"],
              "noise": noise, "best_score": best, "round": args.round, "rounds": args.rounds,
              "min_edits": args.min_edits, "max_edits": args.max_edits, "edits": edits,
              "critic": critic, "guards_passed": all(x == "reported" for x in candidate_statuses),
              "beta0": args.beta0, "beta1": args.beta1,
              "within_band": {"score": 0, "cost": 1, "novelty": 0}, "history": history}
    (out / "evidence.json").write_text(json.dumps(record, indent=2))
    decision = assess(record)
    decision.update(suite_sha256=suite_digest, diff_sha256=patch_hash,
                    model=args.model, noise_method="range of unchanged-incumbent repeat scores")
    (out / "decision.json").write_text(json.dumps(decision, indent=2))
    history_next = history + [{"round": args.round, "revision": args.candidate,
        "component": edit["component"], "hypothesis": edit["hypothesis"],
        "diff_sha256": patch_hash, "score_change": decision["score_change"],
        "relative_token_change": decision["relative_token_change"],
        "selected_score": decision["candidate"]["score"],
        "accepted": decision["admissible"]} for edit in edits]
    (out / "history-next.json").write_text(json.dumps(history_next, indent=2))
    recent = history_next[-6:]
    components = {row["component"] for row in recent if row.get("component")}
    prune = sorted(component for component in components
                   if sum(row.get("component") == component for row in recent) >= 2
                   and not any(row.get("component") == component and row.get("accepted")
                               and row.get("score_change", 0) > 0 for row in recent))
    context = {"next_round": args.round + 1,
               "next_edit_budget": edit_budget(min(args.round + 1, args.rounds - 1),
                                                args.rounds, args.min_edits, args.max_edits),
               "tested_hypotheses": [{"component": row.get("component"),
                                      "hypothesis": row.get("hypothesis"),
                                      "accepted": row.get("accepted")}
                                     for row in history_next],
               "pruning_candidates": prune}
    (out / "proposal-context.json").write_text(json.dumps(context, indent=2))
    if args.heldout_suite and decision["admissible"]:
        heldout, heldout_root, heldout_digest = load_suite(args.heldout_suite.resolve())
        if heldout_root == suite_root or out.is_relative_to(heldout_root):
            raise ValueError("held-out suite must be separate from evolve suite and run output")
        transfer = {"incumbent": [], "candidate": []}
        transfer_out = out / "heldout"
        with NodeProcess(roots["incumbent"], transfer_out / "nodes" / "incumbent", args) as incumbent, \
             NodeProcess(roots["candidate"], transfer_out / "nodes" / "candidate", args) as candidate:
            for repeat in range(args.repeats):
                for case in heldout["cases"]:
                    for side, node in (("incumbent", incumbent), ("candidate", candidate)):
                        transfer[side].append(one_trial(node, case, heldout_root, side, repeat, transfer_out))
                        if digest_tree(heldout_root) != heldout_digest:
                            raise RuntimeError("held-out suite changed during evaluation")
        report = {"suite_sha256": heldout_digest, "incumbent_score":
                  sum(row["reward"] for row in transfer["incumbent"]) / len(transfer["incumbent"]),
                  "candidate_score":
                  sum(row["reward"] for row in transfer["candidate"]) / len(transfer["candidate"])}
        (transfer_out / "report.json").write_text(json.dumps(report, indent=2))
    return decision


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--incumbent", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--suite", type=Path, required=True)
    parser.add_argument("--heldout-suite", type=Path)
    parser.add_argument("--critic", type=Path, required=True)
    parser.add_argument("--edits", type=Path, required=True)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--bend", default=shutil.which("bend") or str(Path.home() / ".bend/bin/bend"))
    parser.add_argument("--acp-agent", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--task-timeout", type=int, default=1800)
    parser.add_argument("--round", type=int, default=0)
    parser.add_argument("--rounds", type=int, default=8)
    parser.add_argument("--min-edits", type=int, default=1)
    parser.add_argument("--max-edits", type=int, default=3)
    parser.add_argument("--beta0", type=float, default=0)
    parser.add_argument("--beta1", type=float, default=1)
    args = parser.parse_args()
    try:
        decision = run(args)
    except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.TimeoutExpired) as exc:
        parser.error(str(exc))
    print(json.dumps({"admissible": decision["admissible"], "reason": decision["reason"],
                      "score_change": decision["score_change"], "relative_token_change": decision["relative_token_change"],
                      "evidence": str(args.out.resolve() / "decision.json")}, indent=2))
    raise SystemExit(0 if decision["admissible"] else 1)


if __name__ == "__main__":
    main()
