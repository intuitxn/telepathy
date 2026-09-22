import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {evaluate,validate} from './evaluate.mjs';
const exec=promisify(execFile);
const bend=process.env.BEND || path.join(os.homedir(),'.bend/bin/bend');
async function run(binary,args,cwd) {
  const {stdout,stderr}=await exec(binary,args,{cwd,timeout:60000,maxBuffer:1024*1024,env:{...process.env,BEND_NO_TELEMETRY:'1'}});
  assert.equal(stderr,''); return stdout;
}
test('separate Lorenz source checks and exercises persistence, corrections, queue and rejection controls',async()=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'lorenz-core-'));
  try {
    await fs.copyFile(new URL('./system.bend',import.meta.url),path.join(cwd,'system.bend'));
    assert.match(await run(bend,['system.bend','--check-only'],cwd),/All terms check\./);
    validate(await evaluate({bend,cwd,run}));
    assert.deepEqual(await fs.readdir(cwd),['system.bend']);
  } finally {await fs.rm(cwd,{recursive:true,force:true});}
});
test('receipt validation rejects an invented passing claim',()=>{
  assert.throws(()=>validate({passed:19}));
});
