"""Contract and CLI boundary tests for the agent pseudocode surface."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from language import ProgramError, compile_file, compile_source

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "examples/agent-programs/review_and_plan.meta"
CLI = ROOT / "runtime/agent_programs/cli.py"


class LanguageTests(unittest.TestCase):
    def source(self):
        return EXAMPLE.read_text(encoding="utf-8")

    def reject(self, old, new, code):
        source = self.source()
        self.assertIn(old, source)
        with self.assertRaises(ProgramError) as failure:
            compile_source(source.replace(old, new, 1))
        self.assertEqual(failure.exception.code, code)

    def test_example_is_stable_typed_plan(self):
        first = compile_file(EXAMPLE).plan
        self.assertEqual(first, compile_file(EXAMPLE).plan)
        self.assertEqual(first["schema"], "agent.plan/v0")
        self.assertEqual([step["name"] for step in first["steps"]], ["inspect", "plan"])
        self.assertEqual(first["decisions"]["route"]["type"], "Choice")
        self.assertEqual(first["decisions"]["ready_confidence"]["type"], "Noul")
        self.assertEqual(first["decisions"]["risk_score"]["type"], "Score")
        self.assertTrue(all(decision["advisory"] for decision in first["decisions"].values()))
        self.assertRegex(first["plan_digest"], r"^sha256:[0-9a-f]{64}$")

    def test_unknown_and_forward_references_fail(self):
        self.reject("use input.request, input.workspace", "use input.missing", "unknown_reference")
        self.reject("use input.request, input.workspace", "use step.plan.plan", "unknown_reference")
        self.reject("step plan after inspect:", "step plan after not_a_step:", "unknown_step")

    def test_decision_contracts_fail_closed(self):
        self.reject("options implement, ask_for_clarification, report_blocked", "options implement, implement", "invalid_choice")
        self.reject("threshold 0.70", "threshold 1.70", "invalid_threshold")
        self.reject("range 0..5", "range 5..5", "invalid_bounds")

    def test_effect_and_syntax_errors(self):
        self.reject("allow read_workspace", "allow unknown_effect", "unknown_effect")
        self.reject("input request: string", "input request: unknown", "invalid_type")
        self.reject("  ask \"Choose the next route after inspection.\"", "  ask unquoted", "invalid_string")
        self.reject("  options implement, ask_for_clarification, report_blocked", "    options implement, ask_for_clarification, report_blocked", "invalid_indent")


class CliTests(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run([sys.executable, str(CLI), *args], cwd=ROOT,
                              text=True, capture_output=True)

    def test_check_and_plan(self):
        checked = self.cli("check", str(EXAMPLE))
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout)["steps"], ["inspect", "plan"])
        planned = self.cli("plan", str(EXAMPLE))
        self.assertEqual(planned.returncode, 0, planned.stderr)
        self.assertEqual(json.loads(planned.stdout)["runtime"]["bridge"], "runtime/meta_shell.py")

    def test_submit_requires_bound_inputs_and_explicit_effects_before_contacting_node(self):
        with tempfile.TemporaryDirectory() as directory:
            values = Path(directory) / "inputs.json"
            values.write_text('{"request":"Inspect this repo","workspace":"/tmp/example"}')
            args = ("submit", str(EXAMPLE), "--input-file", str(values), "--port", "1")
            denied = self.cli(*args)
            self.assertEqual(denied.returncode, 1)
            self.assertEqual(json.loads(denied.stdout)["code"], "missing_effect_authority")
            values.write_text('{"request":42,"workspace":"/tmp/example"}')
            invalid = self.cli(*args, "--allow-effect", "read_workspace")
            self.assertEqual(invalid.returncode, 1)
            self.assertEqual(json.loads(invalid.stdout)["code"], "invalid_inputs")


if __name__ == "__main__":
    unittest.main()
