// Production DSH session adapter for synthesis-host. It reuses the research
// host's exact-release preflight and funded SDK turn, with algorithm tools
// disabled. The model turn is still a proposal; synthesis-host archives its
// raw output and task-control invokes the separately pinned synthesis oracle.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkTurn, verifyDsh } from './task-host.mjs';

const SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
function fail(message) { throw new Error(`synthesis session: ${message}`); }

/**
 * A checked runner for createSynthesisHost({ runner }). dsh has the same
 * pinned CLI, SDK, LLM, release, DSH_HOME, and private environment fields as
 * createResearchTaskProgramHost. auditDispatch is an optional trusted host
 * callback that must inspect DSH's durable session catalog and return the
 * exact completed response bound to the intent. Absence or an uncertain
 * external turn never triggers an automatic provider retry.
 */
export function createCheckedSynthesisRunner({ dsh, taskStateRoot,
  auditDispatch } = {}) {
  if (!dsh || typeof dsh !== 'object') fail('pinned DSH settings are required');
  if (typeof taskStateRoot !== 'string' || !path.isAbsolute(taskStateRoot) ||
      path.normalize(taskStateRoot) !== taskStateRoot)
    fail('taskStateRoot must be an absolute normalized path');
  if (auditDispatch !== undefined && typeof auditDispatch !== 'function')
    fail('auditDispatch must be a trusted host callback');
  let bound = null;

  async function preflight({ task_ref, spec, workspace, model_token_limit }) {
    if (!SHA.test(task_ref ?? '') || !spec ||
        !Number.isSafeInteger(model_token_limit) || model_token_limit < 1 ||
        model_token_limit > 4096) fail('preflight has an invalid funded task binding');
    const checked = await verifyDsh(dsh, workspace, spec);
    const store = await fs.realpath(taskStateRoot);
    const stat = await fs.lstat(store);
    if (store !== taskStateRoot || !stat.isDirectory() || stat.isSymbolicLink() ||
        stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
        within(workspace, store) || within(store, workspace))
      fail('task state root is redirected, public, or overlaps the model workspace');
    const manifest = JSON.parse(await fs.readFile(path.join(checked.trustedRoot, 'release.json'), 'utf8'));
    for (const relative of ['runtime/dsh/synthesis-host.mjs',
      'runtime/dsh/synthesis-session.mjs', 'runtime/dsh/synthesis-contract.mjs']) {
      const file = path.join(checked.trustedRoot, relative);
      if (!SHA.test(manifest.files?.[relative] ?? '') ||
          await fs.realpath(file) !== file ||
          hash(await fs.readFile(file)) !== manifest.files[relative])
        fail(`checked release lacks exact synthesis source: ${relative}`);
    }
    if (fileURLToPath(import.meta.url) !== path.join(checked.trustedRoot,
      'runtime/dsh/synthesis-session.mjs'))
      fail('production synthesis runner must execute from the checked release');
    if (bound && (bound.task_ref !== task_ref || bound.workspace !== workspace ||
        bound.model_token_limit !== model_token_limit))
      fail('runner was preflighted for another task or workspace');
    bound = { task_ref, workspace, model_token_limit,
      integration_owner: spec.integration_owner, checked };
    return { toolchain: spec.pinned_versions.toolchain,
      trusted_root: checked.trustedRoot };
  }

  function check(input) {
    if (!bound || input.task_ref !== bound.task_ref ||
        input.workspace !== bound.workspace ||
        input.grant?.location !== bound.workspace ||
        input.grant?.owner !== bound.integration_owner ||
        input.grant?.plan_ref !== input.plan?.ref ||
        !SHA.test(input.intent_sha256 ?? ''))
      fail('session call differs from checked task and synthesis grant');
  }

  async function run(input) {
    check(input);
    if (typeof input.dispatch_id !== 'string' || typeof input.prompt !== 'string' ||
        !input.prompt || input.model_token_limit !== bound.model_token_limit ||
        input.grant?.status !== 'active' ||
        input.plan?.kind !== 'synthesis')
      fail('session needs an active synthesis grant and bounded prompt');
    return sdkTurn(bound.checked, bound.workspace, taskStateRoot, bound.task_ref,
      input.grant.ref, input.dispatch_id, bound.model_token_limit, input.prompt);
  }

  const runner = { preflight, run };
  if (auditDispatch) runner.audit = async input => {
    check(input);
    return auditDispatch(input);
  };
  return Object.freeze(runner);
}
