import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function run(mode) {
  const root = mkdtempSync(join(tmpdir(), 'mundus-ops-'));
  const dir = join(root, 'runtime/ops');
  mkdirSync(dir, {recursive:true});
  copyFileSync(new URL('../runtime/ops/run.sh', import.meta.url), join(dir,'run.sh'));
  writeFileSync(join(dir,'fold.bend'), 'original source\n');
  const fake = join(root,'bend');
  writeFileSync(fake, `#!/bin/sh
if [ "$1" = version ]; then echo test-toolchain; exit 0; fi
if [ "\${2:-}" = --check-only ]; then
  if [ "$MODE" = gate ]; then echo 'TODO unchecked'; exit 1; fi
  echo 'changed source' > "$ORIGINAL"
  echo 'All terms check.'; exit 0
fi
printf '%s\\n' "$1" > "$CALLED"
if [ "$MODE" = wrong ]; then echo 'fixture 999'; exit 0; fi
printf 'fixture 14\\nfixture_max 5\\n'
`, {mode:0o700});
  const result=spawnSync('/bin/sh',[join(dir,'run.sh'),'run','fold','--id','test'],{
    encoding:'utf8', env:{...process.env,BEND_BINARY:fake,MODE:mode,ORIGINAL:join(dir,'fold.bend'),CALLED:join(root,'called')}});
  return {root,result,dir:join(root,'ops/runs/fold-test')};
}
for (const mode of ['green','gate','wrong']) test(`ops ${mode}`,()=>{
 const {root,result,dir}=run(mode);
 try {
  assert.equal(result.status, mode==='green'?0:1, result.stderr+result.stdout);
  assert.equal(existsSync(join(root,'called')),mode!=='gate');
  assert.equal(readFileSync(join(dir,'source.bend'),'utf8'),'original source\n');
  if(mode==='green') assert.match(result.stdout,/GREEN fixture-run :: expected fold output matched/);
  if(mode==='gate') assert.match(result.stdout,/RED law-gate :: open law/);
  if(mode==='wrong') assert.match(result.stdout,/RED fixture-run :: fold output differs/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
