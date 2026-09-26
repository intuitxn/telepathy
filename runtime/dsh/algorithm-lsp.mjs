#!/usr/bin/env node
// Small stdio language server for the bounded one-file algorithm language.
// It reads editor buffers only; compilation, execution, and scoring remain
// explicit host actions with their own receipts.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileAlgorithmText } from './algorithm-language.mjs';

const MAX_FRAME = 128 * 1024;
const MAX_HEADER = 8 * 1024;
const MAX_DOCUMENTS = 32;
const COMPLETIONS = [
  ['algorithm', 'algorithm name', 'Name this one-file program.'],
  ['state', 'state name = 0', 'Declare a natural-number state.'],
  ['step', 'step name = add(name, 1)', 'Define the next value from the previous state.'],
  ['return', 'return name', 'Select the output state.'],
  ['tick', 'tick', 'Current zero-based transition index.'],
  ['add', 'add(a, b)', 'Add two natural numbers.'],
  ['sub', 'sub(a, b)', 'Saturating subtraction.'],
  ['if_lt', 'if_lt(a, b, yes, no)', 'Choose by natural-number comparison.'],
];

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function validUri(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try { return new URL(value).protocol === 'file:'; }
  catch { return false; }
}

function wordAt(source, position) {
  if (!Number.isSafeInteger(position?.line) || !Number.isSafeInteger(position?.character)) return '';
  const line = source.split('\n')[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) return '';
  const start = line.slice(0, position.character).match(/[a-z][a-z0-9_]*$/)?.[0] ?? '';
  const end = line.slice(position.character).match(/^[a-z0-9_]*/)?.[0] ?? '';
  return `${start}${end}`;
}

/** Start a bounded JSON-RPC 2.0 language server on two streams. */
export function createAlgorithmLanguageServer(input, output) {
  const documents = new Map();
  let buffer = Buffer.alloc(0);
  let expected = null;
  let stopped = false;
  let shutdown = false;
  const send = value => output.write(frame(value));
  const answer = (id, result) => send({ jsonrpc: '2.0', id, result });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const diagnostics = (uri, version, source) => {
    const result = compileAlgorithmText(source);
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri, version, diagnostics: result.diagnostics } });
  };
  const handle = message => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (message?.id !== undefined) error(message.id, -32600, 'Invalid request');
      return;
    }
    const { id, method, params } = message;
    if (method === 'initialize') {
      answer(id, { capabilities: { textDocumentSync: { openClose: true, change: 1 },
        completionProvider: { triggerCharacters: [' ', '('] }, hoverProvider: true,
        definitionProvider: true }, serverInfo: { name: 'telepathy-algorithm', version: '1' } });
      return;
    }
    if (method === 'shutdown') { shutdown = true; answer(id, null); return; }
    if (method === 'exit') { stop(); return; }
    if (shutdown) { if (id !== undefined) error(id, -32600, 'Server is shut down'); return; }
    if (method === 'textDocument/didOpen') {
      const doc = params?.textDocument;
      if (!validUri(doc?.uri) || typeof doc.text !== 'string' ||
          !Number.isSafeInteger(doc.version) ||
          (documents.has(doc.uri) && doc.version <= documents.get(doc.uri).version) ||
          (documents.size >= MAX_DOCUMENTS && !documents.has(doc.uri))) return;
      documents.set(doc.uri, { version: doc.version, source: doc.text });
      diagnostics(doc.uri, doc.version, doc.text);
      return;
    }
    if (method === 'textDocument/didChange') {
      const doc = params?.textDocument;
      const prior = documents.get(doc?.uri);
      const change = params?.contentChanges;
      if (!prior || !Number.isSafeInteger(doc.version) || doc.version <= prior.version ||
          !Array.isArray(change) || change.length !== 1 ||
          typeof change[0]?.text !== 'string' || change[0].range !== undefined) return;
      documents.set(doc.uri, { version: doc.version, source: change[0].text });
      diagnostics(doc.uri, doc.version, change[0].text);
      return;
    }
    if (method === 'textDocument/didClose') {
      const uri = params?.textDocument?.uri;
      if (documents.delete(uri)) send({ jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
      return;
    }
    if (method === 'textDocument/completion') {
      answer(id, COMPLETIONS.map(([label, insertText, detail]) => ({
        label, kind: 14, insertText, detail })));
      return;
    }
    if (method === 'textDocument/hover' || method === 'textDocument/definition') {
      const doc = documents.get(params?.textDocument?.uri);
      const word = doc && wordAt(doc.source, params?.position);
      if (method === 'textDocument/hover') {
        const item = COMPLETIONS.find(([label]) => label === word);
        answer(id, item ? { contents: { kind: 'plaintext', value: item[2] } } : null);
      } else {
        const lines = doc?.source.split('\n') ?? [];
        const index = lines.findIndex(line => new RegExp(`^state ${word} = `).test(line));
        answer(id, word && index >= 0 ? { uri: params.textDocument.uri,
          range: { start: { line: index, character: 6 },
            end: { line: index, character: 6 + word.length } } } : null);
      }
      return;
    }
    if (id !== undefined) error(id, -32601, 'Method not found');
  };
  const onData = chunk => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, chunk]);
    while (!stopped) {
      if (expected === null) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (buffer.length > MAX_HEADER) stop(); return; }
        if (end > MAX_HEADER) { stop(); return; }
        const headers = buffer.subarray(0, end).toString('ascii').split('\r\n');
        const lengths = headers.filter(line => /^content-length:/i.test(line));
        const match = lengths.length === 1 && /^Content-Length: ([0-9]+)$/i.exec(lengths[0]);
        if (!match || !Number.isSafeInteger(Number(match[1])) ||
            Number(match[1]) < 1 || Number(match[1]) > MAX_FRAME) { stop(); return; }
        expected = Number(match[1]);
        buffer = buffer.subarray(end + 4);
      }
      if (buffer.length < expected) return;
      const body = buffer.subarray(0, expected);
      buffer = buffer.subarray(expected);
      expected = null;
      let message;
      try { message = JSON.parse(body.toString('utf8')); }
      catch { error(null, -32700, 'Parse error'); continue; }
      try { handle(message); }
      catch { if (message?.id !== undefined) error(message.id, -32603, 'Internal error'); }
      if (!buffer.length) return;
    }
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    documents.clear();
    input.off('data', onData);
    if (input === process.stdin) {
      process.stdin.destroy();
      process.stdout.end();
      process.exitCode = shutdown ? 0 : 1;
    }
  }
  input.on('data', onData);
  return Object.freeze({ stop });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  createAlgorithmLanguageServer(process.stdin, process.stdout);
