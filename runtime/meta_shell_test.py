"""Queue, restart, ownership and MCP integration checks using isolated state.

Only the Bend and model execution boundaries are substituted. These tests never
invoke a model, contact a relay, or touch the installed node's private state.
"""
import asyncio
import sqlite3
import tempfile
import unittest
import plistlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from starlette.testclient import TestClient

import meta_shell


class ControlledNode(meta_shell.Node):
    def __init__(self, state):
        super().__init__(state, Path(__file__).with_name("system.bend"), "unused-bend", "unused-opencode")
        self.executed = []
        self.returned = []
        self.gate = None
        self.stop_reason = "end_turn"
        self.agent_text = None

    async def _check_kernel(self):
        self.source_hash = "test-kernel"

    async def _prepare(self, job):
        return "isolated test packet"

    async def _run_agent(self, job, packet):
        self.executed.append(job["id"])
        if self.gate is not None:
            await self.gate.wait()
        text = self.agent_text if self.agent_text is not None else "observed: " + job["task"]
        return {"text": text, "session_id": "test-session",
                "stop_reason": self.stop_reason}

    async def _return(self, job, result, evidence):
        self.returned.append(job["id"])


async def eventually(check):
    async with asyncio.timeout(5):
        while True:
            value = await check()
            if value:
                return value
            await asyncio.sleep(0.01)


class NodeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.node = ControlledNode(self.root / "state")
        await self.node.start()
        self.addAsyncCleanup(self.node.close)

    def params(self, request_id="one", **changes):
        return {"task": "Inspect the fixture", "acceptance": "Report observed facts",
                "project": str(self.root), "request_id": request_id, **changes}

    async def finished(self, job_id, status="reported", node=None):
        node = node or self.node
        async def check():
            job = await node.dispatch("task", {"id": job_id})
            return job if job["status"] == status else None
        return await eventually(check)

    async def test_retry_is_one_execution_and_rejects_changed_request(self):
        jobs = await asyncio.gather(*[self.node.dispatch("submit", self.params()) for _ in range(12)])
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        result = await self.finished(jobs[0]["id"])
        self.assertEqual(self.node.executed, [result["id"]])
        self.assertEqual(self.node.returned, [result["id"]])
        self.assertEqual(result["result"], "observed: Inspect the fixture")
        with self.assertRaisesRegex(ValueError, "different task"):
            await self.node.dispatch("submit", self.params(task="A different request"))

    async def test_concurrent_distinct_tasks_all_return_once(self):
        jobs = await asyncio.gather(*[
            self.node.dispatch("submit", self.params(str(i))) for i in range(10)])
        await asyncio.gather(*[self.finished(job["id"]) for job in jobs])
        self.assertEqual(len(set(self.node.executed)), 10)
        self.assertEqual(self.node.executed, self.node.returned)
        status = await self.node.dispatch("status", {})
        self.assertEqual(status["jobs"], {"reported": 10})

    async def test_restart_interrupts_active_work_resumes_only_unstarted_work(self):
        self.node.gate = asyncio.Event()
        active = await self.node.dispatch("submit", self.params("active"))
        await self.finished(active["id"], "running")
        queued = await self.node.dispatch("submit", self.params("queued"))
        await self.node.close()
        # Model a crash where the process did not run its cancellation handler.
        with sqlite3.connect(self.root / "state/node.sqlite3") as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (active["id"],))
        replacement = ControlledNode(self.root / "state")
        await replacement.start()
        self.addAsyncCleanup(replacement.close)
        await self.finished(queued["id"], node=replacement)
        interrupted = await replacement.dispatch("task", {"id": active["id"]})
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertIn("No automatic replay", interrupted["error"])
        self.assertEqual(replacement.executed, [queued["id"]])
        retry = await replacement.dispatch("submit", self.params("active"))
        self.assertEqual(retry["id"], active["id"])
        self.assertEqual(retry["status"], "interrupted")

    async def test_second_owner_cannot_open_same_state(self):
        other = ControlledNode(self.root / "state")
        self.addAsyncCleanup(other.close)
        with self.assertRaisesRegex(RuntimeError, "already owns"):
            await other.start()
        self.assertTrue((await self.node.dispatch("status", {}))["ready"])

    async def test_incomplete_model_turn_is_not_reported(self):
        self.node.stop_reason = "max_tokens"
        job = await self.node.dispatch("submit", self.params())
        result = await self.finished(job["id"], "failed")
        self.assertIn("max_tokens", result["error"])
        self.assertEqual(self.node.returned, [])
        self.assertTrue(result["result"])

    async def test_conversation_does_not_cross_project_boundary(self):
        second = self.root / "second-project"
        second.mkdir()
        a = await self.node.dispatch("submit", self.params("a", conversation="same"))
        b = await self.node.dispatch("submit", self.params("b", conversation="same", project=str(second)))
        self.assertNotEqual(a["conversation"], b["conversation"])

    async def test_empty_agent_text_fails_without_bend_return(self):
        for index, text in enumerate(["", " \n\t"]):
            with self.subTest(text=repr(text)):
                self.node.agent_text = text
                job = await self.node.dispatch("submit", self.params(f"empty-{index}"))
                result = await self.finished(job["id"], "failed")
                self.assertIn("no agent text", result["error"])
                self.assertNotIn(job["id"], self.node.returned)


class TransportTests(unittest.TestCase):
    def test_http_auth_and_real_mcp_handshake_tool_call(self):
        with tempfile.TemporaryDirectory() as directory:
            node = ControlledNode(Path(directory) / "state")
            with TestClient(meta_shell.create_app(node), base_url=f"http://127.0.0.1:{node.port}") as client:
                for path in ["/health", "/mcp", "/api"]:
                    self.assertEqual(client.get(path).status_code, 401)
                headers = {"Authorization": "Bearer " + node.token,
                           "Accept": "application/json, text/event-stream"}
                self.assertEqual(client.get("/health", headers=headers).status_code, 200)
                self.assertEqual(client.get("/health", headers=headers | {"Origin": "https://example.com"}).status_code, 401)
                self.assertEqual(client.get("/health", headers=headers | {"Host": "example.com"}).status_code, 401)
                def rpc(method, params, id):
                    response = client.post("/mcp", headers=headers,
                        json={"jsonrpc": "2.0", "id": id, "method": method, "params": params})
                    self.assertEqual(response.status_code, 200, response.text)
                    return response.json()["result"]
                initialized = rpc("initialize", {"protocolVersion": "2025-11-25",
                    "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}, 1)
                self.assertEqual(initialized["serverInfo"]["name"], "meta-kernel")
                self.assertEqual(client.post("/mcp", headers=headers,
                    json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code, 202)
                names = {t["name"] for t in rpc("tools/list", {}, 2)["tools"]}
                self.assertTrue({"meta_status", "meta_submit", "meta_task", "meta_kernel"} <= names)
                result = rpc("tools/call", {"name": "meta_status", "arguments": {}}, 3)
                self.assertFalse(result.get("isError", False))
                self.assertIn('"ready": true', result["content"][0]["text"])
                response = client.post("/api", headers=headers, json={"method": "status"})
                self.assertTrue(response.json()["ready"])
                self.assertEqual(client.post("/api", headers=headers,
                    json={"method": "submit", "params": {"task": "", "project": directory}}).status_code, 400)
                self.assertEqual(client.post("/api", headers=headers,
                    json={"method": "submit", "params": []}).status_code, 400)
            self.assertFalse(node.ready)

    def test_oversized_stream_is_rejected_before_remaining_body_is_read(self):
        with tempfile.TemporaryDirectory() as directory:
            node = ControlledNode(Path(directory) / "state")
            node.token = "isolated-test-token"
            app = meta_shell.create_app(node)
            received, sent = [], []

            async def exercise():
                async def receive():
                    received.append(True)
                    if len(received) > 2:
                        self.fail("The oversized request's remaining body was read")
                    return {"type": "http.request", "body": b"x" * 60000, "more_body": True}

                async def send(event):
                    sent.append(event)

                await app({"type": "http", "asgi": {"version": "3.0"},
                    "http_version": "1.1", "method": "POST", "scheme": "http",
                    "path": "/api", "raw_path": b"/api", "query_string": b"",
                    "root_path": "", "headers": [
                        (b"host", f"127.0.0.1:{node.port}".encode()),
                        (b"authorization", b"Bearer isolated-test-token"),
                        (b"content-type", b"application/json")],
                    "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", node.port)},
                    receive, send)

            asyncio.run(exercise())
            self.assertEqual(len(received), 2)
            self.assertEqual(sent[0]["status"], 413)


class ServiceLifecycleTests(unittest.TestCase):
    def test_managed_stop_unloads_then_start_bootstraps_without_standalone_process(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            args = SimpleNamespace(state=home / "state", port=47831,
                source=home / "system.bend", bend="bend", opencode="opencode", model=None)
            service = home / "Library/LaunchAgents" / (meta_shell.SERVICE + ".plist")
            service.parent.mkdir(parents=True)
            service.write_bytes(plistlib.dumps({"ProgramArguments": meta_shell.launch_args(args)}))
            with patch.object(meta_shell.Path, "home", return_value=home), \
                 patch.object(meta_shell.sys, "platform", "darwin"), \
                 patch.object(meta_shell.subprocess, "Popen") as popen:
                with patch.object(meta_shell.subprocess, "run",
                                  return_value=SimpleNamespace(returncode=0)) as run, \
                     patch.object(meta_shell, "client", side_effect=OSError) as client:
                    result = meta_shell.stop_node(args)
                    self.assertEqual(result, {"stopped": True, "management": "launchd"})
                    self.assertEqual([c.args[0][1] for c in run.call_args_list], ["print", "bootout"])
                    self.assertTrue(all(c.args[2] == "status" for c in client.call_args_list))
                with patch.object(meta_shell.subprocess, "run", side_effect=[
                    SimpleNamespace(returncode=1), SimpleNamespace(returncode=0)]) as run, \
                     patch.object(meta_shell, "client", side_effect=[OSError(), {"state": str(args.state)}]):
                    self.assertEqual(meta_shell.ensure_started(args)["state"], str(args.state))
                    self.assertEqual([c.args[0][1] for c in run.call_args_list], ["print", "bootstrap"])
                popen.assert_not_called()
                args.model = "mismatched-settings"
                with patch.object(meta_shell.subprocess, "run") as run, \
                     patch.object(meta_shell, "client") as client:
                    with self.assertRaisesRegex(RuntimeError, "different settings"):
                        meta_shell.stop_node(args)
                    run.assert_not_called()
                    client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
