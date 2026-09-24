import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from rrsi_run import checkout, digest_tree, load_suite, run, token_usage


class RRSIRunnerTests(unittest.TestCase):
    def suite(self, root):
        fixture = root / "fixture"
        fixture.mkdir()
        (fixture / "module.py").write_text("answer = 1\n")
        manifest = root / "suite.json"
        manifest.write_text(json.dumps({"cases": [{
            "id": "fix", "task": "Fix it", "acceptance": "Pass verifier",
            "fixture": "fixture", "verify": ["python3", "verify.py", "{project}"],
        }]}))
        return manifest

    def test_suite_digest_binds_fixture_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.suite(root)
            _, _, first = load_suite(manifest)
            (root / "fixture/module.py").write_text("answer = 2\n")
            self.assertNotEqual(first, digest_tree(root))

    def test_suite_rejects_symlink_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.suite(root)
            (root / "fixture/link").symlink_to(root / "fixture/module.py")
            with self.assertRaisesRegex(ValueError, "symlinks"):
                load_suite(manifest)
            (root / "fixture/link").unlink()
            data = json.loads(manifest.read_text())
            data["cases"][0]["fixture"] = "../outside"
            manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "inside the pinned suite"):
                load_suite(manifest)

    def test_critic_must_bind_exact_diff_before_any_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            suite_root = root / "suite"
            suite_root.mkdir()
            manifest = self.suite(suite_root)
            critic = root / "critic.json"
            critic.write_text(json.dumps({"passed": True, "revision": "b" * 40,
                                          "diff_sha256": "wrong", "evidence": "reviewed"}))
            edits = root / "edits.json"
            edits.write_text('[{"component":"prompt","hypothesis":"test"}]')
            repo = root / "repo"
            repo.mkdir()
            args = SimpleNamespace(repo=repo, out=root / "run", suite=manifest,
                incumbent="a" * 40, candidate="b" * 40, critic=critic, edits=edits,
                repeats=2, task_timeout=30)
            with patch("rrsi_run.command", return_value="diff text") as command:
                with self.assertRaisesRegex(ValueError, "exact candidate diff"):
                    run(args)
            self.assertEqual(command.call_count, 1)
            self.assertFalse(args.out.exists())

    def test_old_node_event_usage_is_read_without_task_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = root / "tasks/job/events.jsonl"
            events.parent.mkdir(parents=True)
            events.write_text(json.dumps({"kind": "completed", "response": {
                "usage": {"totalTokens": 42}}}) + "\n")
            self.assertEqual(token_usage(SimpleNamespace(state=root), {"id": "job"}), 42)

    def test_checkout_uses_empty_child_of_pinned_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            subprocess.run(["jj", "git", "init"], cwd=repo, check=True, capture_output=True)
            (repo / "source.txt").write_text("fixed\n")
            subprocess.run(["jj", "describe", "-m", "base"], cwd=repo, check=True, capture_output=True)
            revision = subprocess.run(["jj", "log", "-r", "@", "--no-graph", "-T", "commit_id"],
                                      cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
            target = root / "candidate"
            name = checkout(repo, revision, target)
            try:
                self.assertEqual((target / "source.txt").read_text(), "fixed\n")
            finally:
                subprocess.run(["jj", "--ignore-working-copy", "workspace", "forget", name],
                               cwd=repo, check=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
