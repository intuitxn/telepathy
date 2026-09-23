"""Real jj isolation/integration tests; no models, Bend execution or user state."""
import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import meta_shell


class WorkspaceNode(meta_shell.Node):
    def __init__(self, state):
        super().__init__(state, Path(__file__).with_name('system.bend'), 'unused', 'unused')

    async def _check_kernel(self):
        self.source_hash = 'test-kernel'

    async def _prepare(self, job):
        return 'test packet'

    async def _return(self, job, result, evidence):
        pass


@unittest.skipUnless(shutil.which('jj'), 'jj executable required')
class JJWorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def jj(self, root, *args):
        process = await asyncio.create_subprocess_exec(
            shutil.which('jj'), '--no-pager', '--color=never',
            '--config', 'user.name="Meta Test"', '--config', 'user.email="meta@example.invalid"',
            *args, cwd=str(root), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await process.communicate()
        self.assertEqual(process.returncode, 0, err.decode())
        return out.decode().strip()

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        await self.jj(self.repo, 'git', 'init', '--colocate')
        (self.repo / 'file.txt').write_text('baseline\n')
        (self.repo / '.gitignore').write_text('ignored/\n')
        (self.repo / 'nested').mkdir()
        (self.repo / 'nested/fixture.txt').write_text('nested baseline\n')
        await self.jj(self.repo, 'describe', '-m', 'fixture baseline')
        await self.jj(self.repo, 'bookmark', 'set', 'main', '-r', '@')
        self.base = await self.jj(self.repo, 'log', '-r', '@', '--no-graph', '-T', 'commit_id')
        await self.jj(self.repo, 'new')
        self.node = WorkspaceNode(self.root / 'state')
        self.executions = []
        self.gate = None

        async def fake_agent(project, prompt, session_id, config_content, events_path, timeout, executable):
            self.executions.append({'project': project, 'session_id': session_id, 'prompt': prompt})
            directory = Path(project)
            (directory / 'result.txt').write_text('checked candidate\n')
            if self.gate:
                await self.gate.wait()
            return {'session_id': 'test-session-' + str(len(self.executions)),
                    'text': 'Candidate prepared with evidence', 'stop_reason': 'end_turn'}

        self.patcher = patch.object(meta_shell, 'run_agent', side_effect=fake_agent)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        await self.node.start()
        self.addAsyncCleanup(self.node.close)

    async def submit(self, **changes):
        return await self.node.dispatch('submit', {'task': 'Create candidate result',
            'acceptance': 'Preserve source and report changes', 'project': str(self.repo),
            **changes})

    async def finished(self, job, target=None):
        async with asyncio.timeout(45):
            while True:
                current = await self.node.dispatch('task', {'id': job['id']})
                if target and current['status'] == target:
                    return current
                if not target and current['status'] not in ('queued', 'running'):
                    return current
                await asyncio.sleep(0.02)

    async def candidate(self, **changes):
        job = await self.finished(await self.submit(**changes))
        self.assertEqual(job['status'], 'reported', job.get('error'))
        return job

    async def test_isolation_freezes_result_and_preserves_source(self):
        job = await self.candidate()
        self.assertFalse((self.repo / 'result.txt').exists())
        self.assertEqual((self.repo / 'file.txt').read_text(), 'baseline\n')
        self.assertEqual(await self.jj(self.repo, 'log', '-r', 'main', '--no-graph', '-T', 'commit_id'), self.base)
        workspace = Path(job['workspace_path'])
        self.assertEqual(Path(self.executions[0]['project']), workspace)
        self.assertEqual(await self.jj(workspace, 'log', '-r', '@', '--no-graph', '-T', 'empty'), 'true')
        self.assertEqual(await self.jj(workspace, 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'), job['result_commit'])
        self.assertEqual(await self.jj(self.repo, 'log', '-r', job['result_bookmark'], '--no-graph', '-T', 'commit_id'), job['result_commit'])
        diff = await self.node.dispatch('diff', {'id': job['id']})
        self.assertIn('result.txt', diff['patch'])

    async def test_dirty_source_rejected_without_agent_execution(self):
        (self.repo / 'file.txt').write_text('uncommitted operator work\n')
        job = await self.finished(await self.submit())
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(self.executions, [])
        self.assertEqual((self.repo / 'file.txt').read_text(), 'uncommitted operator work\n')

    async def test_tasks_use_fresh_sessions_and_map_subdirectories(self):
        first = await self.candidate(project=str(self.repo / 'nested'), conversation='same')
        second = await self.candidate(project=str(self.repo / 'nested'), conversation='same')
        self.assertEqual([x['session_id'] for x in self.executions], [None, None])
        self.assertEqual(Path(self.executions[0]['project']), Path(first['workspace_path']) / 'nested')
        self.assertNotEqual(first['workspace_path'], second['workspace_path'])
        self.assertIn('Candidate prepared with evidence', self.executions[1]['prompt'])

    async def test_integration_requires_exact_reviewed_hashes(self):
        job = await self.candidate()
        for params in ({}, {'base_commit': self.base, 'result_commit': '0' * 40}):
            with self.assertRaisesRegex(ValueError, 'exact reviewed'):
                await self.node.dispatch('integrate', {'id': job['id'], **params})
        self.assertFalse((self.repo / 'result.txt').exists())
        args = {'id': job['id'], 'base_commit': job['base_commit'], 'result_commit': job['result_commit']}
        result = await self.node.dispatch('integrate', args)
        self.assertEqual(result['workspace_status'], 'integrated')
        self.assertEqual((self.repo / 'result.txt').read_text(), 'checked candidate\n')
        self.assertEqual(await self.jj(self.repo, 'log', '-r', 'main', '--no-graph', '-T', 'commit_id'), job['result_commit'])
        again = await self.node.dispatch('integrate', args)
        self.assertEqual(again['workspace_status'], 'integrated')

    async def test_drift_blocks_integration_and_retirement_keeps_ignored_files(self):
        job = await self.candidate()
        workspace = Path(job['workspace_path'])
        (workspace / 'result.txt').write_text('post-review drift\n')
        ignored = workspace / 'ignored'
        ignored.mkdir()
        (ignored / 'private.txt').write_text('retained ignored fixture\n')
        with self.assertRaisesRegex(ValueError, 'changed after result capture'):
            await self.node.dispatch('integrate', {'id': job['id'], 'base_commit': job['base_commit'], 'result_commit': job['result_commit']})
        result = await self.node.dispatch('retire', {'id': job['id']})
        self.assertEqual(result['workspace_status'], 'retired')
        retained = Path(result['workspace_path'])
        self.assertFalse(workspace.exists())
        self.assertEqual((retained / 'ignored/private.txt').read_text(), 'retained ignored fixture\n')
        self.assertEqual((retained / 'result.txt').read_text(), 'post-review drift\n')
        self.assertEqual(await self.jj(self.repo, 'log', '-r', job['result_bookmark'], '--no-graph', '-T', 'commit_id'), job['result_commit'])
        again = await self.node.dispatch('retire', {'id': job['id']})
        self.assertEqual(again['workspace_path'], str(retained))

    async def test_integration_preserves_new_operator_edits(self):
        job = await self.candidate()
        (self.repo / 'file.txt').write_text('operator edit after task\n')
        with self.assertRaisesRegex(ValueError, 'Canonical workspace has changes'):
            await self.node.dispatch('integrate', {'id': job['id'],
                'base_commit': job['base_commit'], 'result_commit': job['result_commit']})
        self.assertEqual((self.repo / 'file.txt').read_text(), 'operator edit after task\n')
        self.assertFalse((self.repo / 'result.txt').exists())

    async def test_integration_resumes_after_bookmark_move_interruption(self):
        job = await self.candidate()
        args = {'id': job['id'], 'base_commit': job['base_commit'], 'result_commit': job['result_commit']}
        original = self.node._jj

        async def interrupted(project, *command):
            output = await original(project, *command)
            if command[:3] == ('bookmark', 'set', 'main'):
                raise RuntimeError('simulated interruption after bookmark move')
            return output

        with patch.object(self.node, '_jj', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'simulated interruption'):
                await self.node.dispatch('integrate', args)
        interim = await self.node.dispatch('workspace', {'id': job['id']})
        self.assertEqual(interim['workspace_status'], 'integrating')
        final = await self.node.dispatch('integrate', args)
        self.assertEqual(final['workspace_status'], 'integrated')
        self.assertEqual((self.repo / 'result.txt').read_text(), 'checked candidate\n')

    async def test_retirement_resumes_after_workspace_forget_interruption(self):
        job = await self.candidate()
        workspace = Path(job['workspace_path'])
        (workspace / 'ignored').mkdir()
        (workspace / 'ignored/private.txt').write_text('preserve through interrupted retirement\n')
        original = self.node._jj

        async def interrupted(project, *command):
            output = await original(project, *command)
            if 'workspace' in command and 'forget' in command:
                raise RuntimeError('simulated interruption after workspace forget')
            return output

        with patch.object(self.node, '_jj', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'simulated interruption'):
                await self.node.dispatch('retire', {'id': job['id']})
        self.assertTrue(workspace.exists())
        result = await self.node.dispatch('retire', {'id': job['id']})
        self.assertEqual(result['workspace_status'], 'retired')
        self.assertEqual((Path(result['workspace_path']) / 'ignored/private.txt').read_text(),
                         'preserve through interrupted retirement\n')

    async def test_interrupt_preserves_work_and_never_replays(self):
        self.gate = asyncio.Event()
        job = await self.submit()
        async with asyncio.timeout(45):
            while not self.executions:
                await asyncio.sleep(0.02)
        await self.node.close()
        replacement = WorkspaceNode(self.root / 'state')
        await replacement.start()
        self.addAsyncCleanup(replacement.close)
        retained = await replacement.dispatch('task', {'id': job['id']})
        self.assertEqual(retained['status'], 'interrupted')
        self.assertEqual((Path(retained['workspace_path']) / 'result.txt').read_text(), 'checked candidate\n')
        self.assertEqual(len(self.executions), 1)
        self.assertFalse((self.repo / 'result.txt').exists())


if __name__ == '__main__':
    unittest.main()
