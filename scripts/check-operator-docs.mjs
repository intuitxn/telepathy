#!/usr/bin/env node
// Check the maintained operator guides without invoking a provider or legacy host.
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guides = [
  'BUZZ_SETUP.md',
  'docs/AGENT_MAP.md',
  'docs/FOUNDATIONS_AND_LIVE_USE.md',
  'docs/HARNESS_STATE.md',
  'docs/INDEX.md',
  'docs/RELAY_SETUP.md',
  'runtime/adaptive/META.md',
  'runtime/adaptive/README.md',
  'runtime/worker/BUZZ.md',
  'runtime/worker/README.md',
  ...['bend-forge', 'build', 'prime', 'relationships', 'relay-keeper',
    'research', 'steward', 'telepathy'].map((name) => `.opencode/agents/${name}.md`),
];
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
const makefile = readFileSync(resolve(root, 'Makefile'), 'utf8');
const targets = new Set([...makefile.matchAll(/^([a-z][a-z-]*):/gm)].map((match) => match[1]));
const errors = [];
let links = 0;
let anchors = 0;
let commands = 0;
const headingSlug = (heading) => heading.toLowerCase()
  .replace(/[`*_~]/g, '')
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .trim().replace(/\s+/g, '-');

for (const guide of guides) {
  const file = resolve(root, guide);
  const source = readFileSync(file, 'utf8');
  const line = (offset) => source.slice(0, offset).split('\n').length;
  for (const match of source.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const [rawLocal, rawAnchor] = target.split('#', 2);
    const local = decodeURIComponent(rawLocal);
    if (!local || local.startsWith('/')) continue;
    links += 1;
    const destination = resolve(dirname(file), local);
    try { statSync(destination); }
    catch {
      errors.push(`${guide}:${line(match.index)}: missing link ${target}`);
      continue;
    }
    if (rawAnchor && destination.endsWith('.md')) {
      anchors += 1;
      const headings = new Set([...readFileSync(destination, 'utf8')
        .matchAll(/^#{1,6}\s+(.+)$/gm)].map((entry) => headingSlug(entry[1])));
      if (!headings.has(decodeURIComponent(rawAnchor)))
        errors.push(`${guide}:${line(match.index)}: missing anchor ${target}`);
    }
  }
  for (const match of source.matchAll(/\bnpm run ([a-z][a-z0-9:-]*)\b/g)) {
    commands += 1;
    if (!(match[1] in scripts))
      errors.push(`${guide}:${line(match.index)}: missing root npm script ${match[1]}`);
  }
  for (const match of source.matchAll(/\bmake ([a-z][a-z-]*)\b/g)) {
    commands += 1;
    if (!targets.has(match[1]))
      errors.push(`${guide}:${line(match.index)}: missing make target ${match[1]}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`operator docs: PASS (${guides.length} guides, ${links} local links, ${anchors} anchors, ${commands} commands)`);
}
