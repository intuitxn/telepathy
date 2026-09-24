"""Independent wire-level checks of the Bend interpreter and its resource limits."""
import json
import os
import subprocess
import unittest
import run as harness

class DSLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = os.environ.get('BEND_HARNESS_BINARY')
        if binary:
            cls.argv = [binary]
        else:
            kernel = harness.Kernel()
            cls.argv = [kernel.engine, kernel.binary]
            if hasattr(kernel, 'build'):
                cls.addClassCleanup(kernel.build.cleanup)

    def call(self, program, observations='', check=False):
        args = ['dsl-check', program] if check else ['dsl', program, observations]
        return subprocess.run([*self.argv, *args], capture_output=True, text=True, timeout=30)

    def step(self, program, observations=''):
        result = self.call(program, observations)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def rejected(self, program, observations=''):
        result = self.call(program, observations)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('"status":"error"', result.stdout + result.stderr)

    def test_effects_and_unicode(self):
        for kind in ('model', 'tool', 'retrieve'):
            self.assertEqual(self.step(f'{kind}\naé😀'),
                             dict(status='effect', index=0, kind=kind, ref='aé😀'))
        self.assertEqual(self.step('tool\nx\n', 'ok\n'), dict(status='done', ok=True, effects=1))

    def test_sequence_branch_recovers_failure(self):
        program = 'sequence\nmodel\nfirst\nbranch\nok\ntool\npass\ntool\nrecover'
        self.assertEqual(self.step(program, 'fail')['ref'], 'recover')
        self.assertEqual(self.step(program, 'ok')['ref'], 'pass')
        self.assertEqual(self.step(program, 'fail\nok'), dict(status='done', ok=True, effects=2))
        self.assertEqual(self.step('branch\nalways\ntool\nyes\ntool\nno')['ref'], 'yes')
        self.assertEqual(self.step('sequence\ntool\na\nbranch\nfail\ntool\nyes\ntool\nno', 'fail')['ref'], 'yes')

    def test_verify_failure_and_retry(self):
        program = 'repeat\n3\nok\nverify\ncontract\nmodel\nsolver'
        self.assertEqual(self.step(program, 'ok')['kind'], 'verify')
        self.assertEqual(self.step(program, 'ok\nfail')['kind'], 'model')
        self.assertEqual(self.step(program, 'ok\nfail\nok\nok'), dict(status='done', ok=True, effects=4))
        # A failed body cannot become success through a verifier.
        self.assertEqual(self.step('verify\ncontract\nmodel\nsolver', 'fail'), dict(status='done', ok=False, effects=1))
        self.assertEqual(self.step(program, 'fail\nfail\nfail'), dict(status='done', ok=False, effects=3))

    def test_repeat_bounds_and_stop_rules(self):
        self.assertEqual(self.step('repeat\n2\nnever\ntool\nx', 'ok')['index'], 1)
        self.assertEqual(self.step('repeat\n2\nfail\ntool\nx', 'fail'), dict(status='done', ok=False, effects=1))
        self.assertEqual(self.step('repeat\n1\nok\ntool\nx', 'fail'), dict(status='done', ok=False, effects=1))

    def test_preflight_includes_unused_branches(self):
        result = self.call('branch\nalways\nverify\ncontract\nmodel\na\nretrieve\nunused', check=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), dict(status='valid', effects=[
            dict(kind='model', ref='a'), dict(kind='verify', ref='contract'), dict(kind='retrieve', ref='unused')]))

    def test_malformed_programs_and_observations(self):
        for program in ('', 'unknown\nx', 'model', 'model\nx\nextra', 'sequence\nmodel\nx',
                        'repeat\n0\nok\ntool\nx', 'repeat\n33\nok\ntool\nx',
                        'repeat\n01\nok\ntool\nx', 'repeat\n-1\nok\ntool\nx',
                        'repeat\n2\nalways\ntool\nx', 'branch\nnever\ntool\na\ntool\nb',
                        'verify\n\nmodel\nx', 'tool\n' + 'x' * 129):
            with self.subTest(program=program[:80]):
                self.rejected(program)
        self.rejected('tool\nx', 'bogus')
        self.rejected('tool\nx', 'ok\nok')
        self.rejected('tool\nx', '\n'.join(['ok'] * 129))
        self.rejected('tool\nx', 'ok\n\nfail')

    def test_resource_limits(self):
        self.rejected('verify\nx\n' * 129 + 'tool\nx')
        self.rejected('tool\n' + 'x' * 17000)
        # Nested finite loops cannot issue a 129th effect.
        program = 'repeat\n32\nnever\nrepeat\n32\nnever\ntool\nx'
        self.rejected(program, '\n'.join(['ok'] * 128))
        # Control steps count even when unused branches issue no effects.
        body = 'tool\nx'
        for _ in range(70):
            body = 'branch\nalways\n' + body + '\ntool\nunused'
        program = 'repeat\n32\nnever\n' + body
        result = self.call(program, '\n'.join(['ok'] * 28))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('transition_budget_exhausted', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
