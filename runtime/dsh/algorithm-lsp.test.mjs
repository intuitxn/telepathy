import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createAlgorithmLanguageServer } from './algorithm-lsp.mjs';

const wire = value => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value }));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};

test('editor messages use the compiler diagnostics and track current document versions', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let bytes = Buffer.alloc(0);
  output.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    for (;;) {
      const end = bytes.indexOf('\r\n\r\n');
      if (end < 0) break;
      const size = Number(/^Content-Length: ([0-9]+)$/m.exec(bytes.subarray(0, end).toString())[1]);
      if (bytes.length < end + 4 + size) break;
      messages.push(JSON.parse(bytes.subarray(end + 4, end + 4 + size).toString()));
      bytes = bytes.subarray(end + 4 + size);
    }
  });
  const server = createAlgorithmLanguageServer(input, output);
  const uri = 'file:///tmp/queue.algo';
  const bad = 'algorithm queue\nstate total = 0\nstep total = add(total, mystery)\nreturn total\n';
  const good = 'algorithm queue\nstate total = 0\nstep total = add(total, 1)\nreturn total\n';
  try {
    const initialize = wire({ id: 1, method: 'initialize', params: {} });
    input.write(initialize.subarray(0, 15));
    input.write(initialize.subarray(15));
    input.write(wire({ method: 'textDocument/didOpen', params: {
      textDocument: { uri, version: 1, text: bad } } }));
    assert.equal(messages[0].result.capabilities.textDocumentSync.change, 1);
    assert.equal(messages[1].params.version, 1);
    assert.equal(messages[1].params.diagnostics[0].code, 'unknown-name');
    input.write(wire({ method: 'textDocument/didChange', params: {
      textDocument: { uri, version: 2 }, contentChanges: [{ text: good }] } }));
    assert.deepEqual(messages[2].params.diagnostics, []);
    input.write(wire({ method: 'textDocument/didOpen', params: {
      textDocument: { uri, version: 1, text: bad } } }));
    assert.equal(messages.length, 3, 'stale didOpen cannot replace a newer version');
    input.write(wire({ method: 'textDocument/didChange', params: {
      textDocument: { uri, version: 1 }, contentChanges: [{ text: bad }] } }));
    assert.equal(messages.length, 3, 'stale editor content cannot replace a newer version');
    input.write(wire({ id: 2, method: 'textDocument/definition', params: {
      textDocument: { uri }, position: { line: 2, character: 19 } } }));
    assert.equal(messages[3].result.range.start.line, 1);
    input.write(wire({ id: 3, method: 'textDocument/completion', params: {
      textDocument: { uri }, position: { line: 2, character: 0 } } }));
    assert(messages[4].result.some(item => item.label === 'if_lt'));
    input.write(wire({ method: 'textDocument/didClose', params: { textDocument: { uri } } }));
    assert.deepEqual(messages[5].params.diagnostics, []);
    input.write(wire({ id: 4, method: 'shutdown' }));
    assert.equal(messages[6].result, null);
    input.write(wire({ method: 'exit' }));
  } finally {
    server.stop();
    input.destroy();
    output.destroy();
  }
});

test('stdio server exits after shutdown and exit notifications', async () => {
  const child = spawn(process.execPath, ['runtime/dsh/algorithm-lsp.mjs'], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.write(wire({ id: 1, method: 'initialize', params: {} }));
  child.stdin.write(wire({ id: 2, method: 'shutdown' }));
  child.stdin.write(wire({ method: 'exit' }));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('language server did not exit')); }, 3000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Content-Length:/);
});

test('oversized or malformed framing cannot grow the server buffer indefinitely', () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createAlgorithmLanguageServer(input, output);
  try {
    input.write(Buffer.from('Content-Length: 999999999\r\n\r\n'));
    input.write(wire({ id: 1, method: 'initialize' }));
    assert.equal(output.read(), null, 'a rejected stream cannot resume processing');
  } finally {
    server.stop();
    input.destroy();
    output.destroy();
  }
});
