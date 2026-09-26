#!/usr/bin/env node
// Validate the planned interface catalog and the accepted activity projection.
// These are published documents, not execution or acceptance state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--root' || !args[1])) {
  console.error('usage: node scripts/validate-projections.mjs [--root DIR]');
  process.exit(2);
}
const root = args.length === 2 ? path.resolve(args[1]) :
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const faults = [];
const expectedIds = new Set(['prime', 'build', 'steward', 'research', 'relationships']);

function readText(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (error) {
    faults.push(`${rel}: ${error.message}`);
    return null;
  }
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCatalog() {
  const rel = 'plugins/telepathy-meta-agents/registry.json';
  const source = readText(rel);
  if (source === null) return;
  let catalog;
  try {
    catalog = JSON.parse(source);
  } catch (error) {
    faults.push(`${rel}: invalid JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(catalog?.interfaces)) {
    faults.push(`${rel}: interfaces must be an array`);
    return;
  }
  const seen = new Set();
  for (const [index, item] of catalog.interfaces.entries()) {
    const label = `${rel}: interfaces[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      faults.push(`${label} must be an object`);
      continue;
    }
    if (!expectedIds.has(item.id)) faults.push(`${label}: unknown id ${JSON.stringify(item.id)}`);
    if (seen.has(item.id)) faults.push(`${label}: duplicate id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
    for (const field of ['name', 'label', 'purpose', 'host', 'path', 'agentFile']) {
      if (!nonempty(item[field])) faults.push(`${label}: ${field} must be nonempty`);
    }
    if (item.status !== 'planned') faults.push(`${label}: status must be planned`);
    if (Object.hasOwn(item, 'runtime')) {
      faults.push(`${label}: runtime is an execution claim; omit it from the planned catalog`);
    }
    if (typeof item.id === 'string' && expectedIds.has(item.id)) {
      const agentFile = `.opencode/agents/${item.id}.md`;
      if (item.agentFile !== agentFile || !fs.existsSync(path.join(root, agentFile))) {
        faults.push(`${label}: agentFile must point to existing ${agentFile}`);
      }
      if (item.path !== `/agents/${item.id}`) {
        faults.push(`${label}: path must be /agents/${item.id}`);
      }
    }
    for (const field of ['jtbd', 'may', 'mustNot']) {
      if (!Array.isArray(item[field]) || item[field].length === 0 ||
          item[field].some((entry) => !nonempty(entry)) ||
          new Set(item[field]).size !== item[field].length) {
        faults.push(`${label}: ${field} must contain distinct nonempty strings`);
      }
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) faults.push(`${rel}: missing interface ${id}`);
  }
}

const activityFields = [
  'Human initiator', 'Owner', 'Reviewer', 'Artifact revision',
  'Verification evidence', 'Limitations', 'Next action',
];

function validateActivityFile(rel, eventIds) {
  const parts = rel.split('/');
  if (parts.length !== 5 || parts[0] !== 'activity' ||
      !/^[a-z0-9][a-z0-9-]*$/.test(parts[1]) ||
      !/^\d{4}$/.test(parts[2]) ||
      !/^(0[1-9]|1[0-2])$/.test(parts[3]) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(parts[4])) {
    faults.push(`${rel}: expected activity/<project>/<year>/<month>/<event-id>.md`);
    return;
  }
  const eventId = parts[4].slice(0, -3).toLowerCase();
  if (eventIds.has(eventId)) faults.push(`${rel}: duplicate source event ID ${eventId}`);
  eventIds.add(eventId);
  const source = readText(rel);
  if (source === null) return;
  for (const field of activityFields) {
    const matches = [...source.matchAll(new RegExp(`^[ \\t]*(?:[-*][ \\t]*)?${field}:[ \\t]*(.*)$`, 'gmi'))];
    if (matches.length !== 1 || !nonempty(matches[0]?.[1])) {
      faults.push(`${rel}: expected one nonempty "${field}:" line`);
    } else if (field === 'Artifact revision' && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(matches[0][1].trim())) {
      faults.push(`${rel}: Artifact revision must be a full 40- or 64-digit hex revision`);
    }
  }
}

function validateActivity() {
  const activityRoot = path.join(root, 'activity');
  if (!fs.existsSync(activityRoot)) {
    faults.push('activity/: missing');
    return;
  }
  const eventIds = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        faults.push(`${rel}: symlinks are not accepted activity`);
      } else if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (rel !== 'activity/README.md') validateActivityFile(rel, eventIds);
      } else {
        faults.push(`${rel}: unsupported entry`);
      }
    }
  }
  walk(activityRoot);
}

validateCatalog();
validateActivity();
if (faults.length > 0) {
  for (const fault of faults) console.error(`FAIL ${fault}`);
  console.error(`projections: FAIL (${faults.length} issue${faults.length === 1 ? '' : 's'})`);
  process.exitCode = 1;
} else {
  console.log('projections: PASS (planned interface catalog and accepted activity)');
}
