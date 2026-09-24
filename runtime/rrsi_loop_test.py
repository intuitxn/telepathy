import json
import io
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from agent_programs.cli import _run_meta
from agent_programs.language import ProgramError, compile_file, compile_source
from rrsi_loop import heldout_nonregression, require_proposal, round_args, run_loop


PROGRAM = Path(__file__).parent / "agent_programs/rrsi.meta"


class RRSILoopContractTests(unittest.TestCase):
    def test_program_compiles_with_all_required_guards_and_order(self):
        plan = compile_file(PROGRAM).plan
        self.assertEqual(plan["policy"]["kind"], "rrsi")
        self.assertEqual([step["name"] for step in plan["steps"]],
                         ["optimize", "critique", "forward", "backward", "select"])
        self.assertEqual(len(plan["policy"]["guards"]), 5)

    def test_policy_cannot_omit_heldout_guard(self):
        source = PROGRAM.read_text().replace(", heldout_nonregression", "")
        with self.assertRaisesRegex(ProgramError, "all five known guards"):
            compile_source(source)

    def test_policy_rejects_unbounded_edit_and_zero_cost_penalty(self):
        source = PROGRAM.read_text()
        with self.assertRaisesRegex(ProgramError, "max_edits"):
            compile_source(source.replace("max_edits 1", "max_edits 100"))
        with self.assertRaisesRegex(ProgramError, "cost weights"):
            compile_source(source.replace("within_band_cost_weight 1", "within_band_cost_weight 0"))

    def test_cost_weights_flow_from_program_into_evaluation(self):
        source = PROGRAM.read_text().replace("gain_cost_ratio 1", "gain_cost_ratio 0.5")
        source = source.replace("within_band_cost_weight 1", "within_band_cost_weight 2")
        plan = compile_source(source).plan
        args = SimpleNamespace(plan=plan, repo=Path("repo"), suite=Path("suite"),
            heldout_suite=Path("heldout"), python="python", bend="bend", acp_agent="agent",
            model="test", repeats=2, task_timeout=30, rounds=2,
            max_edits=plan["policy"]["max_edits"])
        measured = round_args(args, "a" * 40, "b" * 40, 0, Path("round"), Path("critic"), None)
        self.assertEqual(measured.beta1, 0.5)
        self.assertEqual(measured.within_band_cost_weight, 2)

    def test_heldout_requires_score_and_token_nonregression(self):
        report = {"incumbent_score": 1, "candidate_score": 1,
                  "incumbent_tokens": 100, "candidate_tokens": 90}
        self.assertTrue(heldout_nonregression(report))
        self.assertFalse(heldout_nonregression({**report, "candidate_tokens": 101}))
        self.assertFalse(heldout_nonregression({**report, "candidate_score": 0.5}))
        with self.assertRaises(ValueError):
            heldout_nonregression({**report, "candidate_tokens": float("nan")})

    def test_generic_single_task_bridge_rejects_policy_program(self):
        plan = compile_file(PROGRAM).plan
        with patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(_run_meta(SimpleNamespace(), plan, wait=False), 1)
        self.assertEqual(json.loads(output.getvalue())["code"], "policy_runtime_required")

    def test_proposal_metadata_must_be_structured_once(self):
        report = 'Checks passed\nRRSI_PROPOSAL_JSON: {"component":"prompt","hypothesis":"Reduce unverified reports"}'
        self.assertEqual(require_proposal(report)["component"], "prompt")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            require_proposal(report + "\n" + report.splitlines()[-1])
        with self.assertRaisesRegex(ValueError, "known component"):
            require_proposal('RRSI_PROPOSAL_JSON: ' + json.dumps({"component": "magic", "hypothesis": "x"}))

    def test_selected_revision_becomes_next_round_incumbent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            (repo / ".opencode/agents").mkdir(parents=True)
            (repo / ".opencode/agents/meta.md").write_text("charter")
            (repo / "runtime/worker").mkdir(parents=True)
            (repo / "runtime/worker/system.bend").write_text("kernel")
            out = root / "run"
            args = SimpleNamespace(repo=repo, out=out, state=root / "state", program=PROGRAM,
                incumbent="a" * 40, rounds=2, max_edits=1, suite=root / "evolve/suite.json",
                heldout_suite=root / "heldout/suite.json", bend="bend", port=47831,
                model="test", acp_agent="agent", python="python", repeats=2, task_timeout=30,
                run_id="test")
            proposed = []

            def propose(_args, incumbent, round_dir, _context):
                proposed.append(incumbent)
                candidate = "b" * 40 if len(proposed) == 1 else "c" * 40
                return candidate, {"component": "prompt", "hypothesis": "Improve checks"}, round_dir / "diff", "d" * 64

            def evaluate(round_args):
                target = round_args.out
                (target / "heldout").mkdir(parents=True)
                (target / "heldout/report.json").write_text(json.dumps({"incumbent_score": 1,
                    "candidate_score": 1, "incumbent_tokens": 100, "candidate_tokens": 90,
                    "suite_sha256": "h"}))
                (target / "history-next.json").write_text(json.dumps([{"component": "prompt", "hypothesis": "Improve checks", "accepted": True, "selected_score": 1}]))
                (target / "proposal-context.json").write_text(json.dumps({"tested_hypotheses": [{"component": "prompt", "hypothesis": "Improve checks", "accepted": True}], "pruning_candidates": []}))
                return {"admissible": True, "reason": "accepted", "score_change": 0,
                        "relative_token_change": -0.1, "suite_sha256": "e"}

            with patch("rrsi_loop.load_suite", side_effect=[({}, root / "evolve", "e"), ({}, root / "heldout", "h")]), \
                 patch("rrsi_loop.api", return_value={"ready": True, "state": str(args.state)}), \
                 patch("rrsi_loop.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout="All terms check.")), \
                 patch("rrsi_loop.propose", side_effect=propose), \
                 patch("rrsi_loop.critique", return_value=({"passed": True}, root / "critic.json")), \
                 patch("rrsi_loop.evaluate", side_effect=evaluate), \
                 patch("rrsi_loop.bend_select", return_value=True):
                result = run_loop(args)
            self.assertEqual(proposed, ["a" * 40, "b" * 40])
            self.assertEqual(result["selected_incumbent"], "c" * 40)
            self.assertEqual([row["status"] for row in result["rounds"]], ["selected", "selected"])
            feedback = json.loads((out / "round-00/feedback.json").read_text())
            selection = json.loads((out / "round-00/selection.json").read_text())
            self.assertNotIn("selected", feedback)
            self.assertTrue(selection["selected"])


if __name__ == "__main__":
    unittest.main()
