"""Effect protocol tests independent of model availability and Bend build time."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import run as harness


class EffectTests(unittest.TestCase):
    def request(self, binding, *, kind="model", value="task"):
        return harness.effect({"kind": kind, "ref": "test", "index": 0},
                              {"effects": {kind + ":test": binding}}, Path.cwd(),
                              value, [], None, 10)

    def test_opencode_text_and_errors(self):
        events = [
            {"type": "text", "part": {"text": '{"answer": 9}'}},
            {"type": "step_finish", "part": {"tokens": {"input": 10, "output": 4}}},
        ]
        with patch.object(harness, "command", return_value="\n".join(map(json.dumps, events))) as call:
            result = self.request({"kind": "opencode"})
            self.assertEqual(result["value"], '{"answer": 9}')
            self.assertEqual(result["tokens"], 14)
            self.assertIn("harness-model", call.call_args.args[0])
            self.assertIn("--pure", call.call_args.args[0])
        for response in ("", json.dumps({"type": "error", "error": "provider unavailable"})):
            with patch.object(harness, "command", return_value=response):
                with self.assertRaises(RuntimeError):
                    self.request({"kind": "opencode"})

    def test_verification_preserves_original_value(self):
        result = self.request({"kind": "json", "required": ["answer"]},
                              kind="verify", value='{"answer": 9}')
        self.assertTrue(result["ok"])
        self.assertEqual(result["value"], '{"answer": 9}')
        self.assertFalse(self.request({"kind": "json", "required": ["answer"]},
                                     kind="verify", value="not JSON")["ok"])
        with patch.object(harness, "command", return_value='{"ok": true, "value": "replacement"}'):
            result = self.request({"kind": "command", "argv": ["verifier"]}, kind="verify", value="candidate")
            self.assertEqual(result["value"], "candidate")

    def test_command_protocol_rejects_non_boolean_status(self):
        with patch.object(harness, "command", return_value='{"ok": "yes", "value": 9}'):
            with self.assertRaisesRegex(ValueError, "boolean"):
                self.request({"kind": "command", "argv": ["solver"]})

    def test_retrieve_uses_existing_bend_memory(self):
        kernel = SimpleNamespace(call=Mock(return_value="reviewed finding"))
        result = harness.effect({"kind": "retrieve", "ref": "findings", "index": 0},
                                {"effects": {"retrieve:findings": {"kind": "memory", "path": "snapshot"}}},
                                Path.cwd(), {"question": "example"}, [], kernel, 10)
        self.assertTrue(result["ok"])
        self.assertEqual(result["value"], "reviewed finding")
        kernel.call.assert_called_once_with("memory", Path.cwd() / "snapshot")

    def test_timeout_and_nonzero_exit(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            harness.command([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.05)
        with self.assertRaisesRegex(RuntimeError, "exited 7"):
            harness.command([sys.executable, "-c", "raise SystemExit(7)"])

    def test_receipt_can_hold_multiple_valid_effect_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            value = {"observations": [{"value": "x" * (600 * 1024)}] * 2}
            harness.save(path, value)
            self.assertEqual(json.loads(harness.read(path, harness.RECEIPT_LIMIT)), value)

    def test_proposal_preflight_and_feedback_boundary(self):
        examples = Path(__file__).resolve().parent / "examples"
        kernel = SimpleNamespace(validate=Mock(), source_hash="checked-source")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            feedback = root / "feedback.json"
            feedback.write_text(json.dumps({"metrics": {"baseline": {"score": 5000}},
                                            "decision": {"accepted": False}, "expected": "private-answer"}))
            args = SimpleNamespace(bindings=examples / "bindings.json", program=examples / "baseline.harness",
                                   feedback=[feedback], out=root / "proposal", edit_budget=16, model=None, timeout=10)
            with patch.object(harness, "effect", return_value={"ok": True, "value": (examples / "retry.harness").read_text()}) as effect:
                result = harness.propose(kernel, args)
                self.assertEqual(result["status"], "unevaluated")
                task_data = effect.call_args.args[3]
                self.assertNotIn("expected", task_data["feedback"][0])
                self.assertFalse(task_data["feedback"][0]["decision"]["accepted"])
                with self.assertRaisesRegex(ValueError, "must be new"):
                    harness.propose(kernel, args)
                self.assertEqual(effect.call_count, 1)


if __name__ == "__main__":
    unittest.main()
