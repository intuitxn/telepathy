"""Boundary tests for the evaluator-owned Bend selection policy."""
import json
import os
import subprocess
import unittest
import run as harness

class SelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("BEND_HARNESS_BINARY"):
            cls.argv = [os.environ["BEND_HARNESS_BINARY"]]
            return
        kernel = harness.Kernel()
        cls.argv = [kernel.engine, kernel.binary]
        if hasattr(kernel, "build"):
            cls.addClassCleanup(kernel.build.cleanup)

    def select(self, **changes):
        metrics = dict(base=6000, candidate=6200, best=6000, cost=1000,
                       next_cost=1100, delta=50, edits=1, budget=2,
                       growth=2000, multiplier=10, guard=1, leak=0)
        metrics.update(changes)
        result = subprocess.run([*self.argv, "select", *map(str, metrics.values())],
                                capture_output=True, text=True, timeout=60,
                                env={**os.environ, "BEND_NO_TELEMETRY": "1"})
        return result

    def decision(self, reason, accepted=False, **changes):
        result = self.select(**changes)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"accepted": accepted, "reason": reason})

    def test_gain_and_cost_boundaries(self):
        self.decision("accept_gain", True, next_cost=1200)
        self.decision("cost_growth", next_cost=1201)
        self.decision("accept_gain", True, candidate=6100, next_cost=1100)
        self.decision("cost_growth", candidate=6100, next_cost=1101)
        self.decision("accept_gain", True, growth=0, next_cost=1000)
        self.decision("cost_growth", multiplier=0, next_cost=1001)

    def test_noise_and_savings(self):
        self.decision("accept_cheaper", True, candidate=5950, next_cost=999)
        self.decision("no_gain_or_savings", candidate=6050, next_cost=1000)
        self.decision("best_score_floor", candidate=5949, next_cost=1)
        self.decision("best_score_floor", best=6500, next_cost=1)
        self.decision("accept_cheaper", True, base=0, best=0, candidate=0, next_cost=999)

    def test_gates(self):
        self.decision("guard_failed", guard=0)
        self.decision("leak_detected", leak=1)
        self.decision("edit_budget", edits=3)
        self.decision("accept_gain", True, edits=2)

    def test_invalid_metrics(self):
        for changes in ({"base": "06000"}, {"base": -1}, {"base": "+6000"},
                        {"base": "6000.0"}, {"base": ""}, {"base": " 6000"},
                        {"base": 10001}, {"candidate": 10001}, {"best": 5999},
                        {"cost": 0}, {"next_cost": 0}, {"cost": 100001},
                        {"cost": 4294967296}, {"guard": 2}, {"leak": 2},
                        {"budget": 1001}, {"edits": 1001}, {"growth": 10001},
                        {"multiplier": 101}, {"delta": 10001}):
            with self.subTest(changes=changes):
                result = self.select(**changes)
                self.assertNotEqual(result.returncode, 0)

    def test_argument_count(self):
        for count in (0, 11, 13):
            result = subprocess.run([*self.argv, "select", *(["1"] * count)],
                                    capture_output=True, text=True, timeout=60,
                                    env={**os.environ, "BEND_NO_TELEMETRY": "1"})
            self.assertNotEqual(result.returncode, 0)

    def test_largest_safe_cross_products(self):
        self.decision("accept_gain", True, base=0, best=0, candidate=10000,
                      cost=50000, next_cost=100000, growth=10000, multiplier=100)
        self.decision("cost_growth", base=0, best=0, candidate=10000,
                      cost=49999, next_cost=100000, growth=10000, multiplier=100)


if __name__ == "__main__":
    unittest.main()
