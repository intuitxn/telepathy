import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { store, newJob, get, put } from '../src/core.js';
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

test('land applies worktree changes to the main repo, commits, and resolves', async t => {
  const dir=mkdtempSync(join(tmpdir(),'intuitxn-land-')); const previous=process.env.INTUITXN_HOME; process.env.INTUITXN_HOME=join(dir,'state');
  const db=store(); t.after(()=>{ db.close(); if(previous) process.env.INTUITXN_HOME=previous;else delete process.env.INTUITXN_HOME;rmSync(dir,{recursive:true,force:true}); });
  await checked('git',['init',dir]); await checked('git',['-c','user.name=Test','-c','user.email=t@e.invalid','-c','commit.gpgsign=false','config','user.name','Test'],{cwd:dir}); await checked('git',['-c','user.name=Test','-c','user.email=t@e.invalid','-c','commit.gpgsign=false','config','user.email','t@e.invalid'],{cwd:dir});
  writeFileSync(join(dir,'app.txt'),'original\n'); await checked('git',['add','app.txt'],{cwd:dir});
  await checked('git',['-c','user.name=Test','-c','user.email=t@e.invalid','-c','commit.gpgsign=false','commit','-m','base'],{cwd:dir});
  const {landJob}=await import('../src/jobs.js');
  const j=newJob(db,{runtime:'codex',repository:dir,owner:'test',request:'Change app',acceptance:'Checks pass'});
  const reviewed=await runJob(db,j.id,{repositories:[dir],timeoutSeconds:5},{executor:async(job)=>{writeFileSync(join(job.worktree,'app.txt'),'candidate\n');return 'Verified candidate';}});
  assert.equal(reviewed.state,'needs_review');
  const landed=await landJob(db,j.id,'Shubham');
  assert.equal(landed.state,'resolved'); assert.equal(landed.reviewer,'Shubham');
  assert.equal(readFileSync(join(dir,'app.txt'),'utf8'),'candidate\n');
  assert.deepEqual(landed.landedFiles,['app.txt']);
  const log=await checked('git',['log','--oneline','-2'],{cwd:dir});
  assert.match(log,/land /); assert.match(log,/accepted by Shubham/);
});

test('acceptEvents matches authorized accept replies to open jobs only', async t => {
  const dir=mkdtempSync(join(tmpdir(),'intuitxn-acc-')); const previous=process.env.INTUITXN_HOME; process.env.INTUITXN_HOME=join(dir,'state');
  const db=store(); t.after(()=>{ db.close(); if(previous) process.env.INTUITXN_HOME=previous;else delete process.env.INTUITXN_HOME;rmSync(dir,{recursive:true,force:true}); });
  const {acceptEvents}=await import('../src/buzz.js');
  const j=newJob(db,{runtime:'codex',repository:dir,owner:'owner1',request:'Do work',acceptance:'Pass'});
  const open=put(db,'jobs',{...j,state:'needs_review',channel:'ch1',sourceEvent:'root1',threadRoot:'root1'});
  const cfg={authorizedPubkeys:['owner1'],reviewerNames:{owner1:'Shubham'}};
  const events=[
    {id:'e1',pubkey:'owner1',content:'accept',tags:[['e','root1','','reply'],['e','root1','','root']]},
    {id:'e2',pubkey:'owner1',content:'Accept the change',tags:[['e','root1','','reply'],['e','root1','','root']]},
    {id:'e3',pubkey:'stranger',content:'accept',tags:[['e','root1','','reply'],['e','root1','','root']]},
    {id:'e4',pubkey:'owner1',content:'discuss this',tags:[['e','root1','','reply'],['e','root1','','root']]},
  ];
  const found=acceptEvents(db,cfg,events);
  assert.equal(found.length,2);
  assert.equal(found[0].jobId,open.id); assert.equal(found[0].reviewer,'Shubham');
});
