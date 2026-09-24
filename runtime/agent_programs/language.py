"""Typed agent-program parser and JSON-plan compiler.

The language is intentionally small: readable pseudocode in, deterministic JSON plan out.
Execution belongs to ``runtime/meta_shell.py``; this module only checks and
describes the work to submit.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "agent.program/v0"
FIELD_TYPES = frozenset({"string", "string[]", "int", "bool", "number", "json"})
EFFECT_KINDS = frozenset({"read", "write", "command", "network", "submit", "publish"})
DECISION_TYPES = frozenset({"Choice", "Noul", "Score"})

_NAME_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
_SEMVER_RE = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")
_DIGEST_PREFIX = "sha256:"


class ProgramError(ValueError):
    """Program source failed a stable validation rule."""

    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True)
class ProgramPlan:
    plan: dict[str, Any]

    def to_json(self) -> str:
        return json.dumps(self.plan, indent=2, sort_keys=True) + "\n"


def compile_file(path: Path | str) -> ProgramPlan:
    source_path = Path(path)
    return compile_source(source_path.read_text(encoding="utf-8"), source_name=str(source_path))


def compile_source(source: str | bytes, *, source_name: str = "<memory>") -> ProgramPlan:
    text = _normalize(source)
    raw = _parse_program(text)

    _reject_unknown(raw, {"schema", "program_version", "name", "description", "inputs", "effects", "steps", "decisions"}, "top")
    _require(raw, "schema", str)
    _require(raw, "program_version", str)
    _require(raw, "name", str)
    _require(raw, "description", str)
    if raw["schema"] != SCHEMA:
        raise ProgramError("unsupported_schema", f"expected {SCHEMA!r}")
    _check_name(raw["name"], "program name")
    if not _SEMVER_RE.fullmatch(raw["program_version"]):
        raise ProgramError("invalid_version", "program_version must be semantic x.y.z")
    if not raw["description"].strip() or len(raw["description"]) > 500:
        raise ProgramError("invalid_description", "description must be 1-500 nonblank characters")

    inputs = _parse_inputs(raw.get("inputs"))
    effects = _parse_effects(raw.get("effects"))
    decisions = _parse_decisions(raw.get("decisions", {}))
    steps = _parse_steps(raw.get("steps"), effects, decisions)
    _check_references(inputs, steps, decisions)

    canonical_source = _canonical_source(text)
    plan: dict[str, Any] = {
        "schema": "agent.plan/v0",
        "source_schema": SCHEMA,
        "source_name": source_name,
        "source_digest": _DIGEST_PREFIX + hashlib.sha256(canonical_source).hexdigest(),
        "name": raw["name"],
        "program_version": raw["program_version"],
        "description": raw["description"],
        "inputs": inputs,
        "effects": effects,
        "steps": steps,
        "decisions": decisions,
        "advisory_boundary": (
            "Decision outputs are advisory data. They do not prove safety or correctness "
            "and do not grant effects beyond each step's explicit allowed_effects."
        ),
        "runtime": {
            "bridge": "runtime/meta_shell.py",
            "mode": "single existing meta-shell submission",
            "persistent_runtime": "none added",
        },
    }
    digest_basis = dict(plan)
    digest_basis.pop("source_name", None)
    plan["plan_digest"] = _DIGEST_PREFIX + hashlib.sha256(
        json.dumps(digest_basis, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return ProgramPlan(plan)


def _normalize(source: str | bytes) -> str:
    if isinstance(source, bytes):
        try:
            source = source.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ProgramError("invalid_encoding", str(error)) from error
    if not isinstance(source, str):
        raise ProgramError("invalid_source", f"expected str or bytes, got {type(source).__name__}")
    return source[1:] if source.startswith("\ufeff") else source


def _canonical_source(text: str) -> bytes:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"
    return normalized.encode("utf-8")


def _quoted(value: str, line: int) -> str:
    try:
        result = json.loads(value)
    except json.JSONDecodeError as error:
        raise ProgramError("invalid_string", f"line {line}: expected a quoted string") from error
    if not isinstance(result, str):
        raise ProgramError("invalid_string", f"line {line}: expected a quoted string")
    return result


def _names(value: str) -> list[str]:
    return [part.strip() for part in value.split(",")]


def _number_literal(value: str, line: int) -> int | float:
    try:
        number = json.loads(value)
    except json.JSONDecodeError as error:
        raise ProgramError("invalid_number", f"line {line}: expected a number") from error
    if isinstance(number, bool) or not isinstance(number, (int, float)):
        raise ProgramError("invalid_number", f"line {line}: expected a number")
    return number


def _parse_program(source: str) -> dict[str, Any]:
    """Parse a deliberately small, line-oriented agent pseudocode syntax."""
    raw: dict[str, Any] = {"schema": SCHEMA, "inputs": {}, "effects": {},
                           "steps": [], "decisions": {}}
    current: dict[str, Any] | None = None
    current_kind = ""
    for number, original in enumerate(source.splitlines(), 1):
        if not original.strip() or original.lstrip().startswith("#"):
            continue
        if "\t" in original[:len(original) - len(original.lstrip())]:
            raise ProgramError("invalid_indent", f"line {number}: use spaces, not tabs")
        if original.startswith("  "):
            if current is None or original.startswith("   "):
                raise ProgramError("invalid_indent", f"line {number}: expected a two-space block line")
            line = original[2:].strip()
            key, separator, value = line.partition(" ")
            if not separator or not value.strip():
                raise ProgramError("invalid_statement", f"line {number}: incomplete block statement")
            value = value.strip()
            if key == "ask":
                _set_once(current, "prompt", _quoted(value, number), number)
            elif key == "use":
                _set_once(current, "uses", _names(value), number)
            elif current_kind == "step" and key == "allow":
                _set_once(current, "allowed_effects", _names(value), number)
            elif current_kind == "step" and key == "agent":
                _set_once(current, "agent", value, number)
            elif current_kind == "step" and key == "decide":
                _set_once(current, "decision", value, number)
            elif current_kind == "step" and key == "output":
                match = re.fullmatch(r"([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\S+)", value)
                if not match:
                    raise ProgramError("invalid_statement", f"line {number}: expected output NAME: TYPE")
                outputs = current.setdefault("outputs", {})
                _set_once(outputs, match[1], match[2], number)
            elif current_kind == "decision" and key == "options":
                _set_once(current, "options", _names(value), number)
            elif current_kind == "decision" and key == "threshold":
                _set_once(current, "threshold", _number_literal(value, number), number)
            elif current_kind == "decision" and key == "range":
                match = re.fullmatch(r"(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)", value)
                if not match:
                    raise ProgramError("invalid_statement", f"line {number}: expected range MIN..MAX")
                _set_once(current, "min", _number_literal(match[1], number), number)
                _set_once(current, "max", _number_literal(match[2], number), number)
            elif current_kind == "decision" and key == "rubric":
                _set_once(current, "rubric", _quoted(value, number), number)
            else:
                raise ProgramError("unknown_statement", f"line {number}: unexpected {key!r}")
            continue
        if original[0].isspace():
            raise ProgramError("invalid_indent", f"line {number}: top-level statements must start at column 1")
        current = None
        current_kind = ""
        line = original.strip()
        match = re.fullmatch(r"program\s+(\S+)\s+version\s+(\S+)", line)
        if match:
            _set_once(raw, "name", match[1], number)
            _set_once(raw, "program_version", match[2], number)
            continue
        if line.startswith("about "):
            _set_once(raw, "description", _quoted(line[6:], number), number)
            continue
        match = re.fullmatch(r"input\s+([^:\s]+)\s*:\s*(\S+)", line)
        if match:
            _set_once(raw["inputs"], match[1], match[2], number)
            continue
        match = re.fullmatch(r"effect\s+([^:\s]+)\s*:\s*(\S+)\s+(\".*\")", line)
        if match:
            _set_once(raw["effects"], match[1], {"kind": match[2],
                      "description": _quoted(match[3], number)}, number)
            continue
        match = re.fullmatch(r"(choice|noul|score)\s+(\S+)\s+from\s+(.+):", line)
        if match:
            current = {"type": {"choice": "Choice", "noul": "Noul", "score": "Score"}[match[1]],
                       "uses": _names(match[3])}
            _set_once(raw["decisions"], match[2], current, number)
            current_kind = "decision"
            continue
        match = re.fullmatch(r"step\s+(\S+?)(?:\s+after\s+(.+?))?:", line)
        if match:
            current = {"name": match[1], "after": _names(match[2]) if match[2] else []}
            raw["steps"].append(current)
            current_kind = "step"
            continue
        raise ProgramError("unknown_statement", f"line {number}: {line!r}")
    return raw


def _set_once(table: dict[str, Any], key: str, value: Any, line: int) -> None:
    if key in table:
        raise ProgramError("duplicate_name", f"line {line}: duplicate {key!r}")
    table[key] = value


def _reject_unknown(table: dict[str, Any], allowed: set[str], context: str) -> None:
    unknown = sorted(set(table) - allowed)
    if unknown:
        raise ProgramError("unknown_key", f"{context} has unknown key(s): {', '.join(unknown)}")


def _check_name(name: str, context: str) -> None:
    if not _NAME_RE.fullmatch(name):
        raise ProgramError("invalid_name", f"{context} {name!r} must match {_NAME_RE.pattern}")


def _parse_inputs(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict) or not value:
        raise ProgramError("missing_inputs", "[inputs] must declare at least one input")
    inputs: dict[str, dict[str, Any]] = {}
    for name, typ in value.items():
        _check_name(name, "input")
        if typ not in FIELD_TYPES:
            raise ProgramError("invalid_type", f"input {name!r} uses unsupported type {typ!r}")
        inputs[name] = {"type": typ, "required": True}
    return inputs


def _parse_effects(value: Any) -> dict[str, dict[str, str]]:
    if not isinstance(value, dict) or not value:
        raise ProgramError("missing_effects", "[effects] must explicitly declare at least one allowed effect")
    effects: dict[str, dict[str, str]] = {}
    for name, data in value.items():
        _check_name(name, "effect")
        if not isinstance(data, dict):
            raise ProgramError("invalid_effect", f"effect {name!r} must be a table")
        _reject_unknown(data, {"kind", "description"}, f"effect {name}")
        kind = _require(data, "kind", str)
        description = _require(data, "description", str)
        if kind not in EFFECT_KINDS:
            raise ProgramError("invalid_effect_kind", f"effect {name!r} kind must be one of {sorted(EFFECT_KINDS)}")
        if not description.strip():
            raise ProgramError("invalid_effect", f"effect {name!r} description must be nonblank")
        effects[name] = {"kind": kind, "description": description}
    return effects


def _parse_steps(value: Any, effects: dict[str, Any], decisions: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ProgramError("missing_steps", "program must contain one or more [[steps]]")
    seen: set[str] = set()
    steps: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ProgramError("invalid_step", f"step {index} must be a table")
        _reject_unknown(item, {"name", "agent", "prompt", "uses", "after", "allowed_effects", "decision", "outputs"}, f"step {index}")
        name = _require(item, "name", str)
        _check_name(name, "step")
        if name in seen:
            raise ProgramError("duplicate_name", f"duplicate step name {name!r}")
        seen.add(name)
        prompt = _require(item, "prompt", str)
        if not prompt.strip():
            raise ProgramError("invalid_step", f"step {name!r} prompt must be nonblank")
        agent = item.get("agent", "meta")
        if not isinstance(agent, str) or not agent.strip():
            raise ProgramError("invalid_step", f"step {name!r} agent must be a nonblank string")
        allowed_effects = _string_list(item.get("allowed_effects", []), f"step {name} allowed_effects")
        for effect in allowed_effects:
            if effect not in effects:
                raise ProgramError("unknown_effect", f"step {name!r} grants undeclared effect {effect!r}")
        decision = item.get("decision")
        if decision is not None:
            if not isinstance(decision, str):
                raise ProgramError("invalid_step", f"step {name!r} decision must be a string")
            if decision not in decisions:
                raise ProgramError("unknown_decision", f"step {name!r} references unknown decision {decision!r}")
        outputs = _parse_outputs(item.get("outputs", {}), name)
        steps.append({
            "name": name,
            "agent": agent,
            "prompt": prompt,
            "uses": _string_list(item.get("uses", []), f"step {name} uses"),
            "after": _string_list(item.get("after", []), f"step {name} after"),
            "allowed_effects": allowed_effects,
            "decision": decision,
            "outputs": outputs,
        })
    return steps


def _parse_outputs(value: Any, step_name: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ProgramError("invalid_outputs", f"step {step_name!r} outputs must be a table")
    outputs: dict[str, str] = {}
    for name, typ in value.items():
        _check_name(name, f"step {step_name} output")
        if typ not in FIELD_TYPES:
            raise ProgramError("invalid_type", f"step {step_name!r} output {name!r} has unsupported type {typ!r}")
        outputs[name] = typ
    return outputs


def _parse_decisions(value: Any) -> dict[str, dict[str, Any]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ProgramError("invalid_decisions", "[decisions] must be a table")
    decisions: dict[str, dict[str, Any]] = {}
    for name, data in value.items():
        _check_name(name, "decision")
        if not isinstance(data, dict):
            raise ProgramError("invalid_decision", f"decision {name!r} must be a table")
        typ = data.get("type")
        if typ not in DECISION_TYPES:
            raise ProgramError("invalid_decision_type", f"decision {name!r} type must be one of {sorted(DECISION_TYPES)}")
        prompt = _require(data, "prompt", str)
        if not prompt.strip():
            raise ProgramError("invalid_decision", f"decision {name!r} prompt must be nonblank")
        base = {
            "name": name,
            "type": typ,
            "prompt": prompt,
            "uses": _string_list(data.get("uses", []), f"decision {name} uses"),
            "advisory": True,
        }
        if typ == "Choice":
            _reject_unknown(data, {"type", "prompt", "uses", "options"}, f"decision {name}")
            options = _string_list(_require(data, "options", list), f"decision {name} options", duplicate_code="invalid_choice")
            if len(options) < 2 or len(set(options)) != len(options):
                raise ProgramError("invalid_choice", f"decision {name!r} needs at least two unique options")
            base["options"] = options
        elif typ == "Noul":
            _reject_unknown(data, {"type", "prompt", "uses", "threshold"}, f"decision {name}")
            threshold = _number(_require(data, "threshold", (int, float)), f"decision {name} threshold")
            if not 0 <= threshold <= 1:
                raise ProgramError("invalid_threshold", f"decision {name!r} threshold must be within [0, 1]")
            base["threshold"] = threshold
        else:
            _reject_unknown(data, {"type", "prompt", "uses", "min", "max", "threshold", "rubric"}, f"decision {name}")
            low = _number(_require(data, "min", (int, float)), f"decision {name} min")
            high = _number(_require(data, "max", (int, float)), f"decision {name} max")
            if low >= high:
                raise ProgramError("invalid_bounds", f"decision {name!r} min must be less than max")
            base["min"] = low
            base["max"] = high
            threshold = data.get("threshold")
            if threshold is not None:
                threshold = _number(threshold, f"decision {name} threshold")
                if not low <= threshold <= high:
                    raise ProgramError("invalid_threshold", f"decision {name!r} threshold must be within score bounds")
                base["threshold"] = threshold
            rubric = data.get("rubric", "")
            if not isinstance(rubric, str):
                raise ProgramError("invalid_rubric", f"decision {name!r} rubric must be a string")
            base["rubric"] = rubric
        decisions[name] = base
    return decisions


def _require(table: dict[str, Any], key: str, expected: type | tuple[type, ...]) -> Any:
    if key not in table:
        raise ProgramError("missing_field", f"missing required field {key!r}")
    value = table[key]
    if not isinstance(value, expected) or isinstance(value, bool) and expected is not bool:
        if isinstance(expected, tuple):
            label = " or ".join(t.__name__ for t in expected)
        else:
            label = expected.__name__
        raise ProgramError("invalid_field", f"{key!r} must be {label}")
    return value


def _number(value: Any, context: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProgramError("invalid_number", f"{context} must be numeric")
    return value


def _string_list(value: Any, context: str, *, duplicate_code: str = "duplicate_name") -> list[str]:
    if not isinstance(value, list):
        raise ProgramError("invalid_list", f"{context} must be a list of strings")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise ProgramError("invalid_list", f"{context} must contain only nonempty strings")
        result.append(item)
    if len(set(result)) != len(result):
        raise ProgramError(duplicate_code, f"{context} contains duplicates")
    return result


def _check_references(inputs: dict[str, Any], steps: list[dict[str, Any]], decisions: dict[str, Any]) -> None:
    step_names = {step["name"] for step in steps}
    output_names = {step["name"]: set(step["outputs"]) for step in steps}
    completed: set[str] = set()
    completed_decisions: set[str] = set()
    for step in steps:
        for dependency in step["after"]:
            if dependency not in step_names:
                raise ProgramError("unknown_step", f"step {step['name']!r} depends on unknown step {dependency!r}")
            if dependency not in completed:
                raise ProgramError("forward_reference", f"step {step['name']!r} after must reference earlier steps")
        for reference in step["uses"]:
            _resolve_reference(reference, inputs, completed, output_names, completed_decisions, f"step {step['name']}")
        if step["decision"]:
            for reference in decisions[step["decision"]]["uses"]:
                _resolve_reference(
                    reference,
                    inputs,
                    completed | {step["name"]},
                    output_names,
                    completed_decisions,
                    f"decision {step['decision']}",
                )
            completed_decisions.add(step["decision"])
        completed.add(step["name"])


def _resolve_reference(
    reference: str,
    inputs: dict[str, Any],
    visible_steps: set[str],
    output_names: dict[str, set[str]],
    visible_decisions: set[str],
    context: str,
) -> None:
    parts = reference.split(".")
    if len(parts) < 2:
        raise ProgramError("invalid_reference", f"{context} has invalid reference {reference!r}")
    if parts[0] == "input" and len(parts) == 2:
        if parts[1] not in inputs:
            raise ProgramError("unknown_reference", f"{context} references unknown input {parts[1]!r}")
        return
    if parts[0] == "decision" and len(parts) == 2:
        if parts[1] not in visible_decisions:
            raise ProgramError("unknown_reference", f"{context} references unknown decision {parts[1]!r}")
        return
    if parts[0] == "step" and len(parts) in {2, 3}:
        step = parts[1]
        if step not in visible_steps:
            raise ProgramError("unknown_reference", f"{context} references unavailable step {step!r}")
        if len(parts) == 3 and parts[2] not in output_names[step]:
            raise ProgramError("unknown_reference", f"{context} references unknown output {reference!r}")
        return
    raise ProgramError("invalid_reference", f"{context} has invalid reference {reference!r}")
