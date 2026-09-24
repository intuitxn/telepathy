#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==1.27.0", "agent-client-protocol==0.9.0"]
# ///
"""Resident local meta shell. One owner, native ACP execution, Bend transitions.

Run `uv run runtime/meta_shell.py --help`. Private state lives outside the repo.
The HTTP API and MCP share a loopback listener and a private bearer token.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

DEFAULT_STATE = Path.home() / ".local/state/intuitxn-meta"
DEFAULT_SOURCE = Path(__file__).resolve().parent / "worker/system.bend"
DEFAULT_PORT = 47831
SERVICE = "space.intuitxn.meta"
KERNEL_TIMEOUT = 180
STARTUP_TIMEOUT = KERNEL_TIMEOUT + 60
CHILD_GROUPS: set[int] = set()


def terminate_child_groups():
    """Signal-safe bounded cleanup before a supervisor can forcibly stop this node."""
    for pid in tuple(CHILD_GROUPS):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(pid, signal.SIGKILL)


def private_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def atomic_write(path: Path, text: str):
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with open(tmp, "x", encoding="utf-8") as f:
        os.chmod(tmp, 0o600)
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def token_for(state: Path) -> str:
    private_dir(state)
    path = state / "token"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        value = path.read_text().strip()
        if len(value) < 32:
            raise RuntimeError("Local MCP token is incomplete; preserve and repair the private token file")
        return value
    with os.fdopen(fd, "w") as f:
        value = secrets.token_urlsafe(32)
        f.write(value)
        return value


def line(text: str) -> str:
    """Bounded Bend field; full text is retained separately in the private job."""
    return " ".join(text.split())[:3900] or "(empty)"


class Node:
    def __init__(self, state: Path, source: Path, bend: str, opencode: str,
                 model: str | None = None):
        self.state, self.source = Path(state).resolve(), Path(source).resolve()
        self.bend, self.opencode, self.model = bend, opencode, model
        self.agent_name = "codex" if Path(opencode).name == "codex-acp" else "opencode"
        self.port = DEFAULT_PORT
        self.timeout = 1800
        self.db = None
        self.lock = None
        self.worker = None
        self.wake = asyncio.Event()
        self.kernel_lock = asyncio.Lock()
        self.workspace_lock = asyncio.Lock()
        self.ready = False

    async def start(self):
        private_dir(self.state)
        self.lock = open(self.state / "node.lock", "a+")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            self.lock = None
            raise RuntimeError("A meta node already owns this state directory")
        try:
            self.token = token_for(self.state)
            self.db = sqlite3.connect(self.state / "node.sqlite3")
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, request_id TEXT UNIQUE, fingerprint TEXT,
                    task TEXT, acceptance TEXT, project TEXT, conversation TEXT,
                    status TEXT, created REAL, updated REAL, snapshot TEXT,
                    work_id INTEGER, worker_id INTEGER, session_id TEXT,
                    result TEXT, error TEXT, kernel_source TEXT);
                CREATE TABLE IF NOT EXISTS sessions (
                    conversation TEXT PRIMARY KEY, session_id TEXT NOT NULL);
            """)
            columns = {r[1] for r in self.db.execute("PRAGMA table_info(jobs)")}
            if "kernel_source" not in columns:
                self.db.execute("ALTER TABLE jobs ADD COLUMN kernel_source TEXT")
            for column in ("repo_root", "workspace_path", "workspace_name", "base_commit", "result_commit", "result_bookmark", "workspace_status"):
                if column not in columns:
                    self.db.execute("ALTER TABLE jobs ADD COLUMN " + column + " TEXT")
            self.db.execute("UPDATE jobs SET status='interrupted', error=?, updated=? "
                            "WHERE status='running'",
                            ("Node stopped during execution; inspect evidence before resubmitting. "
                             "No automatic replay.", time.time()))
            self.db.commit()
            await self._check_kernel()
            self.ready = True
            self.worker = asyncio.create_task(self._work_loop())
            self.wake.set()
        except BaseException:
            await self.close()
            raise

    async def _check_kernel(self):
        source = self.source.read_bytes()
        self.source_hash = hashlib.sha256(source).hexdigest()
        kernels = self.state / "kernels"
        private_dir(kernels)
        pinned = kernels / (self.source_hash + ".bend")
        if not pinned.exists():
            atomic_write(pinned, source.decode("utf-8"))
        if hashlib.sha256(pinned.read_bytes()).hexdigest() != self.source_hash:
            raise RuntimeError("Pinned kernel digest mismatch")
        self.source = pinned
        checked = await self._bend("--check-only", raw=True)
        if "All terms check." not in checked:
            raise RuntimeError("Bend checker did not confirm All terms check.")
        atomic_write(self.state / "kernel-check.txt", checked)

    async def close(self):
        self.ready = False
        if self.worker:
            self.worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.worker
            self.worker = None
        if self.db:
            self.db.close()
            self.db = None
        if self.lock:
            self.lock.close()
            self.lock = None

    async def _jj(self, project, *args):
        executable = shutil.which("jj")
        if not executable:
            raise RuntimeError("jj is required for this managed project")
        proc = await asyncio.create_subprocess_exec(
            executable, "--no-pager", "--color=never",
            "--config", 'user.name="Codex"', "--config", 'user.email="codex@local.invalid"',
            *map(str, args), cwd=str(project),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True)
        CHILD_GROUPS.add(proc.pid)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), 120)
        except BaseException:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            await proc.wait()
            raise
        finally:
            CHILD_GROUPS.discard(proc.pid)
        if proc.returncode:
            raise RuntimeError("jj " + " ".join(map(str, args[:2])) + ": " + err.decode(errors="replace")[-4000:])
        return out.decode().strip()

    async def _workspace_prepare(self, job):
        project = Path(job["project"])
        if not any((path / ".jj").exists() for path in (project, *project.parents)):
            return
        async with self.workspace_lock:
            root = Path(await self._jj(project, "root")).resolve()
            if await self._jj(root, "log", "-r", "@", "--no-graph", "-T", "empty") != "true":
                raise RuntimeError("Source jj working change is not empty; preserve it and finish or explicitly select its revision before submitting")
            base = await self._jj(root, "log", "-r", "@-", "--no-graph", "-T", "commit_id")
            if not re.fullmatch(r"[0-9a-f]{40,64}", base):
                raise RuntimeError("Managed task requires one unambiguous parent revision")
            if await self._jj(root, "log", "-r", base, "--no-graph", "-T", "conflict") != "false":
                raise RuntimeError("Task baseline contains unresolved conflicts")
            directory = self.state / "workspaces" / job["id"]
            private_dir(directory.parent)
            name = "meta-" + job["id"]
            self._update(job["id"], repo_root=str(root), workspace_path=str(directory),
                         workspace_name=name, base_commit=base, workspace_status="creating")
            await self._jj(root, "workspace", "add", "--name", name, "-r", base, str(directory))
            relative = project.relative_to(root)
            if not (directory / relative).is_dir():
                raise RuntimeError("Project subdirectory is absent from the selected baseline")
            self._update(job["id"], workspace_status="active")

    def _execution_project(self, job):
        if not job.get("workspace_path"):
            return job["project"]
        relative = Path(job["project"]).relative_to(Path(job["repo_root"]))
        return str(Path(job["workspace_path"]) / relative)

    async def _workspace_result(self, job, *, retiring=False):
        if not job.get("workspace_path"):
            return
        directory = Path(job["workspace_path"])
        if not directory.is_dir():
            raise RuntimeError("Managed workspace is missing; retained evidence must be inspected")
        if retiring and job.get("result_commit"):
            clean = await self._jj(directory, "log", "-r", "@", "--no-graph", "-T", "empty")
            parent = await self._jj(directory, "log", "-r", "@-", "--no-graph", "-T", "commit_id")
            if clean == "true" and parent == job["result_commit"]:
                return job["result_commit"], job["result_bookmark"]
        await self._jj(directory, "util", "snapshot")
        await self._jj(directory, "describe", "-m", "meta task " + job["id"] + ": " + line(job["task"])[:200])
        revision = await self._jj(directory, "log", "-r", "@", "--no-graph", "-T", "commit_id")
        if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
            raise RuntimeError("Could not identify the result revision")
        bookmark = "meta/task/" + job["id"]
        if retiring and job.get("result_commit") and revision != job["result_commit"]:
            # Preserve the reviewed result bookmark and retain subsequent drift separately.
            bookmark = "meta/retired/" + job["id"] + "/" + revision[:12]
        await self._jj(directory, "bookmark", "set", bookmark, "-r", revision)
        if not retiring or not job.get("result_commit"):
            self._update(job["id"], result_commit=revision, result_bookmark=bookmark,
                         workspace_status="reviewable")
        if not retiring:
            ancestry = await self._jj(directory, "log", "-r", job["base_commit"] + "::" + revision,
                                      "--no-graph", "-T", 'commit_id ++ "\\n"')
            if job["base_commit"] not in ancestry.splitlines():
                raise RuntimeError("Task result no longer descends from its recorded baseline")
            conflicts = await self._jj(directory, "log", "-r", "(" + job["base_commit"] + "::" + revision + ") & conflicts()",
                                       "--no-graph", "-T", "commit_id")
            if conflicts:
                raise RuntimeError("Task result contains conflicts; workspace retained for inspection")
            # Freeze the reported revision: subsequent file edits become a child change.
            await self._jj(directory, "new", revision, "-m", "")
        return revision, bookmark

    async def _workspace_action(self, method, params):
        job = self._job(params["id"])
        if not job.get("workspace_path"):
            raise ValueError("Task has no managed jj workspace")
        if method == "workspace":
            return {key: job.get(key) for key in ("id", "status", "repo_root", "workspace_path", "workspace_name", "base_commit", "result_commit", "result_bookmark", "workspace_status")}
        if method == "diff":
            if not job.get("result_commit"):
                raise ValueError("Task has no recorded result revision yet")
            return {"base_commit": job["base_commit"], "result_commit": job["result_commit"],
                    "patch": await self._jj(job["repo_root"], "--ignore-working-copy", "diff", "--from", job["base_commit"], "--to", job["result_commit"], "--git")}
        if job["status"] in {"queued", "running"}:
            raise ValueError("A task must stop before integration or retirement")
        async with self.workspace_lock:
            if method == "integrate":
                if job["status"] != "reported" or job["workspace_status"] not in {"reviewable", "integrating", "integrated"}:
                    raise ValueError("Only a reported, retained result can be integrated")
                if params.get("base_commit") != job["base_commit"] or params.get("result_commit") != job["result_commit"]:
                    raise ValueError("Integration requires the exact reviewed base_commit and result_commit")
                root = Path(job["repo_root"])
                if not (root / ".jj/repo").is_dir():
                    raise ValueError("Integration must target the canonical repository workspace")
                if await self._jj(root, "log", "-r", "@", "--no-graph", "-T", "empty") != "true":
                    raise ValueError("Canonical workspace has changes; integration will not overwrite them")
                current = await self._jj(root, "log", "-r", "main", "--no-graph", "-T", "commit_id")
                resuming = job["workspace_status"] in {"integrating", "integrated"} and current == job["result_commit"]
                if current != job["base_commit"] and not resuming:
                    raise ValueError("main moved from the reviewed base; review a new integration candidate")
                parent = await self._jj(root, "log", "-r", "@-", "--no-graph", "-T", "commit_id")
                if parent != current and not (resuming and parent == job["base_commit"]):
                    raise ValueError("Canonical working copy is not directly on main")
                empty = await self._jj(job["workspace_path"], "log", "-r", "@", "--no-graph", "-T", "empty")
                actual = await self._jj(job["workspace_path"], "log", "-r", "@-", "--no-graph", "-T", "commit_id")
                if empty != "true" or actual != job["result_commit"]:
                    raise ValueError("Workspace changed after result capture; review its new revision")
                conflicts = await self._jj(root, "log", "-r", "(" + current + "::" + actual + ") & conflicts()", "--no-graph", "-T", "commit_id")
                ancestors = await self._jj(root, "log", "-r", current + "::" + actual, "--no-graph", "-T", 'commit_id ++ "\\n"')
                if conflicts or current not in ancestors.splitlines():
                    raise ValueError("Result is conflicted or is not a fast-forward of main")
                self._update(job["id"], workspace_status="integrating")
                if not resuming:
                    await self._jj(root, "bookmark", "set", "main", "-r", actual)
                if parent != actual:
                    await self._jj(root, "new", actual, "-m", "")
                self._update(job["id"], workspace_status="integrated")
            elif method == "retire":
                if job["workspace_status"] == "retired":
                    return await self._workspace_action("workspace", {"id": job["id"]})
                destination = self.state / "retired" / job["id"]
                private_dir(destination.parent)
                if job["workspace_status"] == "retiring" and destination.is_dir() and not Path(job["workspace_path"]).exists():
                    self._update(job["id"], workspace_path=str(destination), workspace_status="retired")
                    return await self._workspace_action("workspace", {"id": job["id"]})
                if destination.exists():
                    raise ValueError("Retirement destination exists; inspect it before retrying")
                if job["workspace_status"] != "retiring":
                    await self._workspace_result(job, retiring=True)
                    self._update(job["id"], workspace_status="retiring")
                names = await self._jj(job["repo_root"], "--ignore-working-copy", "workspace", "list", "-T", 'name ++ "\\n"')
                if job["workspace_name"] in names.splitlines():
                    await self._jj(job["repo_root"], "--ignore-working-copy", "workspace", "forget", job["workspace_name"])
                # Preserve every file, including ignored files, in the private state tree.
                Path(job["workspace_path"]).rename(destination)
                self._update(job["id"], workspace_path=str(destination), workspace_status="retired")
            else:
                raise ValueError("Unknown workspace action")
        return await self._workspace_action("workspace", {"id": job["id"]})

    def _job(self, job_id: str) -> dict:
        row = self.db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise ValueError("Unknown task ID")
        return dict(row)

    def _update(self, job_id: str, **values):
        values["updated"] = time.time()
        self.db.execute("UPDATE jobs SET " + ",".join(k + "=?" for k in values) +
                        " WHERE id=?", (*values.values(), job_id))
        self.db.commit()

    async def dispatch(self, method: str, params: dict) -> dict:
        if method in {"workspace", "diff", "integrate", "retire"}:
            return await self._workspace_action(method, params)
        if method == "status":
            counts = dict(self.db.execute("SELECT status,count(*) FROM jobs GROUP BY status"))
            workspaces = dict(self.db.execute(
                "SELECT workspace_status,count(*) FROM jobs WHERE workspace_status IS NOT NULL GROUP BY workspace_status"))
            return {"ready": self.ready, "pid": os.getpid(), "state": str(self.state),
                    "source": str(self.source), "source_sha256": self.source_hash,
                    "jobs": counts, "jj_workspaces": workspaces,
                    "mcp": f"http://127.0.0.1:{self.port}/mcp",
                    "relay": "not connected"}
        if method == "shutdown":
            # Process shutdown only. A supervisor may restart it; CLI stop unloads launchd.
            asyncio.get_running_loop().call_later(0.2, os.kill, os.getpid(), signal.SIGTERM)
            return {"stopping": True}
        if method == "list":
            return {"tasks": [dict(r) for r in self.db.execute(
                "SELECT id,status,created,project,substr(task,1,120) AS task "
                "FROM jobs ORDER BY created DESC LIMIT 30")]}
        if method == "task":
            return self._job(params["id"])
        if method == "submit":
            task = params.get("task", "")
            acceptance = params.get("acceptance", "Complete the requested task and report evidence and limitations.")
            if not isinstance(task, str) or not task.strip() or len(task) > 64000 or "\x00" in task:
                raise ValueError("Task must contain 1–64000 characters without NUL")
            if not isinstance(acceptance, str) or not acceptance.strip() or len(acceptance) > 16000 or "\x00" in acceptance:
                raise ValueError("Acceptance must contain 1–16000 characters without NUL")
            project = str(Path(params["project"]).expanduser().resolve(strict=True))
            if not Path(project).is_dir():
                raise ValueError("Project must be an existing directory")
            conversation = params.get("conversation") or "local:default"
            if not isinstance(conversation, str) or not 0 < len(conversation) <= 200:
                raise ValueError("Conversation must contain 1–200 characters")
            # Same conversation label in different projects must never share context.
            conversation = hashlib.sha256((project + "\0" + conversation).encode()).hexdigest()
            fingerprint = hashlib.sha256(json.dumps([task, acceptance, project, conversation]).encode()).hexdigest()
            request_id = params.get("request_id") or uuid.uuid4().hex
            if not isinstance(request_id, str) or not 0 < len(request_id) <= 200:
                raise ValueError("Invalid request_id")
            old = self.db.execute("SELECT * FROM jobs WHERE request_id=?", (request_id,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise ValueError("request_id already belongs to a different task")
                return dict(old)
            job_id, now = uuid.uuid4().hex, time.time()
            self.db.execute("INSERT INTO jobs (id,request_id,fingerprint,task,acceptance,project,"
                            "conversation,status,created,updated,kernel_source) VALUES (?,?,?,?,?,?,?,'queued',?,?,?)",
                            (job_id, request_id, fingerprint, task, acceptance, project, conversation, now, now, str(self.source)))
            self.db.commit()
            self.wake.set()
            return self._job(job_id)
        if method == "kernel":
            job = self._job(params["id"])
            operation = params.get("operation", "history")
            if operation not in {"history", "memory", "packet"}:
                raise ValueError("Kernel inspection supports history, memory, packet")
            if not job["snapshot"]:
                raise ValueError("Task has no checkpoint yet")
            args = [operation, job["snapshot"]]
            if operation == "packet":
                if not job["work_id"]:
                    raise ValueError("Task has no work claim yet")
                args.append(str(job["work_id"]))
            async with self.kernel_lock:
                return {"text": await self._bend(*args, source=job["kernel_source"])}
        raise ValueError("Unknown method")

    async def _bend(self, *args, raw=False, source=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith("BUZZ_")}
        env["BEND_NO_TELEMETRY"] = "1"
        command = [self.bend, str(source or self.source), *([] if raw else ["--"]), *map(str, args)]
        proc = await asyncio.create_subprocess_exec(*command, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            start_new_session=True)
        CHILD_GROUPS.add(proc.pid)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), KERNEL_TIMEOUT)
        except BaseException:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, signal.SIGKILL)
            await proc.wait()
            raise
        finally:
            CHILD_GROUPS.discard(proc.pid)
        text = out.decode(errors="replace")
        if proc.returncode:
            raise RuntimeError(f"Bend {args[0]} failed ({proc.returncode}): {text[-3000:]}")
        return text

    async def _transition(self, job_id: str, op: str, *args) -> tuple[int, str]:
        job = self._job(job_id)
        directory = self.state / "tasks" / job_id
        private_dir(directory)
        out = directory / (uuid.uuid4().hex + ".snapshot")
        inputs = [] if op == "init" else [job["snapshot"]]
        async with self.kernel_lock:
            output = await self._bend(op, *inputs, str(out), *args, source=job["kernel_source"])
            if "lorenz_snapshot_saved" not in output or not out.is_file():
                raise RuntimeError("Kernel did not save the expected checkpoint")
            with open(out, "rb") as f:
                os.fsync(f.fileno())
            directory_fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            history = await self._bend("history", str(out), source=job["kernel_source"])
            ids = re.findall(r"^id=(\d+) kind=\d+ status=\S+ reference=\d+ dependency=\d+ source-link=\d+$", history, re.M)
            if op != "init" and not ids:
                raise RuntimeError("Cannot identify resulting Bend event")
            self._update(job_id, snapshot=str(out))
        return int(ids[-1]) if ids else 0, history

    async def _prepare(self, job: dict) -> str:
        job_id = job["id"]
        await self._transition(job_id, "init")
        conversation, _ = await self._transition(job_id, "capture", "retain", "operator", "terminal-or-local-mcp", line(job["task"]))
        work, _ = await self._transition(job_id, "work", str(conversation), "meta", "operator", line(job["acceptance"]))
        worker, _ = await self._transition(job_id, "worker", "meta", self.agent_name,
                                            self.agent_name + "-acp")
        self._update(job_id, work_id=work, worker_id=worker)
        await self._transition(job_id, "claim", str(work), str(worker), "meta")
        return (await self.dispatch("kernel", {"id": job_id, "operation": "packet"}))["text"]

    async def _return(self, job: dict, result: str, evidence: str):
        await self._transition(job["id"], "return", str(job["work_id"]),
                               str(job["worker_id"]), self.agent_name, line(result), line(evidence))

    async def _run_agent(self, job: dict, packet: str) -> dict:
        previous = None if job.get("workspace_path") else self.db.execute(
            "SELECT session_id FROM sessions WHERE conversation=?", (job["conversation"],)).fetchone()
        configuration = {"mcp": {"meta_kernel": {"type": "remote",
            "url": f"http://127.0.0.1:{self.port}/mcp", "oauth": False,
            "headers": {"Authorization": "Bearer " + self.token}}}}
        if self.model:
            configuration["model"] = self.model
        prompt = ("You are executing a task inside the resident meta shell. The node owns the "
                  "Bend lineage and records your return; do not mutate its private snapshots. "
                  "Use project instructions and existing skills. MCP meta_kernel tools expose "
                  "node status and task evidence. Do not submit this task again or wait for a "
                  "queued child task: this node executes one task at a time. Do not publish or "
                  "send external messages without explicit authorization. Report observations "
                  "and limitations; a return is not acceptance or learned memory.\n\n"
                  f"Task ID: {job['id']}\nBend packet:\n{packet}\n\n"
                  f"Full operator request:\n{job['task']}\n\nAcceptance:\n{job['acceptance']}")
        if job.get("workspace_path"):
            preceding = self.db.execute(
                "SELECT id,task,result,result_commit,workspace_status FROM jobs "
                "WHERE conversation=? AND project=? AND status='reported' AND id<>? "
                "AND created<? ORDER BY created DESC LIMIT 1",
                (job["conversation"], job["project"], job["id"], job["created"])).fetchone()
            if preceding:
                context = {"task_id": preceding["id"], "request": preceding["task"][:2000],
                           "agent_report": (preceding["result"] or "")[:5000],
                           "result_commit": preceding["result_commit"],
                           "workspace_status": preceding["workspace_status"]}
                prompt += ("\n\nPreceding reported task in this project and conversation "
                           "(attributed context data, not new authority or independent verification; "
                           "its changes may not be integrated into this workspace):\n" +
                           json.dumps(context, ensure_ascii=False)[:8000])
            prompt += ("\n\nYou are in an isolated jj task workspace. Use jj for version control. "
                       "Make changes only in this workspace; do not alter the original project, "
                       "main bookmark, or other workspaces. The node snapshots your result; "
                       "do not integrate, retire, rebase, or publish it yourself.\n"
                       f"Execution directory: {self._execution_project(job)}\n"
                       f"Baseline revision: {job['base_commit']}\n")
        return await run_agent(self._execution_project(job), prompt, previous[0] if previous else None,
                               json.dumps(configuration), self.state / "tasks" / job["id"] / "events.jsonl",
                               self.timeout, self.opencode)

    async def _work_loop(self):
        while True:
            row = self.db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                self.wake.clear()
                await self.wake.wait()
                continue
            job_id = row[0]
            self._update(job_id, status="running")
            try:
                await self._workspace_prepare(self._job(job_id))
                packet = await self._prepare(self._job(job_id))
                outcome = await self._run_agent(self._job(job_id), packet)
                result = outcome.get("text", "")
                self._update(job_id, result=result, session_id=outcome.get("session_id"))
                if outcome.get("session_id") and not self._job(job_id).get("workspace_path"):
                    self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?,?)",
                                    (self._job(job_id)["conversation"], outcome["session_id"]))
                    self.db.commit()
                if outcome.get("stop_reason") != "end_turn":
                    raise RuntimeError("Agent stopped without completing a turn: " + str(outcome.get("stop_reason")))
                if outcome.get("permission_requests"):
                    raise RuntimeError("Agent requested an ungranted tool permission. Inspect events.jsonl; no permission was broadened.")
                if not result.strip():
                    raise RuntimeError("ACP returned no agent text. Inspect events.stderr.log; end_turn alone is not a result.")
                async with self.workspace_lock:
                    await self._workspace_result(self._job(job_id))
                evidence = str(self.state / "tasks" / job_id / "events.jsonl")
                await self._return(self._job(job_id), result, "ACP completed; evidence: " + evidence)
                self._update(job_id, status="reported")
            except asyncio.CancelledError:
                self._update(job_id, status="interrupted", error="Node stopped during execution. Inspect evidence; not replayed.")
                raise
            except Exception as exc:
                self._update(job_id, status="failed", error=str(exc)[:6000])


def create_app(node: Node):
    from mcp.server.fastmcp import FastMCP
    from starlette.responses import JSONResponse
    mcp = FastMCP("meta-kernel", host="127.0.0.1", port=node.port,
                  stateless_http=True, json_response=True)

    @mcp.tool()
    async def meta_status() -> dict:
        """Inspect this resident node, its kernel revision and task counts."""
        return await node.dispatch("status", {})

    @mcp.tool()
    async def meta_submit(task: str, project: str, acceptance: str,
                          request_id: str, conversation: str = "local:default") -> dict:
        """Queue authorized work; reuse request_id for transport retries. Does not wait.

        This node is serial: an executing agent must not wait for queued work.
        """
        return await node.dispatch("submit", {"task": task, "project": project, "acceptance": acceptance,
                                              "request_id": request_id, "conversation": conversation})

    @mcp.tool()
    async def meta_task(id: str) -> dict:
        """Read a task's state, reported result and failure evidence."""
        return await node.dispatch("task", {"id": id})

    @mcp.tool()
    async def meta_kernel(id: str, operation: str = "history") -> dict:
        """Inspect immutable Bend history, memory or packet for a task."""
        return await node.dispatch("kernel", {"id": id, "operation": operation})

    @mcp.tool()
    async def meta_workspace(id: str) -> dict:
        """Inspect a task's isolated jj workspace and recorded result revision."""
        return await node.dispatch("workspace", {"id": id})

    @mcp.tool()
    async def meta_diff(id: str) -> dict:
        """Read the recorded result patch against its original baseline."""
        return await node.dispatch("diff", {"id": id})

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request):
        return JSONResponse(await node.dispatch("status", {}))

    @mcp.custom_route("/api", methods=["POST"])
    async def api(request):
        try:
            body = b""
            async for chunk in request.stream():
                body += chunk
                if len(body) > 100000:
                    return JSONResponse({"error": "Request too large"}, status_code=413)
            data = json.loads(body)
            if not isinstance(data, dict) or not isinstance(data.get("params", {}), dict):
                raise ValueError("Expected method and params object")
            return JSONResponse(await node.dispatch(data["method"], data.get("params", {})))
        except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

    app = mcp.streamable_http_app()
    original_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(app):
        await node.start()
        try:
            async with original_lifespan(app):
                yield
        finally:
            await node.close()

    app.router.lifespan_context = lifespan

    class Auth:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] == "http":
                headers = dict(scope.get("headers", []))
                supplied = headers.get(b"authorization", b"")
                expected = ("Bearer " + node.token).encode()
                origin = headers.get(b"origin")
                host = headers.get(b"host", b"").decode(errors="replace")
                if (not hmac.compare_digest(supplied, expected) or origin or
                        host not in {f"127.0.0.1:{node.port}", f"localhost:{node.port}"}):
                    await JSONResponse({"error": "Unauthorized local request"}, status_code=401)(scope, receive, send)
                    return
            await self.app(scope, receive, send)
    return Auth(app)


def client(state: Path, port: int, method: str, params=None):
    token = (state / "token").read_text().strip()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api",
        json.dumps({"method": method, "params": params or {}}).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=200) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read().decode()) from exc


def launch_args(args):
    command = [sys.executable, str(Path(__file__).resolve()), "--state", str(args.state),
               "--port", str(args.port), "--source", str(args.source), "--bend", args.bend,
               "--opencode", args.opencode]
    if args.model:
        command += ["--model", args.model]
    return command + ["serve"]


def ensure_started(args):
    try:
        status = client(args.state, args.port, "status")
        if Path(status["state"]) != args.state:
            raise RuntimeError("Port belongs to a different node")
        return status
    except (OSError, RuntimeError):
        pass
    private_dir(args.state)
    token_for(args.state)
    env = {k: v for k, v in os.environ.items() if not k.startswith("BUZZ_")}
    service_file = Path.home() / "Library/LaunchAgents" / (SERVICE + ".plist")
    proc = None
    if sys.platform == "darwin" and service_file.exists():
        spec = plistlib.loads(service_file.read_bytes())
        if spec["ProgramArguments"] != launch_args(args):
            raise RuntimeError("Installed service uses different settings; use its configured entrypoint")
        domain = f"gui/{os.getuid()}"
        probe = subprocess.run(["launchctl", "print", domain + "/" + SERVICE], capture_output=True)
        command = (["launchctl", "bootstrap", domain, str(service_file)] if probe.returncode else
                   ["launchctl", "kickstart", domain + "/" + SERVICE])
        subprocess.run(command, check=True)
    else:
        with open(args.state / "node.log", "a") as log:
            proc = subprocess.Popen(launch_args(args), stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=log, start_new_session=True, env=env)
    # Startup includes a full kernel check; allow its deadline plus import/service overhead.
    for _ in range(STARTUP_TIMEOUT * 2):
        try:
            status = client(args.state, args.port, "status")
            if Path(status["state"]) != args.state:
                raise RuntimeError("Port belongs to a different node")
            return status
        except OSError:
            if proc is not None and proc.poll() is not None:
                raise RuntimeError(f"Node failed to start. Inspect {args.state / 'node.log'}")
            time.sleep(0.5)
    raise RuntimeError(f"Node is not ready. Inspect {args.state / 'node.log'}")


def stop_node(args):
    """Stop the owning service, or the standalone process when no service owns it."""
    service_file = Path.home() / "Library/LaunchAgents" / (SERVICE + ".plist")
    management = "standalone"
    if sys.platform == "darwin" and service_file.exists():
        spec = plistlib.loads(service_file.read_bytes())
        arguments = spec.get("ProgramArguments", [])
        if arguments == launch_args(args):
            target = f"gui/{os.getuid()}/{SERVICE}"
            probe = subprocess.run(["launchctl", "print", target], capture_output=True)
            if not probe.returncode:
                subprocess.run(["launchctl", "bootout", target], check=True)
                management = "launchd"
        elif "--state" in arguments:
            index = arguments.index("--state")
            if index + 1 < len(arguments) and Path(arguments[index + 1]).expanduser().resolve() == args.state:
                raise RuntimeError("Installed service uses different settings; stop it with its configured entrypoint")
    if management == "standalone":
        try:
            client(args.state, args.port, "shutdown")
        except OSError:
            return {"stopped": True, "management": management}
    for _ in range(60):
        try:
            client(args.state, args.port, "status")
        except OSError:
            return {"stopped": True, "management": management}
        time.sleep(0.25)
    raise RuntimeError("Node did not stop; inspect the process and its supervisor")


def install(args):
    if sys.platform != "darwin":
        raise RuntimeError("Automatic login service installation currently supports macOS")
    destination = Path.home() / "Library/LaunchAgents" / (SERVICE + ".plist")
    private_dir(args.state)
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(Path.home())}
    spec = {"Label": SERVICE, "ProgramArguments": launch_args(args),
            "WorkingDirectory": str(Path(__file__).resolve().parent.parent),
            "RunAtLoad": True, "KeepAlive": {"SuccessfulExit": False},
            "EnvironmentVariables": env,
            "StandardOutPath": str(args.state / "node.log"),
            "StandardErrorPath": str(args.state / "node.log")}
    if destination.exists() and plistlib.loads(destination.read_bytes()) != spec:
        raise RuntimeError(f"Existing service differs; preserve and reconcile {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        atomic_write(destination, plistlib.dumps(spec).decode())
    domain = f"gui/{os.getuid()}"
    probe = subprocess.run(["launchctl", "print", domain + "/" + SERVICE], capture_output=True)
    if probe.returncode:
        try:
            running = client(args.state, args.port, "status")
        except OSError:
            running = None
        if running:
            if Path(running["state"]) != args.state:
                raise RuntimeError("Another node is using this port")
            if running["jobs"].get("running", 0) or running["jobs"].get("queued", 0):
                raise RuntimeError("Finish active tasks before transferring node ownership to launchd")
            client(args.state, args.port, "shutdown")
            for _ in range(40):
                try:
                    client(args.state, args.port, "status")
                except OSError:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("Existing node did not stop; service not started")
        subprocess.run(["launchctl", "bootstrap", domain, str(destination)], check=True)
    print(f"Installed {destination}; inspect with meta status")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--bend", default=shutil.which("bend") or str(Path.home() / ".bend/bin/bend"))
    parser.add_argument("--acp-agent", "--opencode", dest="opencode",
                        default=shutil.which("opencode") or str(Path.home() / ".opencode/bin/opencode"))
    parser.add_argument("--model", default=None)
    subs = parser.add_subparsers(dest="command")
    for name in ["serve", "start", "stop", "status", "list", "install"]:
        subs.add_parser(name)
    shell = subs.add_parser("shell")
    shell.add_argument("--project", default=os.getcwd())
    shell.add_argument("--conversation", default="local:default")
    submit = subs.add_parser("submit")
    submit.add_argument("task")
    submit.add_argument("--project", default=os.getcwd())
    submit.add_argument("--acceptance", default="Complete the requested task and report evidence and limitations.")
    submit.add_argument("--conversation", default="local:default")
    submit.add_argument("--request-id", default=None)
    submit.add_argument("--wait", action="store_true")
    for name in ["task", "wait", "kernel", "workspace", "diff", "retire", "integrate"]:
        sub = subs.add_parser(name)
        sub.add_argument("id")
        if name == "integrate":
            sub.add_argument("--base-commit", required=True)
            sub.add_argument("--result-commit", required=True)
        if name == "kernel":
            sub.add_argument("operation", nargs="?", default="history", choices=["history", "memory", "packet"])
    subs.add_parser("mcp-config")
    args = parser.parse_args()
    args.state, args.source = args.state.expanduser().resolve(), args.source.expanduser().resolve()
    args.command = args.command or "shell"
    if args.command == "serve":
        import uvicorn
        node = Node(args.state, args.source, args.bend, args.opencode, args.model)
        node.port = args.port
        class OwnedServer(uvicorn.Server):
            def handle_exit(self, sig, frame):
                # Lifespan startup can be waiting on Bend before normal shutdown runs.
                # Kill owned groups immediately, then preserve uvicorn's signal handling.
                terminate_child_groups()
                super().handle_exit(sig, frame)
        server = OwnedServer(uvicorn.Config(create_app(node), host="127.0.0.1",
                                          port=args.port, log_level="warning"))
        try:
            server.run()
        finally:
            terminate_child_groups()
        return
    if args.command == "install":
        install(args)
        return
    if args.command == "stop":
        print(json.dumps(stop_node(args)))
        return
    if args.command == "mcp-config":
        # Token stays out of printed configuration and shell history.
        print(json.dumps({"meta_kernel": {"type": "remote", "url": f"http://127.0.0.1:{args.port}/mcp",
                         "oauth": False, "headers": {"Authorization": "Bearer {file:" + str(args.state / "token") + "}"}}}, indent=2))
        return
    if args.command in {"start", "shell", "submit"}:
        ensure_started(args)

    def wait_for(job_id):
        previous = None
        while True:
            job = client(args.state, args.port, "task", {"id": job_id})
            if job["status"] != previous:
                print(f"[{job_id[:8]}] {job['status']}", file=sys.stderr)
                previous = job["status"]
            if job["status"] not in {"queued", "running"}:
                print(job.get("result") or job.get("error") or job["status"])
                if job.get("error") and job.get("result"):
                    print(job["error"], file=sys.stderr)
                return job
            time.sleep(1)

    if args.command == "shell":
        print("Meta shell · resident local node · /status /tasks /task ID /new /exit")
        conversation = getattr(args, "conversation", "local:default")
        project = getattr(args, "project", os.getcwd())
        while True:
            try:
                text = input("meta> ").strip()
                if text == "/exit":
                    break
                if text == "/new":
                    conversation = uuid.uuid4().hex
                    print("New conversation")
                    continue
                if text in {"/status", "/tasks"}:
                    print(json.dumps(client(args.state, args.port, "status" if text == "/status" else "list"), indent=2))
                elif text.startswith("/task "):
                    print(json.dumps(client(args.state, args.port, "task", {"id": text.split(maxsplit=1)[1]}), indent=2))
                elif text:
                    job = client(args.state, args.port, "submit", {"task": text, "project": project,
                                 "conversation": conversation, "request_id": uuid.uuid4().hex})
                    print("Task " + job["id"] + " (Ctrl-C detaches; task continues)")
                    wait_for(job["id"])
            except KeyboardInterrupt:
                print("\nDetached from task; node continues.")
            except EOFError:
                break
            except (OSError, RuntimeError, ValueError) as exc:
                print(f"meta: {exc}", file=sys.stderr)
        return
    if args.command == "submit":
        job = client(args.state, args.port, "submit", {k: getattr(args, k) for k in ("task", "project", "acceptance", "conversation", "request_id")})
        print(json.dumps(job, indent=2))
        if args.wait:
            if wait_for(job["id"])["status"] != "reported":
                raise SystemExit(1)
    elif args.command == "wait":
        if wait_for(args.id)["status"] != "reported":
            raise SystemExit(1)
    else:
        method = "status" if args.command == "start" else args.command
        params = {k: v for k, v in vars(args).items() if k in {"id", "operation", "base_commit", "result_commit"}}
        print(json.dumps(client(args.state, args.port, method, params), indent=2))


# Native ACP adapter is defined below, before the main entry point.

import acp
from acp.schema import ClientCapabilities, Implementation


@contextlib.asynccontextmanager
async def owned_acp(client, executable, project, env, stderr):
    """SDK protocol connection with an owned process group for tool cleanup."""
    command = [executable] if Path(executable).name == "codex-acp" else [executable, "acp", "--cwd", project]
    process = await asyncio.create_subprocess_exec(
        *command, cwd=project, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=stderr,
        limit=4 * 1024 * 1024, start_new_session=True)
    CHILD_GROUPS.add(process.pid)
    conn = None
    try:
        conn = acp.connect_to_agent(client, process.stdin, process.stdout)
        yield conn, process
    finally:
        try:
            if conn:
                with contextlib.suppress(Exception, asyncio.CancelledError):
                    await asyncio.wait_for(conn.close(), 2)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), 2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            finally:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                try:
                    await process.wait()
                finally:
                    CHILD_GROUPS.discard(process.pid)


class MetaACPClient:
    def __init__(self, events_path: Path):
        self.events_path = events_path
        self.parts = []
        self.collecting = False
        self.permission_requests = 0

    def record(self, kind, **payload):
        def encode(value):
            if hasattr(value, "model_dump"):
                return value.model_dump(mode="json", by_alias=True, exclude_none=True)
            raise TypeError(type(value).__name__)
        fd = os.open(self.events_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a") as output:
            output.write(json.dumps({"time": time.time(), "kind": kind, **payload}, default=encode) + "\n")

    def on_connect(self, conn):
        self.conn = conn

    async def session_update(self, session_id, update, **kwargs):
        self.record("session_update", session_id=session_id, update=update)
        item = update.model_dump(mode="json", by_alias=True, exclude_none=True)
        if self.collecting and item.get("sessionUpdate") == "agent_message_chunk":
            content = item.get("content", {})
            if content.get("type") == "text":
                self.parts.append(content.get("text", ""))

    async def request_permission(self, options, session_id, tool_call, **kwargs):
        self.permission_requests += 1
        self.record("permission_denied", session_id=session_id, options=options, tool_call=tool_call)
        return acp.RequestPermissionResponse.model_validate({"outcome": {"outcome": "cancelled"}})

    async def ext_method(self, method, params):
        raise acp.RequestError(-32601, "Unsupported client method")

    async def ext_notification(self, method, params):
        self.record("notification", method=method, params=params)


async def run_agent(project: str, prompt: str, session_id: str | None,
                    config_content: str, events_path: Path, timeout: int,
                    executable: str) -> dict:
    """Run one native ACP turn; restore the explicit session on subsequent turns.

    The caller owns serialization and durable session routing. No SDK file or
    terminal capabilities are advertised: OpenCode supplies its native tools.
    Unresolved permission requests are denied and recorded, never auto-approved.
    A timeout closes ACP and escalates child shutdown through the SDK.
    """
    events_path = Path(events_path)
    events_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    client = MetaACPClient(events_path)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("BUZZ_") and key != "INTUITXN_PRIVATE_KEY"}
    is_codex = Path(executable).name == "codex-acp"
    if is_codex:
        env["INITIAL_AGENT_MODE"] = "agent"
        selected_model = json.loads(config_content).get("model")
        if selected_model:
            env["CODEX_CONFIG"] = json.dumps({"model": selected_model})
        # Codex reads its existing local login. MCP is supplied to the ACP
        # session below, rather than through OpenCode configuration.
    else:
        env["OPENCODE_CONFIG_CONTENT"] = config_content
    stderr_path = events_path.with_suffix(".stderr.log")
    stderr_fd = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(stderr_fd, "ab", buffering=0) as stderr:
        try:
            async with asyncio.timeout(timeout):
                async with owned_acp(client, executable, project, env, stderr) as (conn, process):
                    initialized = await asyncio.wait_for(conn.initialize(
                        protocol_version=acp.PROTOCOL_VERSION,
                        client_capabilities=ClientCapabilities(),
                        client_info=Implementation(name="meta-shell", version="0.1.0"),
                    ), 30)
                    client.record("initialized", pid=process.pid, capabilities=initialized.agent_capabilities)
                    if session_id:
                        if not initialized.agent_capabilities.load_session:
                            raise RuntimeError("Agent does not support loading the saved session")
                        await asyncio.wait_for(conn.load_session(cwd=project, session_id=session_id, mcp_servers=[]), 120)
                    else:
                        session = await asyncio.wait_for(conn.new_session(cwd=project, mcp_servers=[]), 120)
                        session_id = session.session_id
                    await asyncio.wait_for(conn.set_session_mode(
                        session_id=session_id, mode_id="agent" if is_codex else "meta"), 30)
                    client.record("session", session_id=session_id)
                    client.collecting = True
                    response = await conn.prompt(
                        session_id=session_id, prompt=[acp.text_block(prompt)],
                    )
                    client.record("completed", session_id=session_id, response=response)
                    output = "".join(client.parts)
                    if is_codex:
                        for entry in output.splitlines():
                            try:
                                failure = json.loads(entry)
                            except json.JSONDecodeError:
                                continue
                            if isinstance(failure, dict) and failure.get("type") == "error":
                                raise RuntimeError("Codex ACP provider error: " +
                                                   str(failure.get("error", failure))[:500])
                    return {"session_id": session_id, "text": output,
                            "stop_reason": response.stop_reason,
                            "permission_requests": client.permission_requests}
        except BaseException as exc:
            client.record("failed", session_id=session_id, error=type(exc).__name__, detail=str(exc))
            raise


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"meta: {exc}", file=sys.stderr)
        raise SystemExit(1)
