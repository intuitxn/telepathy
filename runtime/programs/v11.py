"""nudge.transaction/v1.1 compiler: thin outer transaction.

Implements ``docs/designs/nudge-simplify.md`` §2.

Dual-run note: v1.0 (``nudge.prompt/v1`` via the external ``nudge.program_dsl``
package, used by ``cli.py``) is untouched and stays compilable read-only. This
module is the new v1.1 path. The ``schema`` string plus closed tables keep the
two worlds apart: v1.1 sources are rejected by shape (unknown ``[runtime]`` /
``[goal]`` / ``[optimization]`` tables, ``array`` type, ...).

Closed shape (§2.1/§2.2)
  File = ``+++`` TOML frontmatter ``+++`` then exactly two fences, ``system``
  then ``user``. Top-level ``schema`` must be ``"nudge.transaction/v1.1"``.
  Allowed top-level keys: ``schema`` + tables ``program`` / ``inputs`` /
  ``outputs`` / ``limits``. Anything else (``[goal]``, ``[runtime]``,
  ``[optimization]``, ``steps``, ``delegation``, pipelines, ...) is a compile
  error. §2.2's ``program`` row (``schema,name,version,description``) is
  realized as top-level ``schema`` + ``[program] name/version/description``,
  matching all three shipped programs; a ``schema`` key *inside* ``[program]``
  is rejected as unknown.
  Only blank lines may appear outside the fences (closed world). TOML ``#``
  comments inside frontmatter are allowed; they are frozen (visible to
  ``frozen_digest``) but normalized out of the canonical bytes behind
  ``package_digest``. Bodies may not contain a line starting with ````` `` ``
  (standard fence ambiguity); such a line is a compile error.

Types (§2.3): ``"string" | "string[]" | "int" | "bool"`` (``array`` rejected
with a hint). Every declared field is required: runtime inputs/outputs must
contain exactly the declared fields. ``string[]`` elements are strings,
each <= 4096 chars, <= 512 elements.

Reserved names (§2.3): ``source``, ``parentDigest``, ``candidateDigest``,
``reviewer``, ``approval`` belong to the promotion envelope, never to model
I/O, and are rejected as field names — with one one-release semantic
exception: ``lesson-proposal`` inputs ``source`` / ``parentDigest`` are
accepted. Mapping: ``lesson-proposal``'s ``source`` input carries the *parent*
program source (semantically ``parentSource`` in ``lesson-review`` terms); it
is grandfathered for one release so the shipped ``lesson-proposal`` contract
does not churn mid-release. The exception applies only to ``inputs`` of the
program named exactly ``lesson-proposal``; its outputs, and every other
program, still reject all reserved names.

Template vars (§2.4): ``{{ var }}`` may reference only a declared input of the
same program. ``{{ x | filter }}``, ``{% ... %}``, ``{# ... #}``, empty,
dotted, or unclosed/stray braces are compile errors. ``string[]`` renders as
a comma-joined, bracket-free list (see :func:`render_prompt`).

Limits (§2.5): all optional, omitted = default; out-of-range or unknown keys
are compile errors. ``max_turns``/``max_model_calls`` are fixed at 1: one
model call per transaction.

Frozen vs mutable (§2.6): frozen = every byte except the inner text of the
two fences. :func:`frozen_source_v11` masks both bodies with
``<PROMPT-CONTENT>\\n``; byte-exact comparison of that projection is the
frozen-contract check. Note the deliberate §2.6/§2.7 tension this implements:
the masked projection is byte-exact (a TOML key reorder or an
omitted→explicit-default limit rewrite changes ``frozen_digest``) while
``package_digest`` is canonical (those rewrites keep it). Only fence-inner
edits give "same contract, new wording" (frozen equal, package differs).

Canonical bytes (§2.7): UTF-8 no BOM, ``\\n`` endings, exactly one trailing
``\\n``; ``schema`` line, ``[program]`` in fixed order
``name,version,description``, ``[inputs]``/``[outputs]`` sorted
lexicographically, ``[limits]`` with effective (default-filled) values sorted,
one ``key = value`` per line, double-quoted strings; exact fence headers and
`` ``` `` closers; fence bodies verbatim. ``package_digest`` is sha256 over
those bytes; ``frozen_digest`` is sha256 over the normalized masked
projection. Both render as ``sha256:<hex>``.
"""

from __future__ import annotations

import hashlib
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "SCHEMA",
    "FIELD_TYPES",
    "LIMIT_DEFAULTS",
    "LIMIT_RANGES",
    "RESERVED_FIELDS",
    "LESSON_PROPOSAL",
    "LESSON_PROPOSAL_INPUT_EXCEPTION",
    "V11CompileError",
    "V11ValidationError",
    "V11Bundle",
    "compile_v11",
    "compile_file",
    "frozen_source_v11",
    "canonical_bytes_v11",
    "validate_inputs",
    "validate_outputs",
    "render_prompt",
]

SCHEMA = "nudge.transaction/v1.1"

FIELD_TYPES = ("string", "string[]", "int", "bool")

LIMIT_DEFAULTS = {
    "max_turns": 1,
    "max_model_calls": 1,
    "max_input_chars": 30000,
    "max_output_chars": 12000,
    "timeout_s": 90,
    "max_event_bytes": 262144,
}

LIMIT_RANGES = {
    "max_turns": (1, 1),
    "max_model_calls": (1, 1),
    "max_input_chars": (1, 50000),
    "max_output_chars": (1, 32000),
    "timeout_s": (1, 300),
    "max_event_bytes": (1, 1048576),
}

RESERVED_FIELDS = frozenset({"source", "parentDigest", "candidateDigest", "reviewer", "approval"})

LESSON_PROPOSAL = "lesson-proposal"
# One-release exception: lesson-proposal inputs `source` (= parentSource: the
# parent program source under review) and `parentDigest` stay accepted.
LESSON_PROPOSAL_INPUT_EXCEPTION = frozenset({"source", "parentDigest"})

STRING_ARRAY_MAX_ELEMENTS = 512
STRING_ARRAY_MAX_ELEMENT_CHARS = 4096

_NAME_RE = re.compile(r"[a-z][a-z0-9-]{1,63}")
_VERSION_RE = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")
_FIELD_NAME_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
_TEMPLATE_RE = re.compile(r"\{\{([^{}]*)\}\}")

_MASK_LINE = "<PROMPT-CONTENT>"
_SYSTEM_HEADER = "```nudge-prompt system"
_USER_HEADER = "```nudge-prompt user"
_FENCE_CLOSE = "```"


class V11CompileError(ValueError):
    """v1.1 shape/contract violation. ``code`` is stable for tests."""

    def __init__(self, message: str, code: str):
        super().__init__(f"{code}: {message}")
        self.code = code


class V11ValidationError(ValueError):
    """Runtime input/output data violates the compiled contract."""

    def __init__(self, message: str, code: str):
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass
class V11Bundle:
    name: str
    version: str
    description: str
    inputs: dict
    outputs: dict
    limits: dict  # effective values, defaults filled
    system: str  # verbatim system fence body (ends with "\n")
    user: str  # verbatim user fence body (ends with "\n")
    canonical: bytes
    package_digest: str
    frozen_digest: str
    frozen_source: str


def _fail(message: str, code: str) -> V11CompileError:
    return V11CompileError(message, code)


def _normalize(source) -> str:
    if isinstance(source, (bytes, bytearray)):
        try:
            text = bytes(source).decode("utf-8-sig")  # strips BOM if present
        except UnicodeDecodeError as error:
            raise _fail(f"source is not valid UTF-8: {error}", "invalid_encoding")
    elif isinstance(source, str):
        text = source[1:] if source.startswith("﻿") else source
    else:
        raise _fail(f"expected str or bytes, got {type(source).__name__}", "not_v11_source")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _toml_quote(value: str) -> str:
    out = []
    for char in value:
        ordinal = ord(char)
        if char == '"':
            out.append('\\"')
        elif char == "\\":
            out.append("\\\\")
        elif char == "\t":
            out.append("\\t")
        elif char == "\b":
            out.append("\\b")
        elif char == "\f":
            out.append("\\f")
        elif ordinal < 0x20:
            out.append(f"\\u{ordinal:04X}")
        else:
            out.append(char)
    return '"' + "".join(out) + '"'


def _parse_fields(kind: str, value, program_name: str) -> dict:
    if not isinstance(value, dict) or not value:
        raise _fail(f"[{kind}] must declare at least one field", f"empty_{kind}")
    if program_name == LESSON_PROPOSAL and kind == "inputs":
        allowed_reserved = LESSON_PROPOSAL_INPUT_EXCEPTION
    else:
        allowed_reserved = frozenset()
    fields = {}
    for field_name, field_type in value.items():
        if not isinstance(field_name, str) or not _FIELD_NAME_RE.fullmatch(field_name):
            raise _fail(f"[{kind}] invalid field name {field_name!r}", "invalid_field_name")
        if field_type not in FIELD_TYPES:
            hint = ' did you mean "string[]"' if field_type == "array" else ""
            raise _fail(f"[{kind}] {field_name!r} has unknown type {field_type!r}{hint}", "invalid_field_type")
        if field_name in RESERVED_FIELDS and field_name not in allowed_reserved:
            raise _fail(
                f"[{kind}] {field_name!r} is reserved for the promotion envelope, never model I/O",
                "reserved_field",
            )
        fields[field_name] = field_type
    return fields


def _parse_limits(value) -> dict:
    if value is None:
        return dict(LIMIT_DEFAULTS)
    if not isinstance(value, dict):
        raise _fail("[limits] must be a table", "invalid_limit")
    for key in value:
        if key not in LIMIT_DEFAULTS:
            raise _fail(f"[limits] unknown key {key!r}", "unknown_limit")
    effective = dict(LIMIT_DEFAULTS)
    for key, item in value.items():
        if type(item) is not int:
            raise _fail(f"[limits] {key} must be an integer, got {item!r}", "invalid_limit")
        low, high = LIMIT_RANGES[key]
        if not (low <= item <= high):
            raise _fail(f"[limits] {key}={item} outside range {low}-{high}", "invalid_limit")
        effective[key] = item
    return effective


def _find_closer(lines: list, header_index: int) -> int:
    for index in range(header_index + 1, len(lines)):
        line = lines[index]
        if line == _FENCE_CLOSE:
            return index
        if line.lstrip().startswith("```"):
            raise _fail(f"malformed fence line {index + 1}: {line!r}", "malformed_fence")
    raise _fail("unclosed nudge-prompt fence", "missing_fences")


def _body_of(lines: list, header_index: int, close_index: int, role: str) -> str:
    if close_index == header_index + 1:
        raise _fail(f"empty {role} prompt fence", "empty_prompt_fence")
    return "\n".join(lines[header_index + 1 : close_index]) + "\n"


def _parse_fences(lines: list, start: int):
    total = len(lines)
    index = start
    while index < total and lines[index].strip() == "":
        index += 1
    if index >= total or lines[index] != _SYSTEM_HEADER:
        raise _fail("expected exactly '```nudge-prompt system' first", "missing_fences")
    sys_header = index
    sys_close = _find_closer(lines, sys_header)
    system = _body_of(lines, sys_header, sys_close, "system")
    index = sys_close + 1
    while index < total and lines[index].strip() == "":
        index += 1
    if index >= total or lines[index] != _USER_HEADER:
        raise _fail("expected exactly '```nudge-prompt user' second, in order", "unexpected_fence")
    user_header = index
    user_close = _find_closer(lines, user_header)
    user = _body_of(lines, user_header, user_close, "user")
    for rest in range(user_close + 1, total):
        if lines[rest].strip() != "":
            raise _fail(f"content outside prompt fences at line {rest + 1}", "content_outside_fences")
    return system, user, sys_header, sys_close, user_header, user_close


def _check_templates(body: str, declared: dict, role: str) -> None:
    if "{%" in body or "{#" in body:
        raise _fail(f"{role} fence uses template logic; only {{{{ var }}}} allowed", "template_logic_not_allowed")
    for match in _TEMPLATE_RE.finditer(body):
        inner = match.group(1).strip()
        if not _FIELD_NAME_RE.fullmatch(inner):
            raise _fail(f"{role} fence has non-{{{{ var }}}} template syntax {{{{{match.group(1)}}}}}", "invalid_template_syntax")
        if inner not in declared:
            raise _fail(f"{role} fence references undeclared input {{{{ {inner} }}}} ", "unknown_template_var")
    remainder = _TEMPLATE_RE.sub("", body)
    if "{{" in remainder or "}}" in remainder:
        raise _fail(f"{role} fence has unclosed or stray template braces", "unclosed_template")


def _parse(source, expected_name=None):
    text = _normalize(source)
    lines = text.split("\n")
    if not lines or lines[0] != "+++":
        raise _fail("first line must be exactly '+++'", "missing_frontmatter")
    try:
        close = lines.index("+++", 1)
    except ValueError:
        raise _fail("TOML frontmatter never closed with '+++'", "unclosed_frontmatter")
    try:
        doc = tomllib.loads("\n".join(lines[1:close]))
    except tomllib.TOMLDecodeError as error:
        raise _fail(f"invalid TOML frontmatter: {error}", "invalid_toml")
    if not isinstance(doc, dict):
        raise _fail("frontmatter must be TOML tables", "invalid_toml")

    allowed_top = {"schema", "program", "inputs", "outputs", "limits"}
    for key in doc:
        if key not in allowed_top:
            raise _fail(f"unknown table or key {key!r}", "unknown_table_or_key")
    for required in ("schema", "program", "inputs", "outputs"):
        if required not in doc:
            raise _fail(f"missing required {required!r}", "missing_required")
    if doc["schema"] != SCHEMA:
        raise _fail(f'schema must be exactly "{SCHEMA}", got {doc["schema"]!r}', "wrong_schema")

    program = doc["program"]
    if not isinstance(program, dict):
        raise _fail("[program] must be a table", "missing_required")
    for key in program:
        if key not in ("name", "version", "description"):
            raise _fail(f"[program] unknown key {key!r}", "unknown_table_or_key")
    for required in ("name", "version", "description"):
        if required not in program:
            raise _fail(f"[program] missing {required!r}", "missing_required")
    name, version, description = program["name"], program["version"], program["description"]
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise _fail(f"[program] invalid name {name!r}", "invalid_name")
    if expected_name is not None and name != expected_name:
        raise _fail(f"program name {name!r} does not match file stem {expected_name!r}", "name_mismatch")
    if not isinstance(version, str) or not _VERSION_RE.fullmatch(version):
        raise _fail(f"[program] invalid version {version!r}", "invalid_version")
    if not isinstance(description, str) or not description or len(description) > 280:
        raise _fail("[program] description must be 1-280 chars", "invalid_description")
    if "\n" in description or "\r" in description:
        raise _fail("[program] description must be one line", "invalid_description")

    inputs = _parse_fields("inputs", doc["inputs"], name)
    outputs = _parse_fields("outputs", doc["outputs"], name)
    limits = _parse_limits(doc.get("limits"))

    system, user, sys_header, sys_close, user_header, user_close = _parse_fences(lines, close + 1)
    _check_templates(system, inputs, "system")
    _check_templates(user, inputs, "user")

    return {
        "name": name,
        "version": version,
        "description": description,
        "inputs": inputs,
        "outputs": outputs,
        "limits": limits,
        "system": system,
        "user": user,
        "lines": lines,
        "fence_index": (sys_header, sys_close, user_header, user_close),
    }


def _frozen_text(lines: list, fence_index) -> str:
    sys_header, sys_close, user_header, user_close = fence_index
    masked = (
        lines[: sys_header + 1]
        + [_MASK_LINE]
        + lines[sys_close : user_header + 1]
        + [_MASK_LINE]
        + lines[user_close:]
    )
    return "\n".join(masked).rstrip("\n") + "\n"


def _digest(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def frozen_source_v11(source) -> str:
    """Masked frozen projection: fence bodies replaced by ``<PROMPT-CONTENT>``.

    Newline-normalized (CRLF→LF, exactly one trailing newline) so equivalent
    files compare equal. Byte-exact otherwise: any non-fence byte change is a
    frozen-contract change.
    """
    parsed = _parse(source)
    return _frozen_text(parsed["lines"], parsed["fence_index"])


def _canonical_text(name, version, description, inputs, outputs, limits, system, user) -> str:
    head = [
        "+++",
        f'schema = "{SCHEMA}"',
        "",
        "[program]",
        f"name = {_toml_quote(name)}",
        f"version = {_toml_quote(version)}",
        f"description = {_toml_quote(description)}",
        "",
        "[inputs]",
    ]
    for key in sorted(inputs):
        head.append(f'{key} = "{inputs[key]}"')
    head.append("")
    head.append("[outputs]")
    for key in sorted(outputs):
        head.append(f'{key} = "{outputs[key]}"')
    head.append("")
    head.append("[limits]")
    for key in sorted(limits):
        head.append(f"{key} = {limits[key]}")
    head.append("+++")
    text = "\n".join(head) + "\n\n"
    if not system.endswith("\n"):
        system += "\n"
    if not user.endswith("\n"):
        user += "\n"
    text += _SYSTEM_HEADER + "\n" + system + _FENCE_CLOSE + "\n\n"
    text += _USER_HEADER + "\n" + user + _FENCE_CLOSE + "\n"
    return text


def canonical_bytes_v11(source) -> bytes:
    """Canonical bytes behind ``package_digest`` (§2.7)."""
    parsed = _parse(source)
    return _canonical_text(
        parsed["name"],
        parsed["version"],
        parsed["description"],
        parsed["inputs"],
        parsed["outputs"],
        parsed["limits"],
        parsed["system"],
        parsed["user"],
    ).encode("utf-8")


def compile_v11(source, expected_name=None) -> V11Bundle:
    """Compile a v1.1 source to an immutable bundle with dual digests."""
    parsed = _parse(source, expected_name)
    canonical = _canonical_text(
        parsed["name"],
        parsed["version"],
        parsed["description"],
        parsed["inputs"],
        parsed["outputs"],
        parsed["limits"],
        parsed["system"],
        parsed["user"],
    ).encode("utf-8")
    frozen = _frozen_text(parsed["lines"], parsed["fence_index"])
    return V11Bundle(
        name=parsed["name"],
        version=parsed["version"],
        description=parsed["description"],
        inputs=dict(parsed["inputs"]),
        outputs=dict(parsed["outputs"]),
        limits=dict(parsed["limits"]),
        system=parsed["system"],
        user=parsed["user"],
        canonical=canonical,
        package_digest="sha256:" + hashlib.sha256(canonical).hexdigest(),
        frozen_digest=_digest(frozen),
        frozen_source=frozen,
    )


def compile_file(path) -> V11Bundle:
    """Compile a ``*.nudge.md`` file; program name must equal the file stem."""
    target = Path(path)
    filename = target.name
    if filename.endswith(".nudge.md"):
        stem = filename[: -len(".nudge.md")]
    else:
        stem = target.stem
    return compile_v11(target.read_bytes(), expected_name=stem)


def _check_value(field_name: str, field_type: str, value, kind: str):
    if field_type == "string":
        if not isinstance(value, str):
            raise V11ValidationError(f"{kind} field {field_name!r} must be a string", "wrong_type")
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise V11ValidationError(f"{kind} field {field_name!r} is not valid UTF-8", "invalid_utf8")
        return len(value)
    if field_type == "string[]":
        if not isinstance(value, list):
            raise V11ValidationError(f"{kind} field {field_name!r} must be a string list", "wrong_type")
        if len(value) > STRING_ARRAY_MAX_ELEMENTS:
            raise V11ValidationError(
                f"{kind} field {field_name!r} has {len(value)} elements, max {STRING_ARRAY_MAX_ELEMENTS}",
                "too_many_elements",
            )
        total = 0
        for element in value:
            if not isinstance(element, str):
                raise V11ValidationError(f"{kind} field {field_name!r} elements must be strings", "wrong_type")
            if len(element) > STRING_ARRAY_MAX_ELEMENT_CHARS:
                raise V11ValidationError(
                    f"{kind} field {field_name!r} element exceeds {STRING_ARRAY_MAX_ELEMENT_CHARS} chars",
                    "oversize_element",
                )
            try:
                element.encode("utf-8")
            except UnicodeEncodeError:
                raise V11ValidationError(f"{kind} field {field_name!r} is not valid UTF-8", "invalid_utf8")
            total += len(element)
        return total
    if field_type == "int":
        if type(value) is not int:
            raise V11ValidationError(f"{kind} field {field_name!r} must be an int", "wrong_type")
        return 0
    if field_type == "bool":
        if type(value) is not bool:
            raise V11ValidationError(f"{kind} field {field_name!r} must be a bool", "wrong_type")
        return 0
    raise V11ValidationError(f"{kind} field {field_name!r} has unknown type", "wrong_type")  # unreachable


def _check_data(bundle: V11Bundle, data: dict, declared: dict, budget: int, kind: str) -> dict:
    if not isinstance(data, dict):
        raise V11ValidationError(f"{kind} data must be an object", "wrong_type")
    missing = set(declared) - set(data)
    if missing:
        raise V11ValidationError(f"{kind} missing fields {sorted(missing)}", "missing_field")
    extra = set(data) - set(declared)
    if extra:
        raise V11ValidationError(f"{kind} extra fields {sorted(extra)}", "extra_field")
    total = 0
    for field_name, field_type in declared.items():
        total += _check_value(field_name, field_type, data[field_name], kind)
    if total > budget:
        raise V11ValidationError(f"{kind} total {total} chars exceeds limit {budget}", "total_limit_exceeded")
    return dict(data)


def validate_inputs(bundle: V11Bundle, data: dict) -> dict:
    """Inputs must contain exactly the declared fields with correct types."""
    return _check_data(bundle, data, bundle.inputs, bundle.limits["max_input_chars"], "inputs")


def validate_outputs(bundle: V11Bundle, data: dict) -> dict:
    """Outputs must contain exactly the declared fields with correct types."""
    return _check_data(bundle, data, bundle.outputs, bundle.limits["max_output_chars"], "outputs")


def _render_template(body: str, data: dict, declared: dict) -> str:
    def emit(match):
        field_name = match.group(1).strip()
        value = data[field_name]
        if declared[field_name] == "string[]":
            return ", ".join(value)
        return str(value)

    return _TEMPLATE_RE.sub(emit, body)


def render_prompt(bundle: V11Bundle, inputs: dict) -> dict:
    """Validate inputs, then render both fences.

    ``string[]`` interpolates as a comma-joined, bracket-free list so host
    and model see identical text (§2.4).
    """
    data = validate_inputs(bundle, inputs)
    return {
        "system": _render_template(bundle.system, data, bundle.inputs),
        "user": _render_template(bundle.user, data, bundle.inputs),
    }
