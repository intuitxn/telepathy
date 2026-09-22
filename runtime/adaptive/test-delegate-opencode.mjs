import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {options,delegate} from './delegate-opencode.mjs';

test('reject remote endpoints, URL credentials, invalid deadlines',()=>{
 for(const url of ['http://example.com','http://user:secret@127.0.0.1:4096','http://127.0.0.1/path'])assert.throws(()=>options(['--server',url,'--directory','.','--prompt','p','--output','o']));
 assert.throws(()=>options(['--directory','.','--prompt','p','--output','o','--timeout','120001']));
 assert.throws(()=>options(['--directory','.','--prompt','p','--output','o','--tools','all']));
});

async function fixture(t,completed,toolCalls=true){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opencode-adapter-'));
 const prompt=path.join(dir,'prompt');await fs.writeFile(prompt,'Task fixture');
 let aborted=false;let request;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;
  const route=new URL(req.url,'http://localhost').pathname;let data;
  if(route==='/session')data={id:'ses_fixture'};
  else if(route==='/experimental/tool/ids')data=['bash','read','task','write'];
  else if(route.endsWith('/prompt_async')){request=JSON.parse(raw);data=null;}
  else if(route.endsWith('/abort')){aborted=true;data=true;}
  else if(route.endsWith('/message'))data=completed?[{info:{role:'assistant',time:{completed:Date.now()},finish:'stop',modelID:'existing',providerID:'configured',tokens:{input:7,output:2,reasoning:3,cache:{read:4}},cost:0.01},parts:[...(toolCalls?[{type:'tool',tool:'bash',state:{status:'completed'}}]:[]),{type:'text',text:'answer'}]}]:[];
  else {res.statusCode=404;data={};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return {opts:{server:'http://127.0.0.1:'+server.address().port,directory:dir,prompt,output:path.join(dir,'out'),timeout:completed?2000:120},aborted:()=>aborted,request:()=>request};
}

test('fresh delegation preserves model default and captures metrics privately',async t=>{
 const f=await fixture(t,true);const r=await delegate(f.opts);
 assert.equal(r.status,'completed');assert.equal(r.toolCalls,1);assert.equal(r.tokens.input,7);assert.equal(r.tokens.reasoning,3);
 assert.deepEqual(f.request().tools,{bash:true,read:false,task:false,write:false});assert.equal(f.request().model,undefined);assert.equal(f.request().agent,undefined);
 assert.equal((await fs.stat(f.opts.output)).mode&0o777,0o700);assert.equal((await fs.stat(path.join(f.opts.output,'messages.json'))).mode&0o777,0o600);
 await assert.rejects(()=>delegate(f.opts),{code:'EEXIST'});
});

test('tool-free mode disables every discovered tool and preserves violations',async t=>{
 const f=await fixture(t,true,false);const r=await delegate({...f.opts,tools:'none'});
 assert.equal(r.toolPolicy,'none');assert.equal(r.toolCalls,0);
 assert.deepEqual(f.request().tools,{bash:false,read:false,task:false,write:false});
 const bad=await fixture(t,true,true);
 await assert.rejects(()=>delegate({...bad.opts,tools:'none'}),/Tool-free delegation policy violated/);
 assert.equal(bad.aborted(),true);
 const receipt=JSON.parse(await fs.readFile(path.join(bad.opts.output,'result.json'),'utf8'));
 assert.equal(receipt.status,'failed');assert.equal(receipt.toolCalls,1);assert.equal(receipt.toolPolicy,'none');
});

test('deadline aborts session and saves failure evidence',async t=>{
 const f=await fixture(t,false);await assert.rejects(()=>delegate(f.opts),/deadline/);assert.equal(f.aborted(),true);
 const result=JSON.parse(await fs.readFile(path.join(f.opts.output,'result.json'),'utf8'));assert.equal(result.status,'failed');assert.equal(result.abortRequested,true);
});
