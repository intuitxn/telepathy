#!/usr/bin/env python3
"""Thin effect driver for the interpreter in ../system.bend. No daemon or registry."""
import argparse
import difflib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "runtime/system.bend"
LIMIT = 1024 * 1024
RECEIPT_LIMIT = 160 * LIMIT


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(LIMIT), b""):
            hasher.update(block)
    return hasher.hexdigest()


def tree_digests(directory):
    return {str(p.relative_to(directory)): file_digest(p)
            for p in sorted(Path(directory).rglob("*")) if p.is_file() and p.name != "build.json"}


def read(path, limit=LIMIT):
    with Path(path).open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"file exceeds {limit} bytes: {path}")
    return data


def save(path, value):
    path = Path(path)
    serialized = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    if len(serialized.encode()) > RECEIPT_LIMIT:
        raise ValueError("receipt exceeds 160 MiB")
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        os.chmod(stream.name, 0o600)
        stream.write(serialized)
    os.replace(stream.name, path)


def command(argv, *, payload=None, cwd=ROOT, timeout=120):
    # Temporary streams bound in-memory output even when an external command is noisy.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=out, stderr=err,
                                   cwd=cwd, text=True, start_new_session=True,
                                   env={**os.environ, "BEND_NO_TELEMETRY": "1"})
        try:
            process.communicate(payload, timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        if out.tell() > LIMIT or err.tell() > LIMIT:
            raise ValueError("effect output exceeds 1 MiB")
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read().decode(), err.read().decode()
    if process.returncode:
        raise RuntimeError(f"command exited {process.returncode}: {stderr[-2000:]} {stdout[-2000:]}")
    return stdout


class Kernel:
    def __init__(self):
        self.bend = os.environ.get("BEND") or str(Path.home() / ".bend/bin/bend")
        if not Path(self.bend).exists():
            self.bend = shutil.which("bend") or self.bend
        self.source_hash = digest(SOURCE.read_bytes())
        self.version = command([self.bend, "version"]).strip()
        self.engine = shutil.which("bun")
        if not self.engine:
            raise RuntimeError("Bun is required to run Bend's generated JavaScript effects")
        self.engine_version = command([self.engine, "--version"]).strip()
        package = Path(self.bend).resolve().parent.parent / "bend2"
        if package.is_dir():
            self._cached_build(package)
        else:
            # Unknown installations remain usable without assuming their library layout.
            self.build = tempfile.TemporaryDirectory(prefix="bend-harness-bin-")
            self._compile(Path(self.build.name))

    def _identity(self, package):
        return {"source_sha256": file_digest(SOURCE), "compiler_sha256": file_digest(self.bend),
                "runtime": tree_digests(package), "version": self.version,
                "backend": "bend-js", "engine_version": self.engine_version,
                "platform": sys.platform, "machine": os.uname().machine}

    def _compile(self, directory):
        checked = command([self.bend, str(SOURCE), "--check-only"], timeout=600)
        if "All terms check." not in checked:
            raise RuntimeError("Bend checker did not confirm the source")
        self.check = checked.strip()
        generated = directory / "system.js"
        command([self.bend, str(SOURCE), "-o", str(generated)], timeout=600)
        # Bend emits CommonJS. This repository declares ESM for its own .js files.
        self.binary = str(directory / "system.cjs")
        generated.rename(self.binary)
        if file_digest(SOURCE) != self.source_hash:
            raise RuntimeError("Bend source changed during build; retry with a stable source")

    def _cached_build(self, package):
        identity = self._identity(package)
        key = digest(json.dumps(identity, sort_keys=True).encode())
        root = ROOT / ".local/harness/builds"
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = root / key
        # OS-managed lock is released on exit/crash; never wait forever for a build.
        with (root / (key + ".lock")).open("a") as lock:
            deadline = time.monotonic() + 660
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("timed out waiting for the native build lock")
                    time.sleep(0.2)
            try:
                receipt = json.loads(read(target / "build.json"))
                valid = (receipt["identity"] == identity and "All terms check." in receipt["check"]
                         and receipt["artifacts"] == tree_digests(target)
                         and (target / "system.cjs").is_file())
            except (OSError, ValueError, KeyError):
                valid = False
            if valid:
                self.check, self.binary = receipt["check"], str(target / "system.cjs")
                return
            with tempfile.TemporaryDirectory(dir=root, prefix=".building-") as temporary:
                stage = Path(temporary)
                self._compile(stage)
                if self._identity(package) != identity:
                    raise RuntimeError("source or toolchain changed during build; retry")
                save(stage / "build.json", {"identity": identity, "check": self.check,
                                           "artifacts": tree_digests(stage)})
                if target.exists():
                    target.rename(root / (key + ".invalid-" + str(time.time_ns())))
                stage.rename(target)
                self.binary = str(target / "system.cjs")

    def call(self, *args):
        if digest(SOURCE.read_bytes()) != self.source_hash:
            raise RuntimeError("Bend source changed after checking; start a new run")
        argv = [self.engine, self.binary] if self.binary.endswith(".cjs") else [self.binary]
        return command([*argv, *map(str, args)])

    def step(self, program, observations):
        return json.loads(self.call("dsl", program, "\n".join(
            "ok" if observation["ok"] else "fail" for observation in observations)))

    def validate(self, program, config):
        result = json.loads(self.call("dsl-check", program))
        if result.get("status") != "valid":
            raise ValueError("invalid harness")
        for item in result["effects"]:
            key = item["kind"] + ":" + item["ref"]
            if key not in config["effects"]:
                raise ValueError(f"unbound effect: {key}")
        return result


def load_bindings(path):
    path = Path(path).resolve()
    raw = read(path)
    config = json.loads(raw)
    if config.get("version") != 1 or not isinstance(config.get("effects"), dict):
        raise ValueError("bindings require version: 1 and an effects object")
    dependencies = set()
    for key, binding in config["effects"].items():
        if not isinstance(binding, dict):
            raise ValueError(f"{key}: binding must be an object")
        declared = binding.get("dependencies", [])
        if not isinstance(declared, list) or not all(isinstance(name, str) for name in declared):
            raise ValueError(f"{key}: dependencies must be a list of paths")
        dependencies.update(declared)
        if binding.get("kind") in ("file", "memory"):
            name = binding.get("path")
            if not isinstance(name, str):
                raise ValueError(f"{key}: file binding requires a path")
            dependencies.add(name)
    files = {}
    for name in sorted(dependencies):
        file = (path.parent / name).resolve()
        if not name or file == path or not file.is_file():
            raise ValueError(f"binding dependency is not a file: {name}")
        files[name] = file_digest(file)
    identity = {"config_sha256": digest(raw), "dependencies": files}
    binding_hash = digest(json.dumps(identity, sort_keys=True).encode())
    config["_identity"] = {"path": str(path), "value": identity, "sha256": binding_hash}
    return config, path.parent, binding_hash


def check_bindings(config, directory, binding_hash):
    identity = config.get("_identity")
    if identity is None:
        return  # Direct test bindings have no external config file.
    if identity["sha256"] != binding_hash or digest(read(identity["path"])) != identity["value"]["config_sha256"]:
        raise RuntimeError("bindings changed during execution")
    for name, expected in identity["value"]["dependencies"].items():
        if file_digest((directory / name).resolve()) != expected:
            raise RuntimeError(f"binding dependency changed during execution: {name}")


def expand(value, directory):
    return value.replace("{python}", sys.executable).replace("{root}", str(ROOT)).replace("{bindings}", str(directory))


def effect(request, config, directory, task, observations, kernel, timeout):
    key = request["kind"] + ":" + request["ref"]
    binding = config["effects"].get(key)
    if not isinstance(binding, dict):
        raise ValueError(f"unbound effect: {key}")
    value = observations[-1]["value"] if observations else task
    payload = {"input": task, "value": value, "observations": observations, "request": request}
    kind = binding.get("kind")
    started = time.monotonic()
    if kind == "command":
        argv = binding.get("argv")
        if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
            raise ValueError(f"{key}: argv must be a nonempty string array")
        result = json.loads(command([expand(x, directory) for x in argv],
                                   payload=json.dumps(payload), cwd=directory, timeout=timeout))
    elif kind == "file" and request["kind"] == "retrieve":
        result = {"ok": True, "value": read(directory / binding["path"]).decode()}
    elif kind == "memory" and request["kind"] == "retrieve":
        result = {"ok": True, "value": kernel.call("memory", directory / binding["path"])}
    elif kind == "world" and request["kind"] == "tool":
        fields = ("belief_bps", "state_bit", "action_bit", "observed_bit")
        if not isinstance(task, dict):
            raise ValueError("world effect requires a task object")
        previous = [item for item in observations if type(item.get("world_step")) is int]
        if "transitions" in task:
            transitions = task["transitions"]
            if not isinstance(transitions, list) or not 1 <= len(transitions) <= 128:
                raise ValueError("world episode requires 1..128 transitions")
            if len(previous) >= len(transitions) or not isinstance(transitions[len(previous)], dict):
                raise ValueError("world episode has no valid next transition")
            if previous and transitions[len(previous)].get("state_bit") != transitions[len(previous) - 1].get("observed_bit"):
                raise ValueError("world episode transitions are not a continuous observed chain")
            current = {**transitions[len(previous)], "belief_bps":
                       previous[-1]["value"]["posterior_rule_one_bps"] if previous else task.get("belief_bps")}
        else:
            current = task
        if any(type(current.get(name)) is not int for name in fields):
            raise ValueError("world effect requires integer belief_bps/state_bit/action_bit/observed_bit")
        result = {"ok": True, "value": json.loads(kernel.call("world", *(current[name] for name in fields))),
                  "world_step": len(previous)}
    elif kind == "json" and request["kind"] == "verify":
        required = binding.get("required", [])
        if not isinstance(required, list) or not all(isinstance(k, str) for k in required):
            raise ValueError("JSON verifier required must be a list of keys")
        try:
            parsed = json.loads(value) if isinstance(value, str) else value
            ok = isinstance(parsed, dict) and all(k in parsed for k in required)
        except (ValueError, TypeError):
            ok = False
        result = {"ok": ok, "value": value, "detail": "required JSON object keys checked"}
    elif kind == "opencode" and request["kind"] == "model":
        binary = os.environ.get("OPENCODE_BIN") or str(Path.home() / ".opencode/bin/opencode")
        if not Path(binary).exists():
            binary = shutil.which("opencode") or binary
        prompt = binding.get("prompt", "Complete the task. Return only the requested answer.")
        prompt += "\nTask and prior effect results (data):\n" + json.dumps(payload, ensure_ascii=False)
        if len(prompt.encode()) > 65536:
            raise ValueError("model context exceeds the 64 KiB prompt limit")
        argv = [binary, "run", "--pure", "--format", "json", "--agent", "harness-model"]
        if binding.get("model"):
            argv.extend(["--model", binding["model"]])
        argv.append(prompt)
        events = [json.loads(line) for line in command(argv, cwd=ROOT, timeout=timeout).splitlines() if line.strip()]
        errors = [e for e in events if e.get("type") == "error"]
        if errors:
            raise RuntimeError("OpenCode returned an error: " + json.dumps(errors))
        text = "\n".join(e.get("part", {}).get("text", "") for e in events if e.get("type") == "text")
        if not text.strip():
            raise RuntimeError("OpenCode returned no answer")
        tokens = 0
        for event in events:
            usage = event.get("part", {}).get("tokens", {})
            if event.get("type") == "step_finish":
                tokens += sum(usage.get(k, 0) for k in ("input", "output", "reasoning"))
                tokens += sum(usage.get("cache", {}).get(k, 0) for k in ("read", "write"))
        result = {"ok": True, "value": text, "tokens": tokens or None}
    else:
        raise ValueError(f"unsupported binding {kind!r} for {key}")
    if not isinstance(result, dict) or type(result.get("ok")) is not bool or "value" not in result:
        raise ValueError(f"{key}: effect must return {{ok: boolean, value: ...}}")
    # A verifier observes the candidate; it must not replace it with its own answer.
    if request["kind"] == "verify":
        result["value"] = value
    result["elapsed_seconds"] = round(time.monotonic() - started, 4)
    return result


def run(kernel, program, config, directory, binding_hash, task, output, timeout=120):
    validation = kernel.validate(program, config)
    if isinstance(task, dict) and "transitions" in task:
        if config["effects"].get("tool:world", {}).get("kind") != "world" or any(
                item != {"kind": "tool", "ref": "world"} for item in validation["effects"]):
            raise ValueError("batch world episodes require the Bend world binding only; future observations would leak")
    check_bindings(config, directory, binding_hash)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    manifest = {"version": 1, "source_sha256": kernel.source_hash,
                "bend": kernel.version, "backend": "bend-js", "engine": kernel.engine_version,
                "check": kernel.check,
                "program_sha256": digest(program.encode()), "bindings_sha256": binding_hash,
                "binding_dependencies": config.get("_identity", {}).get("value", {}).get("dependencies", {}),
                "program": program, "input": task, "observations": [], "effects": [], "status": "running"}
    save(output / "run.json", manifest)
    try:
        for _ in range(129):
            request = kernel.step(program, manifest["observations"])
            if request["status"] == "done":
                manifest.update(status="done", ok=request["ok"], effect_count=len(manifest["effects"]))
                save(output / "run.json", manifest)
                return manifest
            if request["status"] != "effect" or request["index"] != len(manifest["observations"]):
                raise ValueError("unexpected interpreter response")
            # Persist intent before dispatch. Interrupted runs are inspectable, never auto-retried.
            manifest["pending"] = request
            save(output / "run.json", manifest)
            check_bindings(config, directory, binding_hash)
            result = effect(request, config, directory, task, manifest["observations"], kernel, timeout)
            check_bindings(config, directory, binding_hash)
            manifest["effects"].append(request)
            manifest["observations"].append(result)
            manifest.pop("pending")
            save(output / "run.json", manifest)
        raise ValueError("effect limit exceeded")
    except Exception as error:
        manifest.update(status="error", error=str(error))
        save(output / "run.json", manifest)
        raise


def replay(kernel, path):
    saved = json.loads(read(Path(path) / "run.json", RECEIPT_LIMIT))
    if saved["source_sha256"] != kernel.source_hash or saved["program_sha256"] != digest(saved["program"].encode()):
        raise ValueError("replay source/program digest mismatch")
    if saved.get("status") != "done" or len(saved["effects"]) != len(saved["observations"]):
        raise ValueError("only completed runs can replay; pending effects must be inspected")
    for i, expected in enumerate(saved["effects"]):
        if kernel.step(saved["program"], saved["observations"][:i]) != expected:
            raise ValueError(f"effect {i} differs on replay")
    final = kernel.step(saved["program"], saved["observations"])
    if final.get("status") != "done" or final["ok"] != saved["ok"]:
        raise ValueError("terminal state differs on replay")
    return {"replayed": True, "effects": len(saved["effects"]), "ok": saved["ok"],
            "scope": "control flow only; external observations are recorded evidence, not reverified"}


def edit_size(before, after):
    # Conservative surface edit count, not an estimate of independent semantic mechanisms.
    a, b = before.splitlines(), after.splitlines()
    return sum(max(j-i, l-k) for tag, i, j, k, l in difflib.SequenceMatcher(None, a, b).get_opcodes() if tag != "equal")


def json_equal(a, b):
    if type(a) is bool or type(b) is bool:
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b))
    return a == b


def validate_policy(args):
    for name, limit in (("delta", 10000), ("edit_budget", 1000),
                        ("max_growth", 10000), ("gain_multiplier", 100)):
        value = getattr(args, name)
        if type(value) is not int or not 0 <= value <= limit:
            raise ValueError(f"{name} must be an integer in 0..{limit}")


def load_suite(path):
    raw = read(path)
    suite = json.loads(raw)
    if not isinstance(suite, list) or not suite or len(suite) > 100:
        raise ValueError("suite must contain 1..100 cases")
    if not all(isinstance(case, dict) and "input" in case and "expected" in case for case in suite):
        raise ValueError("each case requires input and an independent expected value")
    return suite, digest(raw)


def evaluate_program(kernel, program, config, directory, binding_hash, suite, output, timeout):
    scores, costs = [], []
    for i, case in enumerate(suite):
        result = run(kernel, program, config, directory, binding_hash, case["input"], output / str(i), timeout)
        answer = result["observations"][-1]["value"] if result["observations"] else case["input"]
        # Expected answers are never passed into effect payloads.
        scores.append(bool(result["ok"] and json_equal(answer, case["expected"])))
        costs.append(result["effect_count"])
    return {"score": round(10000 * sum(scores) / len(scores)),
            "cost": max(1, (sum(costs) + len(costs) - 1) // len(costs)),
            "passed": sum(scores), "cases": len(scores), "effects": sum(costs)}


def compare(kernel, args):
    validate_policy(args)
    requested_best = getattr(args, "best_score", None)
    if requested_best is not None and (type(requested_best) is not int or not 0 <= requested_best <= 10000):
        raise ValueError("best_score must be an integer in 0..10000")
    config, directory, binding_hash = load_bindings(args.bindings)
    suite, suite_hash = load_suite(args.suite)
    programs = {"baseline": read(args.baseline).decode(), "candidate": read(args.candidate).decode()}
    for program in programs.values():
        kernel.validate(program, config)
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    metrics = {arm: evaluate_program(kernel, program, config, directory, binding_hash,
                                     suite, output / arm, args.timeout)
               for arm, program in programs.items()}
    base, candidate = metrics["baseline"], metrics["candidate"]
    best_score = max(base["score"], requested_best or 0)
    edits = edit_size(programs["baseline"], programs["candidate"])
    decision = json.loads(kernel.call("select", base["score"], candidate["score"], best_score,
                                     base["cost"], candidate["cost"], args.delta, edits, args.edit_budget,
                                     args.max_growth, args.gain_multiplier, 1, 0))
    report = {"version": 1, "metrics": metrics, "cost_unit": "effects (rounded-up mean)",
              "edits": edits, "decision": decision, "source_sha256": kernel.source_hash,
              "policy": {"delta": args.delta, "edit_budget": args.edit_budget,
                         "max_growth": args.max_growth, "gain_multiplier": args.gain_multiplier,
                         "guard": 1, "leak": 0, "best_score": best_score},
              "suite_sha256": suite_hash, "bindings_sha256": binding_hash,
              "programs": {k: digest(v.encode()) for k, v in programs.items()},
              "changes": programs,
              "scope": "local candidate comparison; no leakage critic, automatic promotion or generalization claim"}
    save(output / "comparison.json", report)
    return report


def propose(kernel, args):
    """Ask the native text-only agent for a candidate; never alter the incumbent."""
    config, directory, binding_hash = load_bindings(args.bindings)
    before = read(args.program).decode()
    kernel.validate(before, config)
    if not 1 <= args.edit_budget <= 1000:
        raise ValueError("edit_budget must be in 1..1000")
    output = Path(args.out)
    if output.exists():
        raise ValueError("proposal output directory must be new")
    paths = args.feedback if isinstance(args.feedback, list) else [args.feedback]
    if not 1 <= len(paths) <= 64:
        raise ValueError("provide 1..64 feedback reports")
    # History contains program edits and aggregate measurements, never expected answers.
    feedback = []
    for path in paths:
        report = json.loads(read(path))
        feedback.append({k: report[k] for k in ("metrics", "cost_unit", "edits", "decision", "changes") if k in report})
    available = sorted(config["effects"])
    prompt = (
        "Propose one bounded harness program. Return ONLY newline-separated prefix tokens, "
        "no Markdown or explanation. Grammar: model REF | tool REF | retrieve REF | "
        "sequence PROGRAM PROGRAM | branch PRED PROGRAM PROGRAM | repeat BOUND STOP PROGRAM | "
        "verify REF PROGRAM. Every word in that grammar is a separate line. "
        "PRED is ok/fail/always; STOP is ok/fail/never; BOUND is 1..32. "
        "Sequence continues after failure; branch reads last status; repeat post-tests after "
        "each body; verify skips its contract if body fails. For a retry after a "
        "failed verification, put verify INSIDE repeat: repeat 2 ok verify REF model REF. "
        "Putting repeat inside verify checks only the final model result. Optimize "
        "the measured score and effect count from feedback. Keep changes minimal. "
        "Use only the available effect references, matching their kind. Never invent task "
        "answers, tool bindings or contracts. The evaluator and bindings cannot be changed. "
        "Use rejected changes in the history as negative evidence; avoid repeating them. "
        f"Changed-line budget: {args.edit_budget}."
    )
    binding = {"kind": "opencode", "prompt": prompt}
    if args.model:
        binding["model"] = args.model
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    save(output / "proposal.json", {"status": "pending", "base_sha256": digest(before.encode())})
    try:
        result = effect({"kind": "model", "ref": "proposer", "index": 0},
                        {"effects": {"model:proposer": binding}}, directory,
                        {"program": before, "available": available, "feedback": feedback}, [], kernel, args.timeout)
        candidate = result["value"].strip() + "\n"
        kernel.validate(candidate, config)
        edits = edit_size(before, candidate)
        if not 0 < edits <= args.edit_budget:
            raise ValueError(f"proposal changed {edits} lines; required 1..{args.edit_budget}")
    except Exception as error:
        save(output / "proposal.json", {"status": "error", "error": str(error),
                                       "base_sha256": digest(before.encode())})
        raise
    (output / "candidate.harness").write_text(candidate)
    save(output / "proposal.json", {"source_sha256": kernel.source_hash,
         "bindings_sha256": binding_hash, "base_sha256": digest(before.encode()),
         "candidate_sha256": digest(candidate.encode()), "edits": edits,
         "tokens": result.get("tokens"), "status": "unevaluated"})
    return {"candidate": str(output / "candidate.harness"), "edits": edits, "status": "unevaluated"}


def evolve(kernel, args):
    """Bounded local search; each candidate is selected by the checked Bend rule."""
    validate_policy(args)
    if not 1 <= args.rounds <= 8:
        raise ValueError("rounds must be in 1..8")
    config, directory, binding_hash = load_bindings(args.bindings)
    suite, suite_hash = load_suite(args.suite)
    holdout_path = getattr(args, "holdout", None)
    holdout, holdout_hash = load_suite(holdout_path) if holdout_path else (None, None)
    if holdout is not None:
        if any(json_equal(dev["input"], held["input"]) for dev in suite for held in holdout):
            raise ValueError("development and holdout suites share inputs")
    program = read(args.program).decode()
    kernel.validate(program, config)
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    current_file = output / "start.harness"
    current_file.write_text(program)
    frontier = {"version": 1, "status": "running", "source_sha256": kernel.source_hash,
                "bindings_sha256": binding_hash, "suite_sha256": suite_hash,
                "holdout_suite_sha256": holdout_hash,
                "start_sha256": digest(program.encode()), "rounds_requested": args.rounds,
                "history": []}
    save(output / "frontier.json", frontier)
    try:
        seed = evaluate_program(kernel, program, config, directory, binding_hash,
                                suite, output / "seed", args.timeout)
        best_score = seed["score"]
        seed_report = output / "seed.json"
        save(seed_report, {"metrics": {"baseline": seed}, "changes": {"baseline": program},
                           "decision": {"accepted": True, "reason": "starting_harness"},
                           "source_sha256": kernel.source_hash, "bindings_sha256": binding_hash,
                           "suite_sha256": suite_hash})
        frontier["seed"] = seed
        feedback = [seed_report]
        for index in range(args.rounds):
            if load_bindings(args.bindings)[2] != binding_hash or load_suite(args.suite)[1] != suite_hash:
                raise RuntimeError("bindings or evaluator changed during evolution")
            round_dir = output / f"round-{index:03d}"
            round_dir.mkdir()
            frontier["pending_round"] = index
            save(output / "frontier.json", frontier)
            proposal = propose(kernel, SimpleNamespace(program=current_file, bindings=args.bindings,
                               feedback=feedback, out=round_dir / "proposal",
                               edit_budget=args.edit_budget, model=args.model, timeout=args.timeout))
            report = compare(kernel, SimpleNamespace(baseline=current_file, candidate=proposal["candidate"],
                             bindings=args.bindings, suite=args.suite, out=round_dir / "comparison",
                             delta=args.delta, edit_budget=args.edit_budget,
                             max_growth=args.max_growth, gain_multiplier=args.gain_multiplier,
                             best_score=best_score, timeout=args.timeout))
            if report["bindings_sha256"] != binding_hash or report["suite_sha256"] != suite_hash:
                raise RuntimeError("bindings or evaluator changed during evolution")
            feedback.append(round_dir / "comparison/comparison.json")
            accepted = report["decision"]["accepted"]
            if accepted:
                current_file = Path(proposal["candidate"])
                best_score = max(best_score, report["metrics"]["candidate"]["score"])
            frontier["history"].append({"round": index, "accepted": accepted,
                                        "reason": report["decision"]["reason"],
                                        "candidate_sha256": report["programs"]["candidate"],
                                        "incumbent_sha256": digest(read(current_file)),
                                        "report": str(feedback[-1])})
            frontier["best_score"] = best_score
            frontier["incumbent"] = str(current_file)
            frontier.pop("pending_round")
            save(output / "frontier.json", frontier)
        result_path = output / "result.harness"
        result_path.write_bytes(read(current_file))
        frontier["status"] = "selected"
        frontier["result"] = str(result_path)
        save(output / "frontier.json", frontier)
        if holdout is not None:
            if load_bindings(args.bindings)[2] != binding_hash or load_suite(holdout_path)[1] != holdout_hash:
                raise RuntimeError("bindings or holdout evaluator changed before transfer measurement")
            (output / "holdout").mkdir()
            transfer = {"baseline": evaluate_program(kernel, program, config, directory,
                        binding_hash, holdout, output / "holdout/baseline", args.timeout),
                        "selected": evaluate_program(kernel, read(result_path).decode(), config,
                        directory, binding_hash, holdout, output / "holdout/selected", args.timeout)}
            holdout_report = {"version": 1, "suite_sha256": holdout_hash,
                              "bindings_sha256": binding_hash, "source_sha256": kernel.source_hash,
                              "programs": {"baseline": digest(program.encode()),
                                           "selected": digest(read(result_path))},
                              "metrics": transfer, "cost_unit": "effects (rounded-up mean)",
                              "scope": "one held-out measurement after development selection; not a new selection gate"}
            save(output / "holdout.json", holdout_report)
            frontier["holdout"] = {"report": str(output / "holdout.json"),
                                   "baseline_score": transfer["baseline"]["score"],
                                   "selected_score": transfer["selected"]["score"]}
        frontier["status"] = "done"
        save(output / "frontier.json", frontier)
        return frontier
    except Exception as error:
        frontier.update(status="error", error=str(error))
        save(output / "frontier.json", frontier)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    p = subs.add_parser("run", help="execute one DSL program through fixed effect bindings")
    p.add_argument("program")
    p.add_argument("--bindings", required=True)
    p.add_argument("--input", required=True, help="JSON task file")
    p.add_argument("--out", required=True, help="new private run directory")
    p.add_argument("--timeout", type=int, default=120)
    p = subs.add_parser("replay", help="replay completed control flow without executing effects")
    p.add_argument("directory")
    p = subs.add_parser("demo", help="run the offline baseline/retry comparison without a model")
    p.add_argument("--out", required=True, help="new private comparison directory")
    examples = Path(__file__).resolve().parent / "examples"
    p.set_defaults(baseline=examples / "baseline.harness", candidate=examples / "retry.harness",
                   bindings=examples / "bindings.json", suite=examples / "suite.json",
                   delta=0, edit_budget=16, max_growth=10000, gain_multiplier=2, timeout=120)
    p = subs.add_parser("compare", help="evaluate two programs with a fixed suite and bindings")
    for name in ("baseline", "candidate", "bindings", "suite", "out"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--delta", type=int, default=0, help="noise allowance in score basis points")
    p.add_argument("--edit-budget", type=int, default=16)
    p.add_argument("--max-growth", type=int, default=10000, help="maximum cost growth in basis points")
    p.add_argument("--gain-multiplier", type=int, default=2)
    p.add_argument("--best-score", type=int, help="best score from earlier rounds, in basis points")
    p.add_argument("--timeout", type=int, default=120)
    p = subs.add_parser("propose", help="ask OpenCode for an unevaluated program edit")
    for name in ("program", "bindings", "out"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--feedback", nargs="+", required=True, help="one or more prior comparison reports")
    p.add_argument("--edit-budget", type=int, default=16)
    p.add_argument("--model", help="optional configured OpenCode provider/model")
    p.add_argument("--timeout", type=int, default=120)
    p = subs.add_parser("evolve", help="run bounded local proposal and selection rounds")
    for name in ("program", "bindings", "suite", "out"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--holdout", help="disjoint suite measured once after selection")
    p.add_argument("--rounds", type=int, default=1)
    p.add_argument("--edit-budget", type=int, default=16)
    p.add_argument("--delta", type=int, default=0)
    p.add_argument("--max-growth", type=int, default=10000)
    p.add_argument("--gain-multiplier", type=int, default=2)
    p.add_argument("--model", help="optional configured OpenCode provider/model")
    p.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        if hasattr(args, "timeout") and not 1 <= args.timeout <= 3600:
            raise ValueError("timeout must be in 1..3600 seconds")
        kernel = Kernel()
        if args.action == "run":
            config, directory, binding_hash = load_bindings(args.bindings)
            result = run(kernel, read(args.program).decode(), config, directory, binding_hash,
                         json.loads(read(args.input)), args.out, args.timeout)
            print(json.dumps({"ok": result["ok"], "effects": result["effect_count"], "run": args.out}))
            return 0 if result["ok"] else 1
        if args.action == "replay":
            result = replay(kernel, args.directory)
        elif args.action == "propose":
            result = propose(kernel, args)
        elif args.action == "evolve":
            result = evolve(kernel, args)
        else:
            result = compare(kernel, args)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, RuntimeError, OSError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
