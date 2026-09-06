import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { store, newJob, get } from '../src/core.js';
import { runJob } from '../src/jobs.js';
import { checked } from '../src/process.js';
test('job uses a separate worktree, stores evidence, and never touches original checkout', async t => {
  const dir=mkdtempSync(join(tmpdir(),'intuitxn-job-')); const previous=process.env.INTUITXN_HOME; process.env.INTUITXN_HOME=join(dir,'state');
  const db=store(); t.after(()=>{ db.close(); if(previous) process.env.INTUITXN_HOME=previous;else delete process.env.INTUITXN_HOME;rmSync(dir,{recursive:true,force:true}); });
  await checked('git',['init',dir]); writeFileSync(join(dir,'app.txt'),'original\n'); await checked('git',['add','app.txt'],{cwd:dir});
  await checked('git',['-c','user.name=Intuitxn Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','test fixture'],{cwd:dir});
  const j=newJob(db,{runtime:'codex',repository:dir,owner:'test',request:'Change app',acceptance:'Checks pass'});
  const result=await runJob(db,j.id,{repositories:[dir],timeoutSeconds:5},{executor:async(job,prompt)=>{assert.match(prompt,/Checks pass/);writeFileSync(join(job.worktree,'app.txt'),'candidate\n');return 'Verified candidate';}});
  assert.equal(result.state,'needs_review'); assert.equal(readFileSync(join(dir,'app.txt'),'utf8'),'original\n'); assert.match(readFileSync(join(result.folder,'changes.patch'),'utf8'),/candidate/);
  await assert.rejects(runJob(db,j.id,{repositories:[dir]}),/already claimed/);
});

test('accept records a human reviewer and only resolves reviewed jobs', async t => {
  const dir=mkdtempSync(join(tmpdir(),'intuitxn-accept-')); const previous=process.env.INTUITXN_HOME; process.env.INTUITXN_HOME=join(dir,'state');
  const db=store(); t.after(()=>{ db.close(); if(previous) process.env.INTUITXN_HOME=previous;else delete process.env.INTUITXN_HOME;rmSync(dir,{recursive:true,force:true}); });
  await checked('git',['init',dir]); writeFileSync(join(dir,'app.txt'),'original\n'); await checked('git',['add','app.txt'],{cwd:dir});
  await checked('git',['-c','user.name=Intuitxn Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','test fixture'],{cwd:dir});
  const {acceptJob}=await import('../src/jobs.js');
  const j=newJob(db,{runtime:'codex',repository:dir,owner:'test',request:'Change app',acceptance:'Checks pass'});
  assert.throws(() => acceptJob(db,j.id,'Reviewer'),/needs_review/);
  const reviewed=await runJob(db,j.id,{repositories:[dir],timeoutSeconds:5},{executor:async()=>'Verified candidate'});
  assert.equal(reviewed.state,'needs_review');
  const accepted=acceptJob(db,j.id,'Shubham');
  assert.equal(accepted.state,'resolved'); assert.equal(accepted.reviewer,'Shubham'); assert.ok(accepted.acceptedAt);
  assert.throws(() => acceptJob(db,j.id,'Again'),/needs_review/);
});

test('OpenCode result includes final text and excludes reasoning and tool history', async () => {
  const {resultText}=await import('../src/jobs.js');
  const result=resultText([{type:'user',content:'secret request'}, {type:'assistant',content:[{type:'reasoning',text:'private reasoning'},{type:'tool',name:'shell',state:{content:'private output'}},{type:'text',text:'Candidate ready.'}]}]);
  assert.equal(result,'Candidate ready.');
});
