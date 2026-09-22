#!/usr/bin/env python3
"""Op driver for "procedure as Bend" ops.

Ordinary host code, not a new runtime or service. It owns every effect
(process launch, file writes, git diff, hashing) so the Bend op kernel can
stay pure. See docs/drafts/meta/op-dispatch-convention.md sections 2, 4, 5, 6, 7.

Subcommands
  list                       print the static op name -> role listing
  run <op> [--id <runid>]    gate, run the op fixture, write one run dir,
                             emit one GREEN/YELLOW/RED line per check

The driver never accepts, merges, pushes, publishes, sends or resolves
anything. A GREEN check is not acceptance.
"""
import argparse
import datetime
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OPS_DIR = ROOT / "runtime" / "ops"
RUNS_DIR = ROOT / "ops" / "runs"

# Static dispatch listing: op name -> role, one entry per op file. Mirrors the
# shape of REGISTRY in runtime/programs/cli.py:29. Adding a capability adds an
# op file plus one listing entry; op logic never enters this driver
# (convention section 6).
OPS = {
    "fold": "associative-reduction",
    "status": "canonical-status-projection",
}

# Task + acceptance handed to each op: task data, not instructions
# (convention section 4, `brief`).
BRIEFS = {
    "fold": (
        "Given FoldInput{op: Op, values: +List<Nat>} with Op in {Add, Max}, "
        "reduce values to one Nat: Add sums, Max takes the maximum, and the "
        "empty list reduces to the operation's two-sided identity (0).",
        [
            "bend runtime/ops/fold.bend --check-only reports `All terms check.` (exit 0).",
            "laws fold_identity, fold_singleton and fold_chunk are proven for every op, "
            "leaning on add_assoc, add_zero_r, max_assoc, max_zero_r.",
            "the bare-file fixture run exits 0 and prints `fixture 14` then `fixture_max 5`.",
        ],
    ),
    "status": (
        "Project +List<Record> (normalized Agent/Job/Memory/Evidence/Session "
        "observations) to the canonical status view +List<Row>: one row per "
        "record, ascending event id, durability `snapshot-single-writer` except "
        "Session which is `external-unbound`.",
        [
            "bend runtime/ops/status.bend --check-only reports `All terms check.` (exit 0).",
            "laws status_one_row_per_record, status_projection_total, "
            "status_rows_well_formed, status_order_independent, "
            "status_malformed_rejected and status_valid_records_well_formed are proven.",
            "the bare-file fixture run exits 0, renders the header and five sorted "
            "rows, and prints `malformed_record_rejected: True` and "
            "`valid_fixture_well_formed: True`.",
        ],
    ),
}

GREEN, YELLOW, RED = "GREEN", "YELLOW", "RED"


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bend_binary():
    override = os.environ.get("BEND_BINARY")
    if override:
        return Path(override)
    return Path.home() / ".bend" / "bin" / "bend"


def bend_env():
    env = dict(os.environ)
    env["BEND_NO_TELEMETRY"] = "1"
    return env


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sanitize(text, fallback):
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", text).strip("._-")
    return cleaned or fallback


def git_head():
    try:
        done = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip() or None


def candidate_patch():
    """git diff from committed HEAD, or an explicit no-change marker."""
    head = git_head()
    if head is None:
        return "no change: no committed HEAD in this repository\n", False
    try:
        done = subprocess.run(
            ["git", "-C", str(ROOT), "diff", "HEAD", "--"],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return f"no change: git diff failed ({error.__class__.__name__})\n", False
    if done.returncode != 0:
        return f"no change: git diff exited {done.returncode}\n", False
    if not done.stdout.strip():
        return "no change: working tree matches committed HEAD\n", False
    return done.stdout, True


def run_bend(args, timeout=300):
    """Launch the Bend binary; return (exit_code, combined_output)."""
    binary = bend_binary()
    if not binary.is_file():
        return 127, f"missing Bend binary at {binary}\n"
    try:
        done = subprocess.run(
            [str(binary)] + list(args), cwd=str(ROOT), env=bend_env(),
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 124, f"bend timed out after {timeout}s\n"
    except (OSError, subprocess.SubprocessError) as error:
        return 126, f"bend launch failed: {error.__class__.__name__}\n"
    return done.returncode, done.stdout + done.stderr


def verdict_of_gate(code, output):
    if code == 0 and "All terms check." in output:
        return GREEN, "All terms check."
    if "TODO" in output:
        return YELLOW, "open law / TODO present (informational)"
    if code == 127:
        return RED, "missing Bend toolchain"
    return RED, f"checker error (exit {code})"


def verdict_of_fixture(code, output):
    if code == 127:
        return RED, "missing Bend toolchain"
    if code != 0:
        return RED, f"fixture run failed (exit {code})"
    lines = [line for line in output.splitlines() if line.strip()]
    return GREEN, f"fixture exit 0 ({len(lines)} output lines)"


def resolve_op(op):
    """Return (display_name, role, op_path, registered)."""
    if op in OPS:
        return op, OPS[op], OPS_DIR / f"{op}.bend", True
    candidate = Path(op)
    if candidate.suffix == ".bend" and candidate.is_file():
        name = candidate.stem
        return name, OPS.get(name, "unregistered"), candidate.resolve(), name in OPS
    raise SystemExit(
        f"unknown op {op!r}: expected one of {', '.join(sorted(OPS))} "
        f"or a path to a .bend file"
    )


def brief_text(name, role, op_path, registered):
    task, acceptance = BRIEFS.get(name, (None, None))
    lines = [
        f"op: {name}",
        f"role: {role}",
        f"op file: {op_path}",
        f"registered: {'yes' if registered else 'no (ad hoc path; not in OPS listing)'}",
        "",
        "task:",
    ]
    if task is None:
        lines.append("  (no declared brief for this op; ad hoc dispatch)")
    else:
        lines.append("  " + task)
    lines += ["", "acceptance:"]
    if acceptance is None:
        lines.append("  (none declared)")
    else:
        for item in acceptance:
            lines.append("  - " + item)
    lines += [
        "",
        "This brief is task data handed to the op, not instructions to the driver.",
        "The driver only gates, runs the fixture, and records evidence; it does not",
        "accept, merge, push, publish, send or resolve anything.",
    ]
    return "\n".join(lines) + "\n"


def command_list():
    for name in sorted(OPS):
        print(f"{name}\t{OPS[name]}")
    return 0


def command_run(op, run_id):
    name, role, op_path, registered = resolve_op(op)
    if not op_path.is_file():
        print(f"VERDICT {RED} op-file :: not found at {op_path}")
        return 1
    safe_name = sanitize(name, "op")
    safe_id = sanitize(run_id or datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"), "run")
    run_dir = RUNS_DIR / f"{safe_name}-{safe_id}"
    if run_dir.exists():
        raise SystemExit(f"run dir already exists: {run_dir} (choose another --id)")

    binary = bend_binary()
    try:
        _, toolchain = run_bend(["version"], timeout=30)
    except Exception:
        toolchain = ""
    toolchain = toolchain.strip() or f"(no `bend version` output; binary={binary})"
    head = git_head() or "(no committed HEAD)"
    started = now_utc()

    check_cmd = f"BEND_NO_TELEMETRY=1 {binary} {op_path.relative_to(ROOT) if op_path.is_relative_to(ROOT) else op_path} --check-only"
    fixture_cmd = f"BEND_NO_TELEMETRY=1 {binary} {op_path.relative_to(ROOT) if op_path.is_relative_to(ROOT) else op_path}"

    gate_code, gate_out = run_bend([str(op_path), "--check-only"])
    fixture_code, fixture_out = run_bend([str(op_path)])

    gate_verdict, gate_reason = verdict_of_gate(gate_code, gate_out)
    fixture_verdict, fixture_reason = verdict_of_fixture(fixture_code, fixture_out)

    op_digest = sha256_file(op_path)
    driver_digest = sha256_file(Path(__file__).resolve())
    patch_text, patch_changed = candidate_patch()
    patch_verdict = YELLOW
    patch_reason = ("candidate diff recorded" if patch_changed
                    else "no change from committed HEAD")

    checks = [
        ("law-gate", gate_verdict, gate_reason),
        ("fixture-run", fixture_verdict, fixture_reason),
        ("source-digest", GREEN, f"sha256:{op_digest}"),
        ("candidate-patch", patch_verdict, patch_reason),
        ("driver-digest", GREEN, f"sha256:{driver_digest}"),
    ]
    red = sum(1 for _, v, _ in checks if v == RED)
    yellow = sum(1 for _, v, _ in checks if v == YELLOW)
    green = sum(1 for _, v, _ in checks if v == GREEN)
    exit_code = 1 if red else 0

    run_dir.mkdir(parents=True, exist_ok=False)

    (run_dir / "brief").write_text(brief_text(name, role, op_path, registered))
    (run_dir / "candidate.patch").write_text(patch_text)
    (run_dir / "evidence").write_text(evidence_text(
        name, role, op_path, safe_id, binary, toolchain, head, started,
        op_digest, driver_digest, check_cmd, gate_code, gate_out,
        fixture_cmd, fixture_code, fixture_out))
    verdict_lines = [
        f"run {safe_name}-{safe_id}",
        f"op file: {op_path}",
    ]
    for label, value, reason in checks:
        verdict_lines.append(f"VERDICT {value} {label} :: {reason}")
    verdict_lines.append(
        f"summary run={safe_name}-{safe_id} green={green} yellow={yellow} red={red} exit={exit_code}"
    )
    verdict_lines.append(
        "note: GREEN is not acceptance; only a named human reviewing the exact "
        "candidate revision resolves the work."
    )
    (run_dir / "verdict").write_text("\n".join(verdict_lines) + "\n")

    print(f"run {safe_name}-{safe_id}")
    for label, value, reason in checks:
        print(f"VERDICT {value} {label} :: {reason}")
    print(f"summary run={safe_name}-{safe_id} green={green} yellow={yellow} red={red} exit={exit_code}")
    print("note: GREEN is not acceptance; only a named human reviewing the exact candidate revision resolves the work.")
    print(f"run dir: {run_dir}")
    return exit_code


def evidence_text(name, role, op_path, run_id, binary, toolchain, head, started,
                  op_digest, driver_digest, check_cmd, gate_code, gate_out,
                  fixture_cmd, fixture_code, fixture_out):
    rel = op_path.relative_to(ROOT) if op_path.is_relative_to(ROOT) else op_path
    lines = [
        f"op: {name}",
        f"role: {role}",
        f"op file: {rel}",
        f"run id: {run_id}",
        f"started: {started}",
        f"toolchain: {toolchain}",
        f"repo HEAD: {head} (read-only observation)",
        f"driver: runtime/ops/driver.py sha256:{driver_digest}",
        "",
        "--- source digest ---",
        f"sha256({rel}) = {op_digest}",
        "",
        f"--- gate: checker (exit {gate_code}) ---",
        f"cmd: {check_cmd}",
        gate_out.rstrip("\n"),
        "",
        f"--- fixture: bare-file run (exit {fixture_code}) ---",
        f"cmd: {fixture_cmd}",
        fixture_out.rstrip("\n"),
        "",
        "Digests, exit codes and outputs are recorded by the host driver. The op",
        "kernel itself performs no process spawn, network call, file write or hash",
        "(convention section 2).",
    ]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(prog="driver.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="print the static op name -> role listing")
    run_parser = sub.add_parser("run", help="gate, run and record one op dispatch")
    run_parser.add_argument("op", help="registered op name or path to a .bend file")
    run_parser.add_argument("--id", default=None, help="run id (default: UTC timestamp)")
    args = parser.parse_args(argv)
    if args.command == "list":
        return command_list()
    return command_run(args.op, args.id)


if __name__ == "__main__":
    sys.exit(main())
