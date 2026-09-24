"""Host integration tests using the real Bend interpreter and local effects."""
import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import sys
import unittest
from unittest.mock import patch

import run as harness


class DriverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("BEND_HARNESS_BINARY"):
            # Caller has checked and built this exact source; reuse only in tests.
            cls.kernel = harness.Kernel.__new__(harness.Kernel)
            cls.kernel.binary = os.environ["BEND_HARNESS_BINARY"]
            cls.kernel.source_hash = harness.digest(harness.SOURCE.read_bytes())
            cls.kernel.version = "externally checked test binary"
            cls.kernel.engine_version = "externally checked test runtime"
            cls.kernel.check = "All terms check. (caller)"
        else:
            cls.kernel = harness.Kernel()
            if hasattr(cls.kernel, "build"):
                cls.addClassCleanup(cls.kernel.build.cleanup)
        cls.examples = Path(__file__).resolve().parent / "examples"
        cls.config, cls.directory, cls.binding_hash = harness.load_bindings(cls.examples / "bindings.json")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def execute(self, program, *, config=None, task=None, name="run"):
        return harness.run(self.kernel, program, config or self.config, self.directory,
                           self.binding_hash, task or {"numbers": [3, 9, 2]}, self.root / name)

    def test_retry_replay_and_tamper_detection(self):
        result = self.execute("repeat\n2\nok\nverify\nmaximum\nmodel\nmaximum")
        self.assertTrue(result["ok"])
        self.assertEqual(result["effect_count"], 4)
        self.assertEqual([o["ok"] for o in result["observations"]], [True, False, True, True])
        self.assertEqual(result["observations"][-1]["value"], 9)
        with patch.object(harness, "effect", side_effect=AssertionError("replay dispatched an effect")):
            self.assertEqual(harness.replay(self.kernel, self.root / "run")["effects"], 4)
        for field, bad_value in (("source_sha256", "stale"), ("program", "model\nother")):
            tampered = copy.deepcopy(result)
            tampered[field] = bad_value
            harness.save(self.root / "run/run.json", tampered)
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                harness.replay(self.kernel, self.root / "run")

    def test_failed_verifier_exhausts_bound(self):
        config = copy.deepcopy(self.config)
        config["effects"]["verify:maximum"] = {"kind": "json", "required": ["answer"]}
        result = self.execute("repeat\n2\nok\nverify\nmaximum\nmodel\nmaximum", config=config)
        self.assertFalse(result["ok"])
        self.assertEqual(result["effect_count"], 4)
        self.assertEqual([o["ok"] for o in result["observations"]], [True, False, True, False])
        self.assertEqual(result["observations"][-1]["value"], 9)

    def test_retrieve_then_retry_keeps_context_and_verifies(self):
        (self.root / "notes.txt").write_text("The maximum may occur after the first item.")
        config = {"version": 1, "effects": {
            "retrieve:notes": {"kind": "file", "path": "notes.txt"},
            "model:maximum": {"kind": "command", "argv": [sys.executable, str(self.examples / "maximum.py"), "propose"]},
            "verify:maximum": {"kind": "command", "argv": [sys.executable, str(self.examples / "maximum.py"), "verify"]}}}
        program = "sequence\nretrieve\nnotes\nrepeat\n2\nok\nverify\nmaximum\nmodel\nmaximum"
        result = harness.run(self.kernel, program, config, self.root, "test bindings",
                             {"numbers": [3, 9, 2]}, self.root / "run")
        self.assertTrue(result["ok"])
        self.assertEqual(result["effect_count"], 5)
        self.assertIn("maximum may occur", result["observations"][0]["value"])
        self.assertEqual(result["observations"][-1]["value"], 9)

    def test_external_error_is_preserved_and_not_replayed(self):
        config = {"version": 1, "effects": {"model:broken": {
            "kind": "command", "argv": ["{python}", "-c", "raise SystemExit(7)"]}}}
        with self.assertRaisesRegex(RuntimeError, "exited 7"):
            self.execute("model\nbroken", config=config)
        saved = json.loads((self.root / "run/run.json").read_text())
        self.assertEqual(saved["status"], "error")
        self.assertNotIn("ok", saved)
        self.assertEqual(saved["pending"]["ref"], "broken")
        self.assertEqual(saved["observations"], [])
        with self.assertRaisesRegex(ValueError, "completed runs"):
            harness.replay(self.kernel, self.root / "run")

    def test_compare_keeps_expected_outside_effect_input(self):
        suite = [{"input": {"numbers": [3, 9, 2]}, "expected": 9}]
        suite_path = self.root / "suite.json"
        suite_path.write_text(json.dumps(suite))
        calls = []
        real_effect = harness.effect

        def observe(request, config, directory, task, observations, kernel, timeout):
            calls.append(copy.deepcopy(task))
            self.assertEqual(task, suite[0]["input"])
            self.assertNotIn("expected", task)
            return real_effect(request, config, directory, task, observations, kernel, timeout)

        baseline = self.root / "baseline.harness"
        baseline.write_text("model\nmaximum")
        args = SimpleNamespace(bindings=self.examples / "bindings.json", suite=suite_path,
                               out=self.root / "comparison", baseline=baseline,
                               candidate=self.examples / "retry.harness", timeout=120, delta=0,
                               edit_budget=16, max_growth=10000, gain_multiplier=2)
        with patch.object(harness, "effect", side_effect=observe):
            report = harness.compare(self.kernel, args)
        self.assertEqual(report["metrics"]["baseline"]["score"], 0)
        self.assertEqual(report["metrics"]["candidate"]["score"], 10000)
        self.assertEqual(report["metrics"]["baseline"]["effects"], 1)
        self.assertEqual(report["metrics"]["candidate"]["effects"], 4)
        self.assertFalse(report["decision"]["accepted"])
        self.assertEqual(report["decision"]["reason"], "cost_growth")
        self.assertEqual(report["policy"]["delta"], 0)
        self.assertEqual(report["policy"]["edit_budget"], 16)
        self.assertEqual(report["policy"]["max_growth"], 10000)
        self.assertEqual(report["policy"]["gain_multiplier"], 2)
        self.assertEqual(len(calls), 5)
        self.assertTrue((args.out / "comparison.json").exists())

    def test_evolve_retains_good_edit_and_rejected_followup(self):
        programs = [(self.examples / "retry.harness").read_text(),
                    "repeat\n4\nok\nverify\nmaximum\nmodel\nmaximum\n"]
        proposed = []

        def offline_propose(kernel, args):
            self.assertEqual(len(args.feedback), len(proposed) + 1)
            args.out.mkdir()
            target = args.out / "candidate.harness"
            target.write_text(programs[len(proposed)])
            proposed.append(target)
            return {"candidate": str(target), "status": "unevaluated"}

        args = SimpleNamespace(program=self.examples / "baseline.harness",
                               bindings=self.examples / "bindings.json", suite=self.examples / "suite.json",
                               out=self.root / "evolution", rounds=2, edit_budget=16, delta=0,
                               max_growth=10000, gain_multiplier=2, model=None, timeout=120)
        with patch.object(harness, "propose", side_effect=offline_propose):
            result = harness.evolve(self.kernel, args)
        self.assertEqual(result["status"], "done")
        self.assertEqual(result["seed"]["score"], 5000)
        self.assertEqual([row["accepted"] for row in result["history"]], [True, False])
        self.assertEqual(result["history"][1]["reason"], "no_gain_or_savings")
        self.assertEqual((args.out / "result.harness").read_text(), programs[0])
        self.assertEqual(len(proposed), 2)


    def test_invalid_candidate_preflight_has_no_external_effects(self):
        candidate = self.root / "bad.harness"
        candidate.write_text("sequence\nmodel\nmaximum\nmodel\nunbound")
        args = SimpleNamespace(bindings=self.examples / "bindings.json", suite=self.examples / "suite.json",
                               out=self.root / "comparison", baseline=self.examples / "baseline.harness",
                               candidate=candidate, timeout=120, delta=0,
                               edit_budget=16, max_growth=10000, gain_multiplier=2)
        with patch.object(harness, "effect", side_effect=AssertionError("effect dispatched before preflight")):
            with self.assertRaisesRegex(ValueError, "unbound effect"):
                harness.compare(self.kernel, args)


class JsonEqualityTests(unittest.TestCase):
    def test_booleans_are_not_numbers(self):
        for left, right in ((True, 1), (False, 0), ([True], [1]),
                            ({"answer": [False]}, {"answer": [0]})):
            with self.subTest(left=left, right=right):
                self.assertFalse(harness.json_equal(left, right))
                self.assertFalse(harness.json_equal(right, left))

    def test_json_objects_are_unordered_but_arrays_are_ordered(self):
        self.assertTrue(harness.json_equal({"a": [True, None], "b": 2}, {"b": 2, "a": [True, None]}))
        self.assertFalse(harness.json_equal([1, 2], [2, 1]))
        self.assertFalse(harness.json_equal({"a": 1}, {"a": 1, "b": 2}))
        self.assertFalse(harness.json_equal("1", 1))


if __name__ == "__main__":
    unittest.main()
