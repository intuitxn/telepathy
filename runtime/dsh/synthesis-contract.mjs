// A synthesis oracle is trusted host code, loaded from immutable bytes outside
// the model workspace. The controller separately binds its verdict to the
// frozen source manifest, task grant, artifact, and causal evaluation cut.
import { createHash } from 'node:crypto';
import { promises as fs, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIGEST = /^[a-f0-9]{64}$/;
const MAX_ORACLE_BYTES = 1024 * 1024;
const adapters = new WeakMap();
const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error(`synthesis oracle: ${message}`); }

function canonicalDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail(`${label} must be absolute`);
  const resolved = path.resolve(value);
  if (resolved !== value || realpathSync(resolved) !== resolved) fail(`${label} must be canonical`);
  if (!lstatSync(resolved).isDirectory()) fail(`${label} must be a directory`);
  return resolved;
}

/**
 * Return a branded verifier for createTaskControl({ verifySynthesis }). The
 * oracle must be one self-contained ESM file exporting verifySynthesis(input).
 * A data import executes exactly the bytes that were hashed; changing the
 * path between a check and an import cannot substitute different code.
 */
export function createPinnedSynthesisVerifier(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) fail('settings are required');
  const trustedRoot = canonicalDirectory(settings.trustedRoot, 'trustedRoot');
  const workspaceRoot = canonicalDirectory(settings.workspaceRoot, 'workspaceRoot');
  const oraclePath = settings.oraclePath;
  if (typeof oraclePath !== 'string' || !path.isAbsolute(oraclePath) ||
      path.resolve(oraclePath) !== oraclePath ||
      realpathSync(oraclePath) !== oraclePath ||
      !lstatSync(oraclePath).isFile() || !within(trustedRoot, oraclePath))
    fail('oraclePath must be a regular canonical file inside trustedRoot');
  if (within(workspaceRoot, trustedRoot) || within(trustedRoot, workspaceRoot))
    fail('trustedRoot overlaps the model workspace');
  const temporaryRoots = ['/tmp', '/var/tmp', os.tmpdir(),
    ...(process.platform === 'darwin' ? ['/var/folders'] : [])].map(root => realpathSync(root));
  if (settings.allowUnsafeOraclePathForTest === true) {
    if (!temporaryRoots.some(root => within(root, trustedRoot)))
      fail('test-only oracle root must be temporary');
  } else if (temporaryRoots.some(root => within(root, trustedRoot))) {
    fail('production oracle root must be outside temporary directories');
  }
  const artifactRoot = canonicalDirectory(settings.artifactRoot, 'artifactRoot');
  if (within(workspaceRoot, artifactRoot) || within(artifactRoot, workspaceRoot))
    fail('artifactRoot overlaps the model workspace');
  if (!settings.allowUnsafeOraclePathForTest &&
      temporaryRoots.some(root => within(root, artifactRoot)))
    fail('production artifactRoot must be outside temporary directories');
  if (settings.allowUnsafeOraclePathForTest !== true) {
    const owner = typeof process.getuid === 'function' ? process.getuid() : null;
    for (const [label, file] of [['trustedRoot', trustedRoot], ['oraclePath', oraclePath],
      ['artifactRoot', artifactRoot]]) {
      const stat = lstatSync(file);
      if ((owner !== null && stat.uid !== owner) || (stat.mode & 0o022))
        fail(`${label} must be owned by the host user and not group or world writable`);
    }
  }
  const modules = new Map();
  const adapter = async input => {
    const expected = input?.synthesis_oracle_sha256;
    if (typeof expected !== 'string' || !DIGEST.test(expected)) fail('missing pinned synthesis oracle digest');
    if (realpathSync(oraclePath) !== oraclePath ||
        !lstatSync(oraclePath).isFile() ||
        lstatSync(oraclePath).size > MAX_ORACLE_BYTES)
      fail('oracle file changed type or exceeds 1 MiB');
    const bytes = await fs.readFile(oraclePath);
    if (bytes.length > MAX_ORACLE_BYTES) fail('oracle file exceeds 1 MiB');
    if (hash(bytes) !== expected) fail('oracle bytes differ from frozen task pin');
    let module = modules.get(expected);
    if (!module) {
      module = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
      if (typeof module.verifySynthesis !== 'function') fail('oracle must export verifySynthesis');
      modules.set(expected, module);
    }
    return module.verifySynthesis({ ...input, artifactRoot });
  };
  adapters.set(adapter, settings.allowUnsafeOraclePathForTest === true);
  return adapter;
}

export function isPinnedSynthesisVerifier(value, allowTestOracle = false) {
  return adapters.has(value) && (allowTestOracle || adapters.get(value) === false);
}
