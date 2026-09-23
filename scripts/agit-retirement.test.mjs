// The retired Git lifecycle must never mutate repositories, even for old callers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./agit.py', import.meta.url));

test('legacy agit mutations fail without touching a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agit-retired-'));
  try {
    writeFileSync(join(dir, 'evidence'), 'preserve me');
    for (const command of ['propose', 'ready', 'run', 'prove', 'review', 'accept', 'cancel', 'state', 'log']) {
      const result = spawnSync(process.env.PYTHON || 'python3', [script, '--repo', dir, command, '--job', 'test'], { encoding: 'utf8', cwd: dir });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /agit is retired/);
      assert.match(result.stderr, /jj workspaces/);
      assert.deepEqual(readdirSync(dir), ['evidence']);
      assert.equal(readFileSync(join(dir, 'evidence'), 'utf8'), 'preserve me');
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('agit help explains the replacement without claiming a working lifecycle', () => {
  const result = spawnSync(process.env.PYTHON || 'python3', [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mutations are disabled/);
  assert.match(result.stdout, /docs\/WORKTREE_LIFECYCLE.md/);
});
