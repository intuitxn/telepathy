// Independent host evaluator: executable memory transitions stay in system.bend.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export const metadata = Object.freeze({core:'lorenz-memory', contract:'lorenz-memory-v1', evaluator:'lorenz-memory-cli-v1'});
const checks = ['empty-state','explicit-retention','memory-promotion','transitive-invalidation','history-preserved','active-only-retrieval','dependency-repair','work-queue','work-deduplication','no-implicit-retention','missing-conversation','missing-dependency','self-dependency','descendant-dependency','already-superseded','multiline-rejected','output-not-overwritten','malformed-state','noncanonical-id'];
export const expected = {schema:'intuitxn-lorenz-evaluation/v1', ...metadata, checks, passed:checks.length, scope:'Public fixed CLI transition examples; only named Bend laws are proofs; supplied actor labels are not authentication.'};
export function validate(evidence) { assert.deepEqual(evidence,expected,'Lorenz evaluator evidence mismatch'); }
export async function evaluate({bend,cwd,run}) {
  const dir=await fs.mkdtemp(path.join(cwd,'.lorenz-eval-'));
  const file=n=>path.join(dir,String(n));
  const call=(...args)=>run(bend,['system.bend','--',...args],cwd);
  const reject=async(label,args,out)=>{
    let failure;
    try { await call(...args); } catch(error) { failure=error; }
    assert(failure,`${label}: invalid operation succeeded`);
    assert.match(String(failure),/lorenz_(invalid|output_exists)/,`${label}: unrelated failure`);
    if(out) await assert.rejects(fs.stat(out),{code:'ENOENT'});
  };
  try {
    await call('init',file(0));
    assert.equal((await call('history',file(0))).trim(),'');
    await call('capture',file(0),file(1),'retain','operator','episode:test','Investigate the retained premise');
    assert.match(await call('history',file(1)),/id=1 kind=1 status=conversation/);
    assert.equal((await call('memory',file(1))).trim(),'');
    await call('remember',file(1),file(2),'1','0','agent','premise A');
    await call('remember',file(2),file(3),'1','2','agent','depends on A');
    await call('remember',file(3),file(4),'1','3','agent','transitive conclusion');
    assert.equal((await call('memory',file(4))).match(/status=active/g).length,3);
    await call('correct',file(4),file(5),'2','0','reviewer','counterexample observed','premise B');
    const history=await call('history',file(5));
    assert.match(history,/id=2 kind=2 status=superseded/);
    assert.match(history,/id=3 kind=2 status=needs-review/);
    assert.match(history,/id=4 kind=2 status=needs-review/);
    assert.match(history,/text: premise A/);
    const active=await call('memory',file(5));
    assert.equal(active.match(/status=active/g).length,1);
    assert.match(active,/id=5 kind=3 status=active/);
    assert.doesNotMatch(active,/premise A|transitive conclusion|depends on A/);
    await call('correct',file(5),file(6),'3','5','reviewer','rechecked against B','repaired direct');
    await call('correct',file(6),file(7),'4','6','reviewer','rechecked chain','repaired transitive');
    assert.match(await call('memory',file(7)),/id=7 kind=3 status=active/);
    await call('work',file(7),file(8),'1','agent','operator','independent tests pass');
    assert.match(await call('history',file(8)),/id=8 kind=4 status=queued/);
    await call('work',file(8),file(9),'1','agent','operator','independent tests pass');
    assert.equal(await fs.readFile(file(8),'utf8'),await fs.readFile(file(9),'utf8'));
    await reject('no retention',['capture',file(0),file('bad-retain'),'skip','agent','origin','text'],file('bad-retain'));
    await reject('missing conversation',['remember',file(1),file('bad-c'),'99','0','agent','text'],file('bad-c'));
    await reject('missing dependency',['remember',file(1),file('bad-d'),'1','99','agent','text'],file('bad-d'));
    await reject('self dependency',['correct',file(4),file('bad-self'),'2','2','agent','reason','text'],file('bad-self'));
    await reject('descendant dependency',['correct',file(4),file('bad-child'),'2','4','agent','reason','text'],file('bad-child'));
    await reject('superseded',['correct',file(5),file('bad-old'),'2','0','agent','reason','text'],file('bad-old'));
    await reject('multiline',['capture',file(0),file('bad-line'),'retain','agent','origin','line\nline'],file('bad-line'));
    const original=await fs.readFile(file(0));
    await reject('overwrite',['init',file(0)]);
    assert.deepEqual(await fs.readFile(file(0)),original);
    await fs.writeFile(file('malformed'),'not a Lorenz snapshot');
    await reject('malformed',['memory',file('malformed')]);
    await reject('noncanonical id',['remember',file(1),file('bad-id'),'01','0','agent','text'],file('bad-id'));
    return structuredClone(expected);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}
