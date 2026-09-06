import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { store, createArtifact, approveArtifact, exportArtifact, get, newJob } from '../src/core.js';
import { queueMessage, sendMessage, ingest } from '../src/buzz.js';
import { claim } from '../src/jobs.js';
function fixture(t) { const dir = mkdtempSync(join(tmpdir(),'intuitxn-')); const db=store(dir); t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});}); return {dir,db}; }
test('only an unchanged reviewed artifact exports, without internal review metadata in its body', t => {
  const {dir,db}=fixture(t); const a=createArtifact(db,'report','Example',dir);
  assert.throws(()=>approveArtifact(db,a.id,'Reviewer',dir),/placeholders/);
  writeFileSync(a.file,'# Example\n\nA supported finding.\n');
  approveArtifact(db,a.id,'Reviewer',dir); const result=exportArtifact(db,a.id,dir);
  assert.equal(result.published,false); assert.equal(readFileSync(result.file,'utf8'),'# Example\n\nA supported finding.\n');
  writeFileSync(a.file,'Changed'); assert.throws(()=>exportArtifact(db,a.id,dir),/changed/);
});
test('forum replies retain thread and kind; accepted delivery cannot repeat', async t => {
  const {db}=fixture(t); const draft=queueMessage(db,{channel:'team',replyTo:'root',text:'Ready'}); let calls=0;
  const send=async(args,text)=>{calls++; assert(args.includes('45003')); assert(args.includes('root')); assert.equal(text,'Ready'); return {accepted:true,event_id:'event'};};
  assert.equal(queueMessage(db,{channel:'team',replyTo:'root',text:'Ready'}).id,draft.id);
  await assert.rejects(sendMessage(db,draft.id,'wrong',send),/hash/);
  await sendMessage(db,draft.id,draft.digest,send);
  await assert.rejects(sendMessage(db,draft.id,draft.digest,send),/already sent/); assert.equal(calls,1);
});
test('ambiguous publication is persisted and never automatically resent',async t=>{
  const {db}=fixture(t); const draft=queueMessage(db,{channel:'team',text:'News'});
  await assert.rejects(sendMessage(db,draft.id,draft.digest,async()=>({accepted:false})),/confirm/);
  assert.equal(get(db,'outbox',draft.id).state,'uncertain');
  await assert.rejects(sendMessage(db,draft.id,draft.digest,async()=>{throw Error('must not run');}),/uncertain/);
});
test('intake requires an allowed sender and explicit request; jobs survive reopening and claim once',t=>{
  const {dir,db}=fixture(t); const cfg={authorizedPubkeys:['alice'],repositories:['/repo'],runtime:'codex'};
  const event={id:'a'.repeat(64),pubkey:'alice',content:'/intuitxn '+JSON.stringify({request:'Build a page',acceptance:'Checks pass'}),tags:[]};
  assert.equal(ingest(db,cfg,'channel',[{...event,pubkey:'stranger'}]).length,0);
  const [job]=ingest(db,cfg,'channel',[event]); assert.equal(ingest(db,cfg,'channel',[event])[0].id,job.id);
  const other=store(dir); assert.equal(get(other,'jobs',job.id).state,'queued'); claim(other,job.id);
  assert.throws(()=>claim(db,job.id),/already claimed/); other.close();
});
