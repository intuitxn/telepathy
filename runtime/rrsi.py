#!/usr/bin/env python3
"""Small, deterministic RRSI proposal and selection gate for meta revisions.

This is an offline companion to the resident node, not another service. Candidate
generation, independent leakage review, and benchmark execution supply evidence;
this module validates and applies the regularized rules to that evidence.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

STRUCTURAL = {"client_tool", "skill", "memory", "subagent"}
COMPONENTS = STRUCTURAL | {"prompt", "control_flow", "configuration", "context", "output"}


def number(value, name, *, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ValueError(f"{name} is outside its allowed range")
    return float(value)


def edit_budget(round_index, rounds, minimum, maximum):
    if isinstance(round_index, bool) or isinstance(rounds, bool) or not isinstance(round_index, int) or not isinstance(rounds, int) or rounds < 1 or not 0 <= round_index < rounds:
        raise ValueError("round must be in [0, rounds)")
    if isinstance(minimum, bool) or isinstance(maximum, bool) or not isinstance(minimum, int) or not isinstance(maximum, int) or not 1 <= minimum <= maximum:
        raise ValueError("edit limits must be positive integers in increasing order")
    return math.ceil(minimum + (maximum - minimum) * (1 + math.cos(math.pi * round_index / rounds)) / 2)


def trials(rows, name):
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{name} requires measured trials")
    by_task = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("task"), str) or not row["task"]:
            raise ValueError(f"{name} has a trial without a task ID")
        reward = number(row.get("reward"), "reward", minimum=0, maximum=1)
        tokens = number(row.get("tokens"), "tokens", minimum=0)
        by_task.setdefault(row["task"], []).append((reward, tokens))
    return by_task


def metrics(rows, suite, repeats, name):
    grouped = trials(rows, name)
    if set(grouped) != set(suite) or any(len(grouped[task]) != repeats for task in suite):
        raise ValueError(f"{name} must contain exactly {repeats} trials for every evolve task")
    flat = [trial for task in suite for trial in grouped[task]]
    return {"score": sum(r for r, _ in flat) / len(flat),
            "tokens": sum(c for _, c in flat) / len(flat)}


def assess(record):
    """Return an auditable admission verdict; never mutate or promote a revision."""
    suite = record.get("suite")
    if not isinstance(suite, list) or not suite or any(not isinstance(x, str) or not x for x in suite) or len(set(suite)) != len(suite):
        raise ValueError("suite must contain unique, nonempty evolve task IDs")
    repeats = record.get("repeats")
    if not isinstance(repeats, int) or isinstance(repeats, bool) or repeats < 1:
        raise ValueError("repeats must be a positive integer")
    incumbent = metrics(record.get("incumbent_trials"), suite, repeats, "incumbent")
    candidate = metrics(record.get("candidate_trials"), suite, repeats, "candidate")
    if incumbent["tokens"] <= 0:
        raise ValueError("incumbent token cost must be positive")
    noise = number(record.get("noise"), "noise", minimum=0, maximum=1)
    cost_noise = number(record.get("cost_noise", 0), "cost_noise", minimum=0)
    best = number(record.get("best_score"), "best_score", minimum=0, maximum=1)
    if best + 1e-12 < incumbent["score"]:
        raise ValueError("best_score cannot be below the current incumbent")
    revision = record.get("revision")
    incumbent_revision = record.get("incumbent_revision")
    if (not isinstance(revision, str) or not isinstance(incumbent_revision, str)
            or not re.fullmatch(r"[0-9a-f]{40,64}", revision)
            or not re.fullmatch(r"[0-9a-f]{40,64}", incumbent_revision)
            or revision == incumbent_revision):
        raise ValueError("distinct pinned candidate and incumbent commit IDs are required")
    edits = record.get("edits")
    if not isinstance(edits, list) or not edits:
        raise ValueError("candidate requires attributed edits")
    for edit in edits:
        if not isinstance(edit, dict) or edit.get("component") not in COMPONENTS or not isinstance(edit.get("hypothesis"), str) or not edit["hypothesis"].strip():
            raise ValueError("each edit requires a known component and a hypothesis")
    limit = edit_budget(record.get("round"), record.get("rounds"), record.get("min_edits"), record.get("max_edits"))
    history = record.get("history", [])
    if not isinstance(history, list) or any(not isinstance(item, dict) for item in history):
        raise ValueError("history must be an array of edit records")
    prior_winners = {item.get("component") for item in history if item.get("accepted") is True}
    novelty = len(({edit["component"] for edit in edits} & STRUCTURAL) - prior_winners)
    delta_score = candidate["score"] - incumbent["score"]
    delta_cost = (candidate["tokens"] - incumbent["tokens"]) / incumbent["tokens"]
    result = {"revision": revision, "incumbent_revision": incumbent_revision,
              "incumbent": incumbent, "candidate": candidate,
              "noise": noise, "cost_noise": cost_noise, "best_score": best, "score_change": delta_score,
              "relative_token_change": delta_cost, "edit_budget": limit,
              "edit_count": len(edits), "structural_novelty": novelty,
              "admissible": False, "reason": ""}
    # The critic must inspect the actual diff before seeing benchmark scores.
    critic = record.get("critic")
    if not isinstance(critic, dict) or critic.get("passed") is not True or not isinstance(critic.get("evidence"), str) or not critic["evidence"].strip():
        result["reason"] = "independent leakage/irrelevance review missing or failed"
    elif len(edits) > limit:
        result["reason"] = "annealed edit budget exceeded"
    elif candidate["score"] < best - noise - 1e-12:
        result["reason"] = "below noise-adjusted best-score floor"
    elif record.get("guards_passed") is not True:
        result["reason"] = "domain guard missing or failed"
    elif delta_score > noise:
        beta0 = number(record.get("beta0"), "beta0", minimum=0)
        beta1 = number(record.get("beta1"), "beta1", minimum=0)
        if delta_cost > beta0 + beta1 * delta_score + 1e-12:
            result["reason"] = "token cost increase exceeds measured-gain allowance"
        else:
            result.update(admissible=True, reason="measured gain exceeds noise and cost rule passes")
    else:
        weights = record.get("within_band", {})
        if not isinstance(weights, dict):
            raise ValueError("within_band must be an object")
        ws = number(weights.get("score", 0), "within_band.score", minimum=0)
        wc = number(weights.get("cost", 1), "within_band.cost", minimum=0)
        wn = number(weights.get("novelty", 0), "within_band.novelty", minimum=0)
        # A small token saving can arise from ordinary run-to-run variation.
        # Credit only the portion beyond the unchanged-incumbent cost band.
        cost_credit = max(0, -delta_cost - cost_noise) if delta_cost < 0 else -delta_cost
        shaped = ws * delta_score + wc * cost_credit + wn * novelty
        result["within_band_value"] = shaped
        if shaped > 0:
            result.update(admissible=True, reason="within-noise cost/novelty rule passes")
        else:
            result["reason"] = "within-noise change has insufficient cost or novelty benefit"
    result["next_best_score"] = max(best, candidate["score"]) if result["admissible"] else best
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path, help="JSON record with pinned revisions, trials and critic evidence")
    args = parser.parse_args()
    try:
        result = assess(json.loads(args.evidence.read_text()))
    except (OSError, ValueError, TypeError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True, indent=2))
    raise SystemExit(0 if result["admissible"] else 1)


if __name__ == "__main__":
    main()
