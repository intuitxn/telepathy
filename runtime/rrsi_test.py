import copy
import unittest

from rrsi import assess


def evidence():
    return {
        "suite": ["a", "b"], "repeats": 2,
        "revision": "b" * 40, "incumbent_revision": "a" * 40,
        "incumbent_trials": [
            {"task": task, "reward": reward, "tokens": 100}
            for task, reward in [("a", 1), ("a", 0), ("b", 1), ("b", 0)]],
        "candidate_trials": [
            {"task": task, "reward": reward, "tokens": 105}
            for task, reward in [("a", 1), ("a", 1), ("b", 1), ("b", 0)]],
        "noise": 0.10, "best_score": 0.5, "round": 0, "rounds": 4,
        "min_edits": 1, "max_edits": 2, "beta0": 0, "beta1": 1,
        "within_band": {"score": 0, "cost": 1, "novelty": 0},
        "edits": [{"component": "prompt", "hypothesis": "Improve verification"}],
        "critic": {"passed": True, "evidence": "Reviewer examined candidate diff before trial scores"},
        "guards_passed": True, "history": [],
    }


class RRSISelectionTests(unittest.TestCase):
    def test_clear_gain_with_bounded_cost_is_admissible(self):
        result = assess(evidence())
        self.assertTrue(result["admissible"])
        self.assertEqual(result["next_best_score"], 0.75)

    def test_leakage_review_and_budget_are_required(self):
        row = evidence()
        row["critic"]["passed"] = False
        self.assertFalse(assess(row)["admissible"])
        row = evidence()
        row["round"] = 3
        row["edits"].append({"component": "memory", "hypothesis": "Add memory"})
        row["edits"].append({"component": "skill", "hypothesis": "Add reusable skill"})
        self.assertEqual(assess(row)["reason"], "annealed edit budget exceeded")

    def test_missing_trials_do_not_get_a_free_score(self):
        row = evidence()
        row["candidate_trials"].pop()
        with self.assertRaisesRegex(ValueError, "exactly 2 trials"):
            assess(row)

    def test_cost_growth_can_block_a_real_score_gain(self):
        row = evidence()
        for trial in row["candidate_trials"]:
            trial["tokens"] = 150
        self.assertEqual(assess(row)["reason"], "token cost increase exceeds measured-gain allowance")

    def test_within_noise_gain_requires_cost_savings_or_structural_novelty(self):
        row = evidence()
        row["candidate_trials"] = copy.deepcopy(row["incumbent_trials"])
        self.assertFalse(assess(row)["admissible"])
        for trial in row["candidate_trials"]:
            trial["tokens"] = 90
        self.assertTrue(assess(row)["admissible"])
        for trial in row["candidate_trials"]:
            trial["tokens"] = 100
        row["edits"][0]["component"] = "memory"
        row["within_band"]["novelty"] = 0.1
        self.assertTrue(assess(row)["admissible"])
        row["history"] = [{"component": "memory", "accepted": True}]
        self.assertFalse(assess(row)["admissible"])

    def test_best_score_floor_prevents_cumulative_slippage(self):
        row = evidence()
        row["best_score"] = 1.0
        self.assertEqual(assess(row)["reason"], "below noise-adjusted best-score floor")


if __name__ == "__main__":
    unittest.main()
