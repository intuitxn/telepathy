#!/usr/bin/env python3
"""Run bounded, evidence-carrying harness improvement rounds through meta.

The resident node proposes and independently critiques each change. Temporary
nodes perform measurement. Selection advances only this private loop's pinned
incumbent; this command never integrates, publishes, or deploys a revision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

from rrsi import COMPONENTS, number
from rrsi_run import api, checkout, command, load_suite, run as evaluate
from agent_programs.language import compile_file


def save(path: Path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def wait_job(state: Path, port: int, job_id: str, timeout: int):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = api(state, port, "task", {"id": job_id})
        if job["status"] not in {"queued", "running"}:
            return job
        time.sleep(1)
    raise TimeoutError(f"meta task {job_id} timed out; inspect retained node evidence")


def require_proposal(result: str):
    lines = [line.removeprefix("RRSI_PROPOSAL_JSON:").strip()
             for line in result.splitlines() if line.startswith("RRSI_PROPOSAL_JSON:")]
    if len(lines) != 1:
        raise ValueError("proposal result needs exactly one RRSI_PROPOSAL_JSON line")
    value = json.loads(lines[0])
    if (not isinstance(value, dict) or value.get("component") not in COMPONENTS
            or not isinstance(value.get("hypothesis"), str)
            or not value["hypothesis"].strip()):
        raise ValueError("proposal response needs one known component and nonempty hypothesis")
    return {"component": value["component"], "hypothesis": value["hypothesis"].strip()}


def require_critic(path: Path, revision: str, digest: str):
    value = json.loads(path.read_text())
    if (not isinstance(value, dict) or value.get("revision") != revision
            or value.get("diff_sha256") != digest or not isinstance(value.get("passed"), bool)
            or not isinstance(value.get("evidence"), str) or not value["evidence"].strip()):
        raise ValueError("critic.json must review the exact pinned diff with concrete evidence")
    return value


def changed_paths(repo: Path, incumbent: str, candidate: str):
    output = command("jj", "--no-pager", "--color=never", "--ignore-working-copy", "diff",
                     "--from", incumbent, "--to", candidate, "--name-only", cwd=repo)
    return [line for line in output.splitlines() if line]


def proposal_prompt(plan, context, allowed):
    return (
        plan["steps"][0]["prompt"] + " "
        f"Edit only these paths: {', '.join(allowed)}. "
        "The previous-round evidence below contains only hypothesis summaries, never benchmark tasks. "
        "End your final report with one line RRSI_PROPOSAL_JSON: followed by a JSON object "
        "with exactly component and hypothesis; "
        "component must be one of " + ", ".join(sorted(COMPONENTS)) + ". "
        "The hypothesis must state what behavior should improve and why. "
        "Do not add a metadata file to the candidate revision.\n\nPrevious evidence:\n"
        + json.dumps(context, indent=2)
    )


def critique_prompt(plan, patch_path: Path, proposal: dict, critic_path: Path, revision: str, digest: str, allowed):
    return (
        plan["steps"][1]["prompt"] + " "
        f"Diff: {patch_path}. Allowed paths: {', '.join(allowed)}. "
        f"Hypothesis: {proposal['hypothesis']}. "
        f"Write JSON to {critic_path} with revision={revision!r}, diff_sha256={digest!r}, "
        "passed (boolean), and evidence (specific explanation). "
        "Do not inspect private suites or scores."
    )


def node_task(args, task: str, project: Path, acceptance: str, round_id: str):
    request_id = f"rrsi:{args.run_id}:{round_id}"
    job = api(args.state, args.port, "submit", {"task": task, "acceptance": acceptance,
        "project": str(project), "conversation": request_id, "request_id": request_id})
    return wait_job(args.state, args.port, job["id"], args.task_timeout)


def propose(args, incumbent: str, round_dir: Path, context):
    base_dir = round_dir / "proposal-base"
    name = checkout(args.repo, incumbent, base_dir)
    try:
        job = node_task(args, proposal_prompt(args.plan, context, args.allow_path), base_dir,
            "Produce one scoped, checked harness edit. End the report with the required RRSI_PROPOSAL_JSON line.",
            round_dir.name + ":proposal")
        save(round_dir / "proposal-task.json", job)
        if job["status"] != "reported":
            raise RuntimeError(f"proposal task {job['id']} ended {job['status']}")
        workspace = api(args.state, args.port, "workspace", {"id": job["id"]})
        save(round_dir / "proposal-workspace.json", workspace)
        if workspace["base_commit"] != incumbent:
            raise RuntimeError("proposal was not based on the selected incumbent")
        candidate = workspace["result_commit"]
        if not candidate or candidate == incumbent:
            raise RuntimeError("proposal produced no candidate revision")
        paths = changed_paths(args.repo, incumbent, candidate)
        if not paths or any(path not in args.allow_path for path in paths):
            raise RuntimeError(f"candidate changed paths outside allowlist: {paths}")
        proposal = require_proposal(job.get("result") or "")
        save(round_dir / "proposal.json", proposal)
        patch = command("jj", "--no-pager", "--color=never", "--ignore-working-copy", "diff",
                        "--from", incumbent, "--to", candidate, "--git", cwd=args.repo)
        patch_path = round_dir / "candidate.diff"
        patch_path.write_text(patch)
        digest = hashlib.sha256(patch.encode()).hexdigest()
        save(round_dir / "edits.json", [proposal])
        save(round_dir / "candidate.json", {"incumbent": incumbent, "candidate": candidate,
             "diff_sha256": digest, "paths": paths, "proposal_job": job["id"]})
        retired = api(args.state, args.port, "retire", {"id": job["id"]})
        save(round_dir / "proposal-retirement.json", retired)
        return candidate, proposal, patch_path, digest
    finally:
        subprocess.run(["jj", "--no-pager", "--ignore-working-copy", "workspace", "forget", name],
                       cwd=args.repo, capture_output=True)


def critique(args, round_dir: Path, candidate: str, proposal: dict, patch_path: Path, digest: str):
    critic_dir = round_dir / "critic"
    critic_dir.mkdir()
    local_patch = critic_dir / "candidate.diff"
    shutil.copyfile(patch_path, local_patch)
    critic_path = critic_dir / "critic.json"
    job = node_task(args, critique_prompt(args.plan, local_patch, proposal, critic_path, candidate,
                    digest, args.allow_path), critic_dir,
                    "Write an evidence-backed pre-score verdict bound to the exact candidate diff.",
                    round_dir.name + ":critic")
    save(round_dir / "critic-task.json", job)
    if job["status"] != "reported":
        raise RuntimeError(f"critic task {job['id']} ended {job['status']}")
    return require_critic(critic_path, candidate, digest), critic_path


def round_args(args, incumbent, candidate, round_index, round_dir, critic_path, history_path):
    return argparse.Namespace(repo=args.repo, incumbent=incumbent, candidate=candidate,
        suite=args.suite, heldout_suite=args.heldout_suite, critic=critic_path,
        edits=round_dir / "edits.json", history=history_path,
        out=round_dir / "evaluation", python=args.python, bend=args.bend,
        acp_agent=args.acp_agent, model=args.model, repeats=args.repeats,
        task_timeout=args.task_timeout, round=round_index, rounds=args.rounds,
        min_edits=1, max_edits=args.max_edits, beta0=0,
        beta1=args.plan["policy"]["gain_cost_ratio"],
        within_band_cost_weight=args.plan["policy"]["within_band_cost_weight"])


def bend_source(args) -> Path:
    return Path(getattr(args, "source", args.repo / "runtime/worker/system.bend")).resolve()


def heldout_nonregression(report) -> bool:
    if not isinstance(report, dict):
        return False
    baseline_score = number(report.get("incumbent_score"), "heldout incumbent score", minimum=0, maximum=1)
    candidate_score = number(report.get("candidate_score"), "heldout candidate score", minimum=0, maximum=1)
    baseline_tokens = number(report.get("incumbent_tokens"), "heldout incumbent tokens", minimum=0)
    candidate_tokens = number(report.get("candidate_tokens"), "heldout candidate tokens", minimum=0)
    return candidate_score >= baseline_score and candidate_tokens <= baseline_tokens


def bend_select(args, *, scoped: bool, critic: bool, measured: bool,
                admitted: bool, heldout: bool) -> bool:
    source = bend_source(args)
    if hashlib.sha256(source.read_bytes()).hexdigest() != args.bend_digest:
        raise RuntimeError("Bend kernel changed during the pinned improvement run")
    flags = ["1" if value else "0" for value in (scoped, critic, measured, admitted, heldout)]
    result = subprocess.run([args.bend, str(source), "--", "rrsi-select", *flags],
                            capture_output=True, text=True, timeout=120,
                            env={**os.environ, "BEND_NO_TELEMETRY": "1"})
    if result.returncode:
        raise RuntimeError("Bend RRSI selection failed: " + (result.stderr or result.stdout)[-1000:])
    value = json.loads(result.stdout.strip())
    if not isinstance(value, dict) or not isinstance(value.get("selected"), bool):
        raise RuntimeError("Bend RRSI selection returned malformed output")
    return value["selected"]


def run_loop(args):
    args.repo, args.out, args.state = args.repo.resolve(), args.out.resolve(), args.state.resolve()
    args.plan = compile_file(args.program).plan
    policy = args.plan["policy"]
    if not policy or policy["kind"] != "rrsi":
        raise ValueError("program must declare policy rrsi")
    args.allow_path = policy["allow_paths"]
    args.max_edits = policy["max_edits"]
    if args.out.exists() or args.out.is_relative_to(args.repo):
        raise ValueError("choose a new private output directory outside the repository")
    if not re.fullmatch(r"[0-9a-f]{40,64}", args.incumbent):
        raise ValueError("incumbent must be a full pinned commit ID")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", args.run_id):
        raise ValueError("run-id must be 1..64 letters, digits, underscores or hyphens")
    if not 1 <= args.rounds <= 20 or args.max_edits < 1:
        raise ValueError("rounds must be 1..20 and max-edits positive")
    if not args.allow_path or len(set(args.allow_path)) != len(args.allow_path):
        raise ValueError("supply unique allowed paths")
    for path in args.allow_path:
        if Path(path).is_absolute() or ".." in Path(path).parts or not (args.repo / path).is_file():
            raise ValueError(f"allowed path must be an existing repository file: {path}")
    _, suite_root, _ = load_suite(args.suite.resolve())
    if suite_root.is_relative_to(args.repo) or args.out.is_relative_to(suite_root):
        raise ValueError("evolve suite must be private, outside the evaluated repository and output")
    _, heldout_root, _ = load_suite(args.heldout_suite.resolve())
    if heldout_root.is_relative_to(args.repo) or heldout_root == suite_root or args.out.is_relative_to(heldout_root):
        raise ValueError("held-out suite must be a separate private directory outside the repository")
    source = bend_source(args)
    args.bend_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    check = subprocess.run([args.bend, str(source), "--check-only"],
                           capture_output=True, text=True, timeout=120,
                           env={**os.environ, "BEND_NO_TELEMETRY": "1"})
    if check.returncode or "All terms check." not in check.stdout:
        raise RuntimeError("Bend kernel must pass its checker before the loop starts")
    status = api(args.state, args.port, "status")
    if not status.get("ready") or Path(status["state"]).resolve() != args.state:
        raise RuntimeError("resident meta node is not ready at the selected state and port")
    if hasattr(args, "source") and status.get("source_sha256") != args.bend_digest:
        raise RuntimeError("resident node and improve command must use the same pinned Bend kernel")
    args.out.mkdir(mode=0o700, parents=True)
    incumbent, history_path = args.incumbent, None
    context = {"tested_hypotheses": [], "pruning_candidates": []}
    summary = {"run_id": args.run_id, "program_digest": args.plan["plan_digest"],
               "bend_sha256": args.bend_digest,
               "initial_incumbent": incumbent, "selected_incumbent": incumbent,
               "rounds": [], "promotion": "not performed"}
    save(args.out / "summary.json", summary)
    for index in range(args.rounds):
        round_dir = args.out / f"round-{index:02d}"
        round_dir.mkdir(mode=0o700)
        row = {"round": index, "incumbent": incumbent, "status": "proposing"}
        summary["rounds"].append(row)
        save(args.out / "summary.json", summary)
        try:
            candidate, proposal, patch_path, digest = propose(args, incumbent, round_dir, context)
            row.update(candidate=candidate, proposal=proposal, status="critiquing")
            save(args.out / "summary.json", summary)
            verdict, critic_path = critique(args, round_dir, candidate, proposal, patch_path, digest)
            if not verdict["passed"]:
                row.update(status="rejected", reason="pre-score critic rejected candidate")
                context["tested_hypotheses"].append({**proposal, "accepted": False,
                                                       "reason": row["reason"]})
                history = json.loads(history_path.read_text()) if history_path else []
                history.append({"round": index, "revision": candidate,
                    "component": proposal["component"], "hypothesis": proposal["hypothesis"],
                    "diff_sha256": digest, "accepted": False, "reason": row["reason"]})
                history_path = args.out / "history.json"
                save(history_path, history)
                save(args.out / "summary.json", summary)
                continue
            row["status"] = "measuring"
            save(args.out / "summary.json", summary)
            decision = evaluate(round_args(args, incumbent, candidate, index, round_dir,
                                           critic_path, history_path))
            report_path = round_dir / "evaluation" / "heldout" / "report.json"
            transfer = json.loads(report_path.read_text()) if report_path.is_file() else None
            heldout_passed = heldout_nonregression(transfer)
            save(round_dir / "feedback.json", {"schema": "intuitxn.feedback/v0",
                "program_digest": args.plan["plan_digest"], "incumbent": incumbent,
                "candidate": candidate, "diff_sha256": digest,
                "evolve_suite_sha256": decision["suite_sha256"],
                "heldout_suite_sha256": transfer["suite_sha256"] if transfer else None,
                "model": args.model, "component": proposal["component"],
                "hypothesis": proposal["hypothesis"], "score_change": decision["score_change"],
                "relative_token_change": decision["relative_token_change"],
                "heldout": transfer, "uncertainty":
                "One-edit attribution on a finite suite; not model-weight gradients"})
            selected = bend_select(args, scoped=True, critic=verdict["passed"], measured=True,
                                   admitted=decision["admissible"], heldout=heldout_passed)
            if selected != (decision["admissible"] and heldout_passed):
                raise RuntimeError("Bend selection disagrees with measured evidence flags")
            row.update(status="selected" if selected else "rejected",
                       reason=decision["reason"] if selected or not decision["admissible"]
                              else "held-out score or token cost regressed",
                       score_change=decision["score_change"],
                       relative_token_change=decision["relative_token_change"],
                       heldout=transfer)
            save(round_dir / "selection.json", {"selected": selected,
                "reason": row["reason"], "bend_sha256": args.bend_digest,
                "critic_passed": verdict["passed"], "admitted": decision["admissible"],
                "heldout_nonregression": heldout_passed})
            # Carry all tested hypotheses forward, but only selected winners affect the
            # next best-score floor and structural-novelty accounting.
            history = json.loads((round_dir / "evaluation" / "history-next.json").read_text())
            for item in history[-1:]:
                item["accepted"] = selected
                item["reason"] = row["reason"]
            history_path = args.out / "history.json"
            save(history_path, history)
            context = json.loads((round_dir / "evaluation" / "proposal-context.json").read_text())
            context["tested_hypotheses"][-1]["accepted"] = selected
            if selected:
                incumbent = candidate
                summary["selected_incumbent"] = incumbent
            save(args.out / "summary.json", summary)
        except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.TimeoutExpired) as exc:
            row.update(status="failed", reason=str(exc))
            save(args.out / "summary.json", summary)
            raise
    return summary


def add_arguments(parser: argparse.ArgumentParser, *, inherited_node_options=False):
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--incumbent", required=True)
    parser.add_argument("--suite", type=Path, required=True)
    parser.add_argument("--heldout-suite", type=Path, required=True)
    parser.add_argument("--program", type=Path, default=Path(__file__).parent / "agent_programs/rrsi.meta")
    parser.add_argument("--out", type=Path, required=True)
    if not inherited_node_options:
        parser.add_argument("--state", type=Path, default=Path.home() / ".local/state/intuitxn-meta")
        parser.add_argument("--port", type=int, default=47831)
    parser.add_argument("--run-id", default=uuid.uuid4().hex[:12])
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--task-timeout", type=int, default=1800)
    parser.add_argument("--python", default=sys.executable)
    if not inherited_node_options:
        parser.add_argument("--bend", default=shutil.which("bend") or str(Path.home() / ".bend/bin/bend"))
        parser.add_argument("--acp-agent", required=True)
        parser.add_argument("--model", required=True)


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    add_arguments(parser)
    args = parser.parse_args(argv)
    try:
        result = run_loop(args)
    except (OSError, ValueError, RuntimeError, TimeoutError, subprocess.TimeoutExpired) as exc:
        parser.error(str(exc))
    print(json.dumps({"selected_incumbent": result["selected_incumbent"],
                      "rounds": result["rounds"], "evidence": str(args.out / "summary.json")}, indent=2))


if __name__ == "__main__":
    main()
