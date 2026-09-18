"""Tests for the nudge.transaction/v1.1 compiler (v11.py).

Covers §2: canonicalization vectors (CRLF / trailing-newline / reordered
keys), fence-only edits keeping frozen_digest, reserved-name rejection (+ the
one-release lesson-proposal exception), unknown-var / template-logic
rejection, closed-shape rejection, and exact-field runtime validation.
"""
import re
import unittest
from pathlib import Path

import v11
from v11 import (
    V11CompileError,
    V11ValidationError,
    compile_v11,
    compile_file,
)

ROOT = Path(__file__).resolve().parents[2]
PROGRAMS = ROOT / "programs"


def read_program(name):
    return (PROGRAMS / (name + ".nudge.md")).read_text()


def digest_shape(value):
    return re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def with_input_field(source, line):
    return source.replace("[inputs]\n", "[inputs]\n" + line + "\n", 1)


def with_output_field(source, line):
    return source.replace("[outputs]\n", "[outputs]\n" + line + "\n", 1)


class ShippedPrograms(unittest.TestCase):
    NAMES = ["artifact-design", "lesson-proposal", "lesson-review"]

    def test_all_shipped_programs_compile(self):
        for name in self.NAMES:
            bundle = compile_file(PROGRAMS / (name + ".nudge.md"))
            self.assertEqual(bundle.name, name)
            self.assertTrue(digest_shape(bundle.package_digest))
            self.assertTrue(digest_shape(bundle.frozen_digest))

    def test_compile_deterministic(self):
        for name in self.NAMES:
            first = compile_v11(read_program(name))
            second = compile_v11(read_program(name))
            self.assertEqual(first.package_digest, second.package_digest)
            self.assertEqual(first.frozen_digest, second.frozen_digest)
            self.assertEqual(first.canonical, second.canonical)

    def test_omitted_limits_mean_defaults(self):
        bundle = compile_v11(read_program("artifact-design"))
        self.assertEqual(bundle.limits, v11.LIMIT_DEFAULTS)
        self.assertIsNot(bundle.limits, v11.LIMIT_DEFAULTS)  # effective copy, not alias

    def test_lesson_proposal_exception_accepted(self):
        bundle = compile_v11(read_program("lesson-proposal"))
        self.assertIn("source", bundle.inputs)
        self.assertIn("parentDigest", bundle.inputs)

    def test_name_must_equal_file_stem(self):
        source = read_program("artifact-design")
        compile_v11(source, expected_name="artifact-design")
        with self.assertRaises(V11CompileError):
            compile_v11(source, expected_name="other-name")


class Canonicalization(unittest.TestCase):
    def setUp(self):
        self.base = read_program("artifact-design")
        self.bundle = compile_v11(self.base)

    def test_crlf_identical_package_digest(self):
        variant = self.base.replace("\n", "\r\n")
        self.assertEqual(compile_v11(variant).package_digest, self.bundle.package_digest)

    def test_missing_trailing_newline_identical_package_digest(self):
        self.assertTrue(self.base.endswith("\n"))
        variant = self.base.rstrip("\n")
        self.assertEqual(compile_v11(variant).package_digest, self.bundle.package_digest)

    def test_reordered_keys_identical_package_digest(self):
        system_body, user_body = self._bodies()
        reordered = (
            "+++\n"
            'schema = "nudge.transaction/v1.1"\n'
            "\n"
            "[outputs]\n"
            'body = "string"\n'
            'title = "string"\n'
            "\n"
            "[program]\n"
            'description = "Design a readable artifact from supplied evidence."\n'
            'version = "0.2.0"\n'
            'name = "artifact-design"\n'
            "\n"
            "[inputs]\n"
            'sourceIds = "string[]"\n'
            'body = "string"\n'
            'title = "string"  # reordered keys still parse\n'
            "\n"
            "[limits]\n"
            "# reordered tables still parse\n"
            "+++\n"
            "\n```nudge-prompt system\n" + system_body
            + "```\n\n```nudge-prompt user\n" + user_body + "```\n"
        )
        self.assertEqual(compile_v11(reordered).package_digest, self.bundle.package_digest)

    def test_explicit_defaults_identical_package_digest(self):
        explicit = self.base.replace(
            "[limits]\n# all defaults; omitted keys",
            "[limits]\nmax_turns = 1\nmax_model_calls = 1\nmax_input_chars = 30000\n"
            "max_output_chars = 12000\ntimeout_s = 90\nmax_event_bytes = 262144\n# explicit",
        )
        self.assertEqual(compile_v11(explicit).package_digest, self.bundle.package_digest)

    def test_canonical_bytes_pinned_shape(self):
        text = self.bundle.canonical.decode("utf-8")
        self.assertNotIn("\r", text)
        self.assertTrue(text.endswith("```\n") and not text.endswith("\n\n"))
        program_block = (
            "[program]\nname = \"artifact-design\"\nversion = \"0.2.0\"\n"
            'description = "Design a readable artifact from supplied evidence."\n'
        )
        self.assertIn(program_block, text)
        # inputs sorted lexicographically: body, sourceIds, title
        self.assertLess(text.index('body = "string"'), text.index('sourceIds = "string[]"'))
        self.assertLess(text.index('sourceIds = "string[]"'), text.index('title = "string"'))
        for key in sorted(v11.LIMIT_DEFAULTS):
            self.assertIn(f"{key} = {v11.LIMIT_DEFAULTS[key]}", text)
        self.assertIn("```nudge-prompt system\n", text)
        self.assertIn("```nudge-prompt user\n", text)

    def test_fence_only_edit_keeps_frozen_digest(self):
        edited = self.base.replace("Keep output concise.", "Keep output concise. Prefer short paragraphs.")
        candidate = compile_v11(edited)
        self.assertEqual(candidate.frozen_digest, self.bundle.frozen_digest)
        self.assertEqual(candidate.frozen_source, self.bundle.frozen_source)
        self.assertNotEqual(candidate.package_digest, self.bundle.package_digest)

    def test_user_fence_only_edit_keeps_frozen_digest(self):
        edited = self.base.replace("Title: {{ title }}", "Title: {{ title }}!")
        candidate = compile_v11(edited)
        self.assertEqual(candidate.frozen_digest, self.bundle.frozen_digest)
        self.assertNotEqual(candidate.package_digest, self.bundle.package_digest)

    def test_contract_change_moves_frozen_digest(self):
        changed = with_input_field(self.base, 'flag = "bool"')
        candidate = compile_v11(changed)
        self.assertNotEqual(candidate.frozen_digest, self.bundle.frozen_digest)
        self.assertNotEqual(candidate.package_digest, self.bundle.package_digest)

    def _bodies(self):
        system_body = self.base.split("```nudge-prompt system\n", 1)[1].split("\n```", 1)[0] + "\n"
        user_body = self.base.split("```nudge-prompt user\n", 1)[1].rsplit("\n```", 1)[0] + "\n"
        return system_body, user_body


class ReservedNames(unittest.TestCase):
    def test_reserved_rejected_for_plain_program(self):
        base = read_program("artifact-design")
        for reserved in ["source", "parentDigest", "candidateDigest", "reviewer", "approval"]:
            with self.assertRaises(V11CompileError, msg=f"inputs {reserved}"):
                compile_v11(with_input_field(base, f'{reserved} = "string"'))
            with self.assertRaises(V11CompileError, msg=f"outputs {reserved}"):
                compile_v11(with_output_field(base, f'{reserved} = "string"'))

    def test_lesson_proposal_rejects_other_reserved(self):
        base = read_program("lesson-proposal")
        for reserved in ["candidateDigest", "reviewer", "approval"]:
            with self.assertRaises(V11CompileError, msg=f"inputs {reserved}"):
                compile_v11(with_input_field(base, f'{reserved} = "string"'))
        # exception covers inputs only: source/parentDigest in outputs still rejected
        with self.assertRaises(V11CompileError):
            compile_v11(with_output_field(base, 'source = "string"'))
        with self.assertRaises(V11CompileError):
            compile_v11(with_output_field(base, 'parentDigest = "string"'))

    def test_lesson_review_rejects_source(self):
        base = read_program("lesson-review")
        with self.assertRaises(V11CompileError):
            compile_v11(with_input_field(base, 'source = "string"'))
        # parentSource is an ordinary (non-reserved) name and stays legal
        bundle = compile_v11(base)
        self.assertIn("parentSource", bundle.inputs)


class TemplateClosure(unittest.TestCase):
    def test_unknown_var_rejected(self):
        base = read_program("artifact-design")
        with self.assertRaises(V11CompileError) as caught:
            compile_v11(base.replace("{{ body }}", "{{ secret }}"))
        self.assertEqual(caught.exception.code, "unknown_template_var")

    def test_filter_syntax_rejected(self):
        base = read_program("artifact-design")
        with self.assertRaises(V11CompileError):
            compile_v11(base.replace("{{ body }}", "{{ body | upper }}"))

    def test_logic_tag_rejected(self):
        base = read_program("artifact-design")
        edited = base.replace("Keep output concise.", "{% if title %}Keep output concise.{% endif %}")
        with self.assertRaises(V11CompileError) as caught:
            compile_v11(edited)
        self.assertEqual(caught.exception.code, "template_logic_not_allowed")

    def test_unclosed_brace_rejected(self):
        base = read_program("artifact-design")
        with self.assertRaises(V11CompileError):
            compile_v11(base.replace("{{ body }}", "{{ body }"))

    def test_rendering_rule_comma_joins_arrays(self):
        # No shipped fence interpolates a string[] (IDs stay out of context
        # per §2 Example B), so declare one on a variant and check the rule.
        source = with_input_field(read_program("artifact-design"), 'tags = "string[]"')
        source = source.replace("Body: {{ body }}", "Body: {{ body }}\nTags: {{ tags }}")
        bundle = compile_v11(source)
        rendered = v11.render_prompt(
            bundle, {"title": "T", "body": "B", "sourceIds": ["a"], "tags": ["x", "y"]})
        self.assertIn("Tags: x, y", rendered["user"])
        self.assertNotIn("[x", rendered["user"])
        self.assertNotIn("{{", rendered["user"])
        self.assertNotIn("{{", rendered["system"])


class ClosedShape(unittest.TestCase):
    def setUp(self):
        self.base = read_program("artifact-design")

    def test_v10_shape_rejected(self):
        v10ish = (
            "+++\n"
            'schema = "nudge.prompt/v1"\n'
            'name = "artifact-design"\n'
            'version = "0.1.0"\n'
            "\n"
            "[goal]\n"
            'id = "artifact-design"\n'
            'description = "Design a readable artifact."\n'
            "\n"
            "[inputs]\n"
            'title = "string"\n'
            'sourceIds = "array"\n'
            "\n"
            "[outputs]\n"
            'title = "string"\n'
            "\n"
            "[runtime]\n"
            'protocol = "nudge.harness/v1"\n'
            'model = "reasoner"\n'
            "\n"
            "[limits]\n"
            "max_turns = 1\n"
            "+++\n"
            "\n```nudge-prompt system\nDo work.\n```\n\n```nudge-prompt user\nTitle: {{ title }}\n```\n"
        )
        with self.assertRaises(V11CompileError):
            compile_v11(v10ish)

    def test_runtime_table_rejected(self):
        edited = self.base.replace("[limits]\n# all", '[runtime]\nmodel = "reasoner"\n\n[limits]\n# all')
        with self.assertRaises(V11CompileError) as caught:
            compile_v11(edited)
        self.assertEqual(caught.exception.code, "unknown_table_or_key")

    def test_goal_and_optimization_tables_rejected(self):
        for table in ["[goal]", "[optimization]"]:
            edited = self.base.replace("[limits]", table + '\nx = "y"\n\n[limits]')
            with self.assertRaises(V11CompileError, msg=table):
                compile_v11(edited)

    def test_array_type_rejected_with_hint(self):
        edited = self.base.replace('sourceIds = "string[]"', 'sourceIds = "array"')
        with self.assertRaises(V11CompileError) as caught:
            compile_v11(edited)
        self.assertEqual(caught.exception.code, "invalid_field_type")
        self.assertIn("string[]", str(caught.exception))

    def test_assistant_fence_rejected(self):
        edited = self.base.replace("```nudge-prompt user", "```nudge-prompt assistant")
        with self.assertRaises(V11CompileError):
            compile_v11(edited)

    def test_extra_fence_rejected(self):
        edited = self.base + '\n```nudge-prompt user\nRepeat: {{ title }}\n```\n'
        with self.assertRaises(V11CompileError):
            compile_v11(edited)

    def test_swapped_fence_order_rejected(self):
        system_block = "```nudge-prompt system\nEdit text.\n```"
        user_block = "```nudge-prompt user\nTitle: {{ title }}\nBody: {{ body }}\n```"
        head, _, _ = self.base.partition("```nudge-prompt system")
        edited = head + user_block + "\n\n" + system_block + "\n"
        with self.assertRaises(V11CompileError):
            compile_v11(edited)

    def test_bad_schema_version_name_description_rejected(self):
        cases = [
            self.base.replace('schema = "nudge.transaction/v1.1"', 'schema = "nudge.prompt/v1"'),
            self.base.replace('version = "0.2.0"', 'version = "0.2"'),
            self.base.replace('name = "artifact-design"', 'name = "Artifact_Design"'),
            self.base.replace(
                'description = "Design a readable artifact from supplied evidence."',
                'description = "' + "x" * 281 + '"',
            ),
            self.base.replace(
                "[limits]\n# all",
                "[limits]\nmax_turns = 2\n# all",
            ),
            self.base.replace(
                "[limits]\n# all",
                "[limits]\nmax_turns = 0\n# all",
            ),
            self.base.replace(
                "[limits]\n# all",
                "[limits]\nmax_input_chars = 99999999\n# all",
            ),
            self.base.replace(
                "[limits]\n# all",
                "[limits]\nmax_retries = 3\n# all",
            ),
        ]
        for index, case in enumerate(cases):
            with self.assertRaises(V11CompileError, msg=f"case {index}"):
                compile_v11(case)

    def test_prose_outside_fences_rejected(self):
        edited = self.base.replace(
            "```nudge-prompt system", "A stray paragraph.\n\n```nudge-prompt system")
        with self.assertRaises(V11CompileError):
            compile_v11(edited)


class ExactFieldValidation(unittest.TestCase):
    def setUp(self):
        self.bundle = compile_v11(read_program("artifact-design"))
        self.good_inputs = {"title": "T", "body": "B", "sourceIds": ["a"]}
        self.good_output = {"title": "T", "body": "B"}

    def test_valid_inputs_and_outputs_pass(self):
        self.assertEqual(v11.validate_inputs(self.bundle, self.good_inputs), self.good_inputs)
        self.assertEqual(v11.validate_outputs(self.bundle, self.good_output), self.good_output)

    def test_missing_and_extra_input_fields_fail(self):
        with self.assertRaises(V11ValidationError) as caught:
            v11.validate_inputs(self.bundle, {"title": "x", "body": "x"})
        self.assertEqual(caught.exception.code, "missing_field")
        with self.assertRaises(V11ValidationError) as caught:
            v11.validate_inputs(self.bundle, dict(self.good_inputs, approved=True))
        self.assertEqual(caught.exception.code, "extra_field")

    def test_missing_extra_and_wrong_output_fields_fail(self):
        for output in [{"title": "x"}, {"title": "x", "body": "x", "approved": True}, {"title": 7, "body": "x"}]:
            with self.assertRaises(V11ValidationError, msg=str(output)):
                v11.validate_outputs(self.bundle, output)

    def test_bool_is_not_int_and_int_is_not_bool(self):
        bundle = compile_v11(with_input_field(read_program("artifact-design"), 'flag = "bool"')
                             .replace('sourceIds = "string[]"', 'sourceIds = "string[]"\ncount = "int"'))
        good = dict(self.good_inputs, flag=True, count=3)
        v11.validate_inputs(bundle, good)
        with self.assertRaises(V11ValidationError):
            v11.validate_inputs(bundle, dict(good, flag=1))
        with self.assertRaises(V11ValidationError):
            v11.validate_inputs(bundle, dict(good, count=True))

    def test_string_array_bounds(self):
        with self.assertRaises(V11ValidationError):
            v11.validate_inputs(self.bundle, dict(self.good_inputs, sourceIds=["ok", 7]))
        with self.assertRaises(V11ValidationError):
            v11.validate_inputs(self.bundle, dict(self.good_inputs, sourceIds=["x"] * 513))
        with self.assertRaises(V11ValidationError):
            v11.validate_inputs(self.bundle, dict(self.good_inputs, sourceIds=["x" * 4097]))

    def test_total_input_chars_bound(self):
        oversize = dict(self.good_inputs, title="x" * 30001)
        with self.assertRaises(V11ValidationError) as caught:
            v11.validate_inputs(self.bundle, oversize)
        self.assertEqual(caught.exception.code, "total_limit_exceeded")

    def test_render_rejects_bad_inputs_before_use(self):
        with self.assertRaises(V11ValidationError):
            v11.render_prompt(self.bundle, {"title": "x"})




LAW_BLOCK = '```bend-law\nimport Base\n\nlaw lamp_on:\n  {1n == 1n : Nat}\n```\n'
PROOF_BLOCK = '```bend-proof\ndef Laws.lamp_on():\n  {==}\n```\n'


def with_bend_blocks(source, law=True, proof=True):
    text = source.rstrip("\n") + "\n"
    if law:
        text += "\n" + LAW_BLOCK
    if proof:
        text += "\n" + PROOF_BLOCK
    return text


class BendFences(unittest.TestCase):
    def test_absent_blocks_are_none_and_canonical_stable(self):
        bundle = compile_v11(read_program("artifact-design"))
        self.assertIsNone(bundle.law)
        self.assertIsNone(bundle.proof)
        self.assertNotIn(b"bend-law", bundle.canonical)
        self.assertNotIn(b"bend-proof", bundle.canonical)
        self.assertEqual(v11.extract_bend(read_program("artifact-design")),
                         {"law": None, "proof": None})

    def test_law_and_proof_compile_and_extract(self):
        bundle = compile_v11(with_bend_blocks(read_program("artifact-design")))
        self.assertTrue(bundle.law.endswith("}\n"))
        self.assertIn("def Laws.lamp_on", bundle.proof)
        self.assertIn(b"```bend-law", bundle.canonical)
        self.assertIn(b"```bend-proof", bundle.canonical)
        blocks = v11.extract_bend(with_bend_blocks(read_program("artifact-design")))
        self.assertEqual(blocks["law"], bundle.law)
        self.assertEqual(blocks["proof"], bundle.proof)

    def test_law_without_proof_is_open(self):
        bundle = compile_v11(with_bend_blocks(read_program("artifact-design"), proof=False))
        self.assertIsNotNone(bundle.law)
        self.assertIsNone(bundle.proof)

    def test_proof_without_law_rejected(self):
        with self.assertRaises(V11CompileError):
            compile_v11(with_bend_blocks(read_program("artifact-design"), law=False))

    def test_duplicate_law_rejected(self):
        doubled = with_bend_blocks(read_program("artifact-design")) + "\n" + LAW_BLOCK
        with self.assertRaises(V11CompileError):
            compile_v11(doubled)

    def test_swapped_bend_order_rejected(self):
        source = read_program("artifact-design").rstrip("\n") + "\n\n" + PROOF_BLOCK + "\n" + LAW_BLOCK
        with self.assertRaises(V11CompileError):
            compile_v11(source)

    def test_bend_braces_are_not_templates(self):
        bundle = compile_v11(with_bend_blocks(read_program("artifact-design")))
        self.assertIn("{==}", bundle.proof)

    def test_proof_only_edit_keeps_frozen_digest(self):
        base = compile_v11(with_bend_blocks(read_program("artifact-design")))
        edited = compile_v11(with_bend_blocks(
            read_program("artifact-design")).replace("def Laws.lamp_on", "def Laws.lamp_on "))
        self.assertEqual(edited.frozen_digest, base.frozen_digest)
        self.assertNotEqual(edited.package_digest, base.package_digest)

    def test_law_edit_moves_both_digests(self):
        base = compile_v11(with_bend_blocks(read_program("artifact-design")))
        edited = compile_v11(with_bend_blocks(
            read_program("artifact-design")).replace("lamp_on", "lamp_off"))
        self.assertNotEqual(edited.frozen_digest, base.frozen_digest)
        self.assertNotEqual(edited.package_digest, base.package_digest)


if __name__ == "__main__":
    unittest.main()
