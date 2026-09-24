import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import http from 'node:http';
const exec = promisify(execFile);
const source = fileURLToPath(new URL('system.bend', import.meta.url));
const bend = process.env.BEND || path.join(os.homedir(), '.bend/bin/bend');
const run = async args => (await exec(bend, [source, ...args], {
  env: { ...process.env, BEND_NO_TELEMETRY: '1' }, timeout: 120000, maxBuffer: 4 * 1024 * 1024,
})).stdout;

test('RRSI Bend selection requires every measured guard', async () => {
  const select = async flags => JSON.parse((await run(['--', 'rrsi-select', ...flags])).trim()).selected;
  assert.equal(await select(['1', '1', '1', '1', '1']), true);
  for (let missing = 0; missing < 5; missing++) {
    const flags = ['1', '1', '1', '1', '1'];
    flags[missing] = '0';
    assert.equal(await select(flags), false);
  }
  await assert.rejects(run(['--', 'rrsi-select', '1', '1', 'maybe', '1', '1']),
    error => /requires five 0\/1 flags/.test(error.stdout + error.stderr));
});

test('native worker laws, ownership, explicit learning and correction survive fresh processes', async () => {
  assert.match(await run(['--check-only']), /All terms check\./);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-worker-'));
  const f = n => path.join(dir, String(n));
  const call = (...args) => run(['--', ...args]);
  const rejected = async (...args) => {
    await assert.rejects(call(...args), e => /lorenz_invalid|lorenz_output_exists/.test(e.stdout + e.stderr));
  };
  try {
    await call('init', f(0));
    await call('capture', f(0), f(1), 'retain', 'operator', 'test:worker', 'Find the maximum of 3, 9, 2');
    await call('work', f(1), f(2), '1', 'coordinator', 'operator', 'Independent maximum is 9');
    await call('worker', f(2), f(3), 'coordinator', 'worker-a', 'codex');
    await call('worker', f(3), f(4), 'coordinator', 'worker-b', 'opencode');
    await rejected('worker', f(4), f('bad-worker'), 'coordinator', 'worker-a', 'codex');
    await rejected('return', f(4), f('unclaimed'), '2', '3', 'worker-a', '9', 'checked');
    await call('claim', f(4), f(5), '2', '3', 'coordinator');
    await rejected('claim', f(5), f('duplicate'), '2', '4', 'coordinator');
    const packet = await call('packet', f(5), '2');
    assert.match(packet, /Claim ID: 5\nWorker ID: 3/);
    assert.match(packet, /Independent maximum is 9/);
    await rejected('return', f(5), f('wrong-worker'), '2', '4', 'worker-b', '9', 'checked');
    assert.equal((await call('max', '3', '9', '2')).trim(), '9');
    await call('return', f(5), f(6), '2', '3', 'worker-a', '9', 'Independent Math.max and Bend max agree');
    await rejected('return', f(6), f('duplicate-result'), '2', '3', 'worker-a', '9', 'checked');
    assert.equal((await call('memory', f(6))).trim(), '', 'reported result must not silently become memory');
    await rejected('learn', f(6), f('not-result'), '2', '0', 'coordinator', 'unsupported');
    await call('learn', f(6), f(7), '6', '0', 'coordinator', 'Maximum can occur in the middle');
    await call('remember', f(7), f(8), '1', '7', 'coordinator', 'Dependent planning assumption');
    assert.match(await call('memory', f(8)), /id=7 kind=8 status=active/);
    assert.match(await call('packet', f(8), '2'), /Maximum can occur in the middle/);
    await call('correct', f(8), f(9), '7', '0', 'reviewer', 'Narrow the finding to the actual tested input', 'For [3,9,2], maximum is 9');
    const history = await call('history', f(9));
    assert.match(history, /id=7 kind=8 status=superseded/);
    assert.match(history, /id=8 kind=2 status=needs-review/);
    assert.match(history, /id=6 kind=7 status=reported/);
    const active = await call('memory', f(9));
    assert.match(active, /For \[3,9,2\], maximum is 9/);
    assert.doesNotMatch(active, /Dependent planning assumption|Maximum can occur in the middle/);
    const initial = await fs.readFile(f(0));
    await rejected('init', f(0));
    assert.deepEqual(await fs.readFile(f(0)), initial);
    for (const name of ['bad-worker', 'unclaimed', 'duplicate', 'wrong-worker', 'duplicate-result', 'not-result']) {
      await assert.rejects(fs.stat(f(name)), { code: 'ENOENT' });
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('native OpenCode transport sends claimed packet once and distinguishes acknowledgement from failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-delivery-'));
  const f = n => path.join(dir, String(n));
  const call = (...args) => run(['--', ...args]);
  const requests = [];
  let status = 204;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, method: req.method, body: JSON.parse(body) });
    res.writeHead(status, { Connection: 'close' });
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = String(server.address().port);
  try {
    await call('init', f(0));
    await call('capture', f(0), f(1), 'retain', 'operator', 'test:transport', 'Return "quoted" text and \\ safely');
    await call('work', f(1), f(2), '1', 'coordinator', 'operator', 'Exact quoted task preserved');
    await call('worker', f(2), f(3), 'coordinator', 'worker-http', 'opencode');
    await call('claim', f(3), f(4), '2', '3', 'coordinator');
    const packet = await call('packet', f(4), '2');
    const output = await call('opencode', f(4), '2', port, 'ses_test', f('receipt'));
    assert.match(output, /submission_acknowledged/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/session/ses_test/prompt_async');
    assert.equal(requests[0].body.agent, 'general');
    assert.equal(requests[0].body.parts[0].text, packet.trimEnd());
    assert.match(await fs.readFile(f('receipt'), 'utf8'), /HTTP\/1\.1 204/);
    await assert.rejects(call('opencode', f(4), '2', port, 'ses_test', f('receipt')), e => /receipt_exists/.test(e.stdout + e.stderr));
    assert.equal(requests.length, 1, 'existing receipt must prevent another submission');
    status = 500;
    await assert.rejects(call('opencode', f(4), '2', port, 'ses_test', f('rejected')), e => /expected_complete_204_ack/.test(e.stdout + e.stderr));
    assert.equal(requests.length, 2);
    await assert.rejects(fs.stat(f('rejected')), { code: 'ENOENT' });
    assert.equal((await call('memory', f(4))).trim(), '', 'delivery must not promote any result');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
