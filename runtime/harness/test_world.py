"""Independent binary-world simulation for the Bend latent-rule filter."""
import json
import os
from pathlib import Path
import tempfile
import unittest

import run as harness


class WorldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("BEND_HARNESS_BINARY"):
            cls.kernel = harness.Kernel.__new__(harness.Kernel)
            cls.kernel.binary = os.environ["BEND_HARNESS_BINARY"]
            cls.kernel.source_hash = harness.file_digest(harness.SOURCE)
            cls.kernel.version = "externally checked test binary"
            cls.kernel.engine_version = "externally checked test runtime"
            cls.kernel.check = "All terms check. (caller)"
        else:
            cls.kernel = harness.Kernel()
            if hasattr(cls.kernel, "build"):
                cls.addClassCleanup(cls.kernel.build.cleanup)

    def step(self, belief, state, action, observation):
        return json.loads(self.kernel.call("world", belief, state, action, observation))

    def test_latent_rule_learning_improves_heldout_prediction(self):
        # The simulator is independent of the Bend implementation: its hidden
        # rule is applied with Python bitwise XOR, and its final action is unseen.
        for rule in (0, 1):
            with self.subTest(hidden_rule=rule):
                belief, state = 5000, 0
                for action in (0, 1, 1, 0):
                    observed = state ^ action ^ rule
                    result = self.step(belief, state, action, observed)
                    belief, state = result["posterior_rule_one_bps"], observed
                    self.assertTrue(0 <= result["predicted_one_bps"] <= 10000)
                    self.assertTrue(0 <= result["surprise_bps"] <= 10000)
                self.assertTrue(belief > 9990 if rule else belief < 10)

                action = 1  # held out until the posterior is frozen
                observed = state ^ action ^ rule
                prediction = self.step(belief, state, action, observed)["predicted_one_bps"] / 10000
                brier = (prediction - observed) ** 2
                self.assertLess(brier, 0.011)
                self.assertLess(brier, 0.25)  # fixed uninformed 50/50 baseline

    def test_prediction_is_frozen_before_observation_update(self):
        zero = self.step(9000, 0, 0, 0)
        one = self.step(9000, 0, 0, 1)
        self.assertEqual(zero["predicted_one_bps"], 8200)
        self.assertEqual(one["predicted_one_bps"], 8200)
        self.assertLess(zero["posterior_rule_one_bps"], one["posterior_rule_one_bps"])

    def test_world_cli_rejects_noncanonical_or_unbounded_inputs(self):
        for args in ((10001, 0, 0, 1), (5000, 2, 0, 1), (5000, 0, 2, 1),
                     (5000, 0, 0, 2), ("05000", 0, 0, 1), (-1, 0, 0, 1)):
            with self.subTest(args=args), self.assertRaises((RuntimeError, ValueError)):
                self.kernel.call("world", *args)

    def test_dsl_tool_calls_world_kernel_and_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = harness.run(self.kernel, "tool\nworld", {"effects": {"tool:world": {"kind": "world"}}},
                                 root, "world-binding", {"belief_bps": 5000, "state_bit": 0,
                                 "action_bit": 0, "observed_bit": 1}, root / "run")
            self.assertTrue(result["ok"])
            self.assertEqual(result["observations"][0]["value"]["posterior_rule_one_bps"], 9000)
            self.assertEqual(harness.replay(self.kernel, root / "run")["effects"], 1)

    def test_dsl_episode_carries_posterior_across_observations(self):
        transitions = []
        state = 0
        for action in (0, 1, 0, 1):
            observed = state ^ action ^ 1
            transitions.append({"state_bit": state, "action_bit": action, "observed_bit": observed})
            state = observed
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = harness.run(self.kernel, "repeat\n4\nnever\ntool\nworld",
                                 {"effects": {"tool:world": {"kind": "world"}}}, root,
                                 "world-binding", {"belief_bps": 5000, "transitions": transitions},
                                 root / "episode")
            self.assertEqual(result["effect_count"], 4)
            self.assertEqual([row["world_step"] for row in result["observations"]], [0, 1, 2, 3])
            self.assertGreater(result["observations"][-1]["value"]["posterior_rule_one_bps"], 9990)
            self.assertEqual(harness.replay(self.kernel, root / "episode")["effects"], 4)

    def test_batch_episode_cannot_expose_future_observations_to_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            program = "sequence\nmodel\npeek\ntool\nworld"
            config = {"effects": {"model:peek": {"kind": "command", "argv": ["{python}", "-c", "pass"]},
                                  "tool:world": {"kind": "world"}}}
            task = {"belief_bps": 5000, "transitions": [
                {"state_bit": 0, "action_bit": 0, "observed_bit": 1}]}
            with self.assertRaisesRegex(ValueError, "future observations would leak"):
                harness.run(self.kernel, program, config, root, "world-binding", task, root / "rejected")
            self.assertFalse((root / "rejected").exists())

    def test_batch_episode_rejects_rebound_world_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {"effects": {"tool:world": {"kind": "command", "argv": ["{python}", "-c", "pass"]}}}
            task = {"belief_bps": 5000, "transitions": [
                {"state_bit": 0, "action_bit": 0, "observed_bit": 1}]}
            with self.assertRaisesRegex(ValueError, "future observations would leak"):
                harness.run(self.kernel, "tool\nworld", config, root, "world-binding", task, root / "rejected")
            self.assertFalse((root / "rejected").exists())


if __name__ == "__main__":
    unittest.main()
