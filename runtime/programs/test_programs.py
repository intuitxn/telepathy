import asyncio
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
import os
import cli
from nudge.program_dsl import AdapterRunResult, Usage, run_program, compile_program

class FixtureAdapter:
    def __init__(self, output):
        self.output, self.called = output, False
    def capabilities(self):
        return cli.Oc2Adapter(cli.DEFAULT_MODEL, 'https://example.test').capabilities()
    async def run(self, request):
        self.called = True
        return AdapterRunResult(output=self.output, usage=Usage(1,1,1,1))

class ProgramContracts(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        env = patch.dict(os.environ, {'TELEPATHY_PROGRAM_STATE_ROOT': self.state.name})
        env.start()
        self.addCleanup(env.stop)

    def candidate(self):
        source = cli.source_named('artifact-design')
        return {'source': source.replace('Keep output concise.', 'Keep output concise. Prefer short paragraphs.'),
                'parentDigest': cli.compile_named('artifact-design').package_digest}

    def test_candidate_frozen_contract_and_stale_parent(self):
        candidate = self.candidate()
        self.assertTrue(cli.validate_candidate('artifact-design', candidate)['valid'])
        for invalid in [dict(candidate, source=candidate['source'].replace('max_turns = 1', 'max_turns = 2')),
                        dict(candidate, parentDigest='sha256:'+'0'*64),
                        dict(candidate, source=candidate['source'].replace('nudge-prompt user', 'nudge-prompt system'))]:
            with self.assertRaises(Exception): cli.validate_candidate('artifact-design', invalid)

    def test_promotion_requires_exact_digest_and_preserves_baseline(self):
        candidate = self.candidate()
        baseline = (cli.ROOT / 'programs/artifact-design.nudge.md').read_text()
        digest = cli.validate_candidate('artifact-design', candidate)['candidateDigest']
        with self.assertRaises(ValueError):
            cli.promote_candidate('artifact-design', dict(candidate, candidateDigest='sha256:'+'0'*64))
        result = cli.promote_candidate('artifact-design', dict(candidate, candidateDigest=digest))
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
        async def leaking_run(adapter, request):
            return AdapterRunResult(output={'title': 'Notes', 'body': 'Private: private-message-123'},
                usage=Usage(1,1,1,35))
        with patch.object(cli.Oc2Adapter, 'run', leaking_run):
            result = asyncio.run(cli.invoke('artifact-design',
                {'title':'Notes','body':'Approved text','sourceIds':['private-message-123']}))
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('output', result)
        self.assertNotIn('private-message-123', str(result))

    def test_all_sources_compile_deterministically(self):
        for name in cli.REGISTRY:
            first, second = cli.compile_named(name), cli.compile_named(name)
            self.assertEqual(first.package_digest, second.package_digest)
            self.assertFalse(first.steps)
            self.assertIsNone(first.delegation)
            self.assertIsNone(first.objective)
    def test_invalid_source_rejected(self):
        source = (cli.ROOT / 'programs/artifact-design.nudge.md').read_text()
        for invalid in [source.replace('max_turns = 1', 'max_turns = 0'), source.replace('{{ body }}', '{{ secret }}')]:
            with self.assertRaises(Exception):
                compile_program(invalid)
    def test_input_rejected_before_adapter(self):
        adapter = FixtureAdapter({'title':'x','body':'x'})
        with self.assertRaises(Exception):
            asyncio.run(run_program(cli.compile_named('artifact-design'), {'title':'x'}, adapter, bindings={'reasoner':cli.DEFAULT_MODEL}))
        self.assertFalse(adapter.called)
    def test_missing_extra_and_wrong_output_fields_fail(self):
        for output in [{'title':'x'}, {'title':'x','body':'x','approved':True}, {'title':7,'body':'x'}]:
            with self.assertRaises(Exception):
                asyncio.run(run_program(cli.compile_named('artifact-design'), {'title':'x','body':'x','sourceIds':[]}, FixtureAdapter(output), bindings={'reasoner':cli.DEFAULT_MODEL}))
    def test_valid_contract(self):
        result = asyncio.run(run_program(cli.compile_named('artifact-design'), {'title':'x','body':'x','sourceIds':[]}, FixtureAdapter({'title':'x','body':'x'}), bindings={'reasoner':cli.DEFAULT_MODEL}))
        self.assertEqual(result.output['title'], 'x')
    def test_binding_rejects_shell_and_secret_url(self):
        with self.assertRaises(ValueError):
            cli.Oc2Adapter('x/$(secret)', 'https://example.test')
    def test_unknown_program(self):
        with self.assertRaises(ValueError):
            cli.compile_named('../../private')

if __name__ == '__main__': unittest.main()
