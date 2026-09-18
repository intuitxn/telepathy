"""Single-run harness contracts: v1.1 (nudge.transaction/v1.1, stdlib-only).

Ports test intent per docs/designs/nudge-simplify.md §4 step 5 (frozen
contract, stale parent, exact-digest promotion, extra/unknown fields,
unknown template var, reserved names, shell/URL binding) to v1.1, plus
harness-level canonicalization vectors and dual-digest surfacing.

Legacy nudge.prompt/v1 is rejected with a recompile directive — no
fallback, no external package.
 """
import asyncio
import os
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import cli
import v11

USAGE = {'turns': 1, 'model_calls': 1, 'input_chars': 1, 'output_chars': 1}

def valid_inputs():
    return {'title': 'x', 'body': 'x', 'sourceIds': []}

def valid_output():
    return {'title': 'x', 'body': 'x'}

class V11Harness(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        env = patch.dict(os.environ, {'TELEPATHY_PROGRAM_STATE_ROOT': self.state.name})
        env.start()
        self.addCleanup(env.stop)

    def candidate(self):
        source = cli.source_named('artifact-design')
        # count=1: prompt-fence edit only; the frozen bend-law constants stay untouched.
        return {'source': source.replace('Keep output concise.', 'Keep output concise. Prefer short paragraphs.', 1),
                'parentDigest': cli.compile_named('artifact-design').package_digest}

    def test_v11_sources_dispatch_to_v11_compiler(self):
        for name in cli.REGISTRY:
            source = cli.source_named(name)
            self.assertEqual(cli._schema_of(source), v11.SCHEMA)
            self.assertIsInstance(cli.compile_named(name), v11.V11Bundle)

    def test_candidate_frozen_contract_and_stale_parent(self):
        candidate = self.candidate()
        self.assertTrue(cli.validate_candidate('artifact-design', candidate)['valid'])
        parent_source = cli.source_named('artifact-design')
        contract_change = parent_source.replace('[inputs]\n', '[inputs]\nflag = "bool"\n', 1)
        fence_role_change = parent_source.replace('```nudge-prompt user', '```nudge-prompt assistant')
        for invalid in [dict(candidate, source=contract_change),
                        dict(candidate, parentDigest='sha256:'+'0'*64),
                        dict(candidate, source=fence_role_change)]:
            with self.assertRaises(Exception): cli.validate_candidate('artifact-design', invalid)

    def test_cross_schema_candidate_rejected(self):
        candidate = self.candidate()
        v10ish = candidate['source'].replace(
            'schema = "nudge.transaction/v1.1"', 'schema = "nudge.prompt/v1"', 1)
        self.assertEqual(cli._schema_of(v10ish), 'nudge.prompt/v1')
        with self.assertRaises(ValueError):
            cli.validate_candidate('artifact-design', dict(candidate, source=v10ish))

    def test_promotion_requires_exact_digest_and_preserves_baseline(self):
        candidate = self.candidate()
        baseline = (cli.ROOT / 'programs/artifact-design.nudge.md').read_text()
        digest = cli.validate_candidate('artifact-design', candidate)['candidateDigest']
        with self.assertRaises(ValueError):
            cli.promote_candidate('artifact-design', dict(candidate, candidateDigest='sha256:'+'0'*64))
        result = cli.promote_candidate('artifact-design', dict(candidate, candidateDigest=digest))
        self.assertEqual(result['frozenDigest'], cli.compile_named('artifact-design').frozen_digest)
        self.assertEqual(cli.compile_named('artifact-design').package_digest, digest)
        self.assertEqual((cli.ROOT / 'programs/artifact-design.nudge.md').read_text(), baseline)
        self.assertEqual(len(list((cli.state_root() / 'sources').glob('*.nudge.md'))), 2)
        with self.assertRaises(ValueError):
            cli.promote_candidate('artifact-design', dict(candidate, candidateDigest=digest))

    def test_model_reviewer_claim_is_not_promotion_input(self):
        candidate = self.candidate()
        digest = cli.validate_candidate('artifact-design', candidate)['candidateDigest']
        with self.assertRaises(ValueError):
            cli.promote_candidate('artifact-design', dict(candidate, candidateDigest=digest, reviewer='Om approved'))

    def test_public_artifact_rejects_private_provenance(self):
        for source_id in ['579b903e92ca00e7', 'smoke-fixture', 'short']:
            for field in ['title', 'body']:
                output = {'title': 'Team notes', 'body': 'We will test shared pages.'}
                output[field] += ' [' + source_id + ']'
                with self.assertRaises(ValueError):
                    cli.validate_public_artifact({'sourceIds': [source_id]}, output)
        cli.validate_public_artifact({'sourceIds': ['private-message-123']},
            {'title': 'Team notes', 'body': 'We will test shared pages.'})

    def test_invoke_does_not_accept_or_leak_source_reference(self):
        async def leaking_run_v11(adapter, bundle, rendered):
            return ({'title': 'Notes', 'body': 'Private: private-message-123'}, dict(USAGE, output_chars=35))
        with patch.object(cli.Oc2Adapter, 'run_v11', leaking_run_v11):
            result = asyncio.run(cli.invoke('artifact-design',
                {'title':'Notes','body':'Approved text','sourceIds':['private-message-123']}))
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('output', result)
        self.assertNotIn('private-message-123', str(result))

    def test_all_sources_compile_deterministically(self):
        for name in cli.REGISTRY:
            first, second = cli.compile_named(name), cli.compile_named(name)
            self.assertIsInstance(first, v11.V11Bundle)
            self.assertEqual(first.package_digest, second.package_digest)
            self.assertEqual(first.frozen_digest, second.frozen_digest)
            self.assertEqual(first.canonical, second.canonical)

    def test_invalid_source_rejected(self):
        source = cli.source_named('artifact-design')
        for invalid in [source.replace('[limits]', '[limits]\nmax_turns = 0', 1),
                        source.replace('{{ body }}', '{{ secret }}')]:
            with self.assertRaises(v11.V11CompileError):
                v11.compile_v11(invalid)

    def test_reserved_names_rejected(self):
        source = cli.source_named('artifact-design')
        with self.assertRaises(v11.V11CompileError):
            v11.compile_v11(source.replace('[inputs]\n', '[inputs]\nreviewer = "string"\n', 1))

    def test_input_rejected_before_adapter(self):
        with patch.object(cli.Oc2Adapter, 'run_v11', AsyncMock()) as run:
            result = asyncio.run(cli.invoke('artifact-design', {'title': 'x'}))
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('output', result)
        run.assert_not_called()

    def test_missing_extra_and_wrong_output_fields_fail(self):
        def run_v11_for(output):
            async def fake(adapter, bundle, rendered):
                return dict(output), dict(USAGE)
            return fake
        for output in [{'title':'x'}, {'title':'x','body':'x','approved':True}, {'title':7,'body':'x'}]:
            with patch.object(cli.Oc2Adapter, 'run_v11', run_v11_for(output)):
                result = asyncio.run(cli.invoke('artifact-design', valid_inputs()))
            self.assertEqual(result['status'], 'failed', msg=str(output))
            self.assertNotIn('output', result)

    def test_valid_contract(self):
        async def fake(adapter, bundle, rendered):
            return valid_output(), dict(USAGE)
        with patch.object(cli.Oc2Adapter, 'run_v11', fake):
            result = asyncio.run(cli.invoke('artifact-design', valid_inputs()))
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['output'], valid_output())

    def test_canonicalization_vectors_hold_at_harness_level(self):
        base = cli.source_named('artifact-design')
        expected = cli.compile_named('artifact-design').package_digest
        self.assertEqual(v11.compile_v11(base.replace('\n', '\r\n')).package_digest, expected)
        self.assertEqual(v11.compile_v11(base.rstrip('\n')).package_digest, expected)

    def test_fence_only_edit_keeps_frozen_digest(self):
        base = cli.source_named('artifact-design')
        parent = v11.compile_v11(base)
        edited = base.replace('Keep output concise.', 'Keep output concise. Prefer short paragraphs.', 1)
        candidate = v11.compile_v11(edited)
        self.assertEqual(candidate.frozen_digest, parent.frozen_digest)
        self.assertNotEqual(candidate.package_digest, parent.package_digest)

    def test_compile_surfaces_dual_digests(self):
        bundle = cli.compile_named('artifact-design')
        for digest in [bundle.package_digest, bundle.frozen_digest]:
            self.assertRegex(digest, r'^sha256:[0-9a-f]{64}$')
        self.assertNotEqual(bundle.package_digest, bundle.frozen_digest)

    def test_binding_rejects_shell_and_secret_url(self):
        with self.assertRaises(ValueError):
            cli.Oc2Adapter('x/$(secret)', 'https://example.test')

    def test_unknown_program(self):
        with self.assertRaises(ValueError):
            cli.compile_named('../../private')

class LegacyRejected(unittest.TestCase):
    """nudge.prompt/v1 has no fallback: every entry point refuses it."""

    def test_capabilities_pin_harness_protocol_without_external_package(self):
        capabilities = cli.Oc2Adapter(cli.DEFAULT_MODEL, 'https://example.test').capabilities()
        self.assertEqual(capabilities['protocol'], 'nudge.harness/v1')

    def test_v10_schema_source_is_not_v11(self):
        source = cli.source_named('artifact-design')
        v10ish = source.replace(
            'schema = "nudge.transaction/v1.1"', 'schema = "nudge.prompt/v1"', 1)
        self.assertFalse(cli._is_v11_source(v10ish))
        with self.assertRaises(v11.V11CompileError):
            v11.compile_v11(v10ish)


class RunnerAndGate(unittest.TestCase):
    def test_bend_gate_open_without_law(self):
        result = cli.bend_gate('lesson-proposal')
        self.assertEqual(result['status'], 'open')
        self.assertEqual(result['gate']['reason'], 'no_law')

    def test_bend_gate_proven_with_inline_law(self):
        import shutil
        if shutil.which('bend') is None and not cli._bend_binary().is_file():
            self.skipTest('no Bend binary')
        result = cli.bend_gate('artifact-design')
        self.assertEqual(result['status'], 'proven')

    def test_gate_blocks_prove_trivial_law(self):
        import shutil
        if shutil.which('bend') is None and not cli._bend_binary().is_file():
            self.skipTest('no Bend binary')
        law = 'import Base\n\nlaw lamp_on:\n  {1n == 1n : Nat}\n'
        proof = 'def Laws.lamp_on():\n  {==}\n'
        verdict = cli.gate_blocks(law, proof)
        self.assertEqual(verdict['status'], 'proven')

    def test_gate_needs_toolchain_without_binary(self):
        with patch.dict(os.environ, {'BEND_BINARY': '/nonexistent/bend-binary'}):
            verdict = cli.gate_blocks('law x:\n  {1n == 1n : Nat}\n', None)
        self.assertEqual(verdict['status'], 'needs-toolchain')




class PinnedRunner(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        env = patch.dict(os.environ, {'TELEPATHY_PROGRAM_STATE_ROOT': self.state.name})
        env.start()
        self.addCleanup(env.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_gen_runner_pins_current_digest(self):
        import subprocess
        path = cli.gen_runner('artifact-design', self.tmp.name)
        self.assertTrue(path.is_file())
        text = path.read_text()
        self.assertIn(cli.compile_named('artifact-design').package_digest, text)

    def test_stale_runner_refuses_after_promotion(self):
        import subprocess
        path = cli.gen_runner('artifact-design', self.tmp.name)
        candidate = {'source': cli.source_named('artifact-design').replace(
            'Keep output concise.', 'Keep output concise. Prefer short paragraphs.', 1),
            'parentDigest': cli.compile_named('artifact-design').package_digest}
        digest = cli.validate_candidate('artifact-design', candidate)['candidateDigest']
        cli.promote_candidate('artifact-design', dict(candidate, candidateDigest=digest))
        completed = subprocess.run([sys.executable, str(path)], input='{}',
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn('digest_drift', completed.stdout)


if __name__ == '__main__': unittest.main()
