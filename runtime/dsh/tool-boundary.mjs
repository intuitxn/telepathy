// Host-owned boundary for model-facing DSH tools. A session may edit its
// verified jj workspace, but never inspect host state or invoke an unreviewed
// tool. This guard is independent of DSH's workspace-write shell policy, which
// permits reads and network access outside the workspace.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const DIGEST = /^[a-f0-9]{64}$/;
const FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit']);
const ALLOWED_TOOLS = new Set([
  ...FILE_TOOLS,
  'algorithm_active', 'algorithm_run',
  'algorithm_execute', 'task_plan',
]);
const CONTROL_SEGMENTS = new Set([
  '.jj', '.git', '.agents', '.opencode', '.codex', '.github',
  '.ssh', '.aws', '.kube', '.npmrc', '.netrc', '.dsh',
]);
const CONTROL_TOP_LEVEL = new Set(['scripts', 'plugins', 'node_modules']);
const CONTROL_TOP_LEVEL_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'makefile', 'agents.md', 'claude.md',
]);

function fail(message) { throw new Error(`tool boundary: ${message}`); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// A path that does not exist yet still needs its nearest existing ancestor
// resolved. A dangling symlink is not a missing path: fail instead of treating
// its spelling as a new file beneath the workspace.
function canonicalTarget(input) {
  const suffix = [];
  let current = path.resolve(input);
  for (;;) {
    try { return path.resolve(realpathSync(current), ...suffix); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        if (lstatSync(current).isSymbolicLink()) fail('dangling symlink is forbidden');
      } catch (statError) {
        if (statError?.code !== 'ENOENT' && statError?.code !== 'ENOTDIR') throw statError;
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function canonicalDirectory(input, label) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) fail(`${label} must be an absolute path`);
  const root = realpathSync(input);
  if (!statSync(root).isDirectory()) fail(`${label} must be a directory`);
  return root;
}

function isControlPath(relative) {
  const parts = relative.toLowerCase().split(path.sep);
  if (parts.some(part => CONTROL_SEGMENTS.has(part) || part === '.env' || part.startsWith('.env.'))) return true;
  if (CONTROL_TOP_LEVEL.has(parts[0]) || CONTROL_TOP_LEVEL_FILES.has(parts[0])) return true;
  if (parts[0] === 'runtime' && parts[1] === 'dsh') return true;
  if (parts[0] === 'docs' && parts[1] === 'auto_merge.md') return true;
  return false;
}

/**
 * Build the synchronous DSH tool guard and a host-only child binding hook.
 * The trusted startChild setup callback must call bindChildWorkspace(agent,
 * grant) before publishing its child. The binding is keyed by Agent object, so
 * a failed setup or later reuse of a session ID cannot inherit old authority.
 */
export function createToolBoundary(settings = {}) {
  const workspace = canonicalDirectory(settings.workspaceRoot, 'TELEPATHY_DSH_WORKSPACE');
  const privateRoots = (settings.privateRoots ?? []).filter(Boolean)
    .map((root, index) => canonicalDirectory(root, `private root ${index}`));
  if (privateRoots.some(root => inside(workspace, root) || inside(root, workspace)))
    fail('private DSH state or release overlaps the model workspace');
  const children = new WeakMap();

  function bindChildWorkspace(agent, grant) {
    if (!agent || typeof agent !== 'object' || !agent.session ||
        agent.session.header?.origin !== 'subagent' ||
        typeof agent.session.header.parentSession !== 'string' ||
        !DIGEST.test(grant?.ref ?? '') || !DIGEST.test(grant?.parent_grant_ref ?? '') ||
        grant?.status !== 'active') fail('child binding requires an active granted DSH child');
    const childWorkspace = canonicalDirectory(grant.location, 'child grant location');
    if (privateRoots.some(root => inside(childWorkspace, root) || inside(root, childWorkspace)))
      fail('private DSH state or release overlaps the child workspace');
    if (agent.session.header.cwd !== childWorkspace ||
        agent.session.header.delegationDepth !== grant.depth) {
      fail('child session metadata differs from its granted workspace');
    }
    if (children.has(agent)) fail('child workspace is already bound');
    children.set(agent, childWorkspace);
  }

  function guard(exec) {
    if (!ALLOWED_TOOLS.has(exec?.name)) return 'tool is outside the Telepathy model capability set';
    const agent = exec.agent;
    const header = agent?.session?.header;
    if (!header || typeof agent?.session?.id !== 'string') return 'tool call requires a bound DSH session';
    let root;
    if (header.origin === 'subagent') {
      root = children.get(agent);
      if (!root || typeof header.parentSession !== 'string' || header.cwd !== root)
        return 'child session has no verified workspace grant';
    } else {
      if (header.parentSession !== undefined || header.cwd !== workspace)
        return 'root session is outside the configured workspace';
      root = workspace;
    }
    if (!FILE_TOOLS.has(exec.name)) return undefined;
    const args = exec.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        typeof args.file_path !== 'string' || !args.file_path || args.file_path.includes('\0'))
      return 'file tool requires a valid file_path';
    if (args.sandbox_permissions !== undefined || args.justification !== undefined)
      return 'file access escalation is disabled';
    let target;
    try { target = canonicalTarget(path.resolve(root, args.file_path)); }
    catch { return 'file path could not be safely resolved'; }
    if (!inside(root, target)) return 'file path is outside the verified workspace';
    const relative = path.relative(root, target);
    if (!relative || isControlPath(relative)) return 'file path is a protected control path';
    try {
      // A hard link to a private inode retains an in-workspace spelling.
      if (statSync(target).nlink > 1) return 'hard-linked files are unavailable to model tools';
    } catch (error) {
      if (error?.code !== 'ENOENT') return 'file path could not be safely inspected';
    }
    return undefined;
  }

  return Object.freeze({ workspace, bindChildWorkspace, guard });
}

export const name = 'telepathy-tool-boundary';
export const inject = ['tools'];
export function apply(ctx, config = {}) {
  const dshHome = canonicalDirectory(process.env.DSH_HOME, 'DSH_HOME');
  const trustedRoot = canonicalDirectory(process.env.TELEPATHY_DSH_TRUSTED_ROOT, 'TELEPATHY_DSH_TRUSTED_ROOT');
  const boundary = createToolBoundary({
    workspaceRoot: config.workspaceRoot ?? process.env.TELEPATHY_DSH_WORKSPACE,
    privateRoots: [dshHome, trustedRoot],
  });
  ctx.tools.guard(boundary.guard);
  ctx.provide('telepathyToolBoundary', Object.freeze({
    bindChildWorkspace: boundary.bindChildWorkspace,
  }));
}
