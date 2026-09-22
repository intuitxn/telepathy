import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url));
const hash=x=>createHash('sha256').update(x).digest('hex');
const fields=['core','contract','evaluator','source'];
const request={core:'memory',contract:'v2',evaluator:'e3',source:'abc',limit:3};
const rec=(id,deps=[],seq=1,extra={})=>({id,deps,seq,state:'verified',core:'memory',contract:'v2',evaluator:'e3',source:'abc',...extra});
const prompt=`Write only a JavaScript function declaration named selectEvidence(records, request, revoked). No imports, tools or external calls. Maximum 1000 words of output. This is a new coding task; no code execution or revisions are allowed.
Inputs are JSON values. request always has string core, contract, evaluator, source, and integer limit between 0 and 10. records and revoked are arrays. Return an array of selected record IDs; never mutate inputs.
A record is structurally valid iff it is a non-null non-array object, has a nonempty string id, an array deps of nonempty strings, a nonnegative safe integer seq, state exactly 'verified', and all four context fields (core, contract, evaluator, source) exactly equal the request fields. Extra properties are allowed. Duplicate dependency IDs are allowed.
An ID is ambiguous if two or more records in the ORIGINAL array have that same nonempty string id, even when one duplicate is structurally invalid. All ambiguous IDs are ineligible. Any ID included in revoked is ineligible (ignore non-string revoked entries).
A valid unambiguous unrevoked record is eligible only if every dependency ID exists and is eligible. Dependency cycles and every record depending directly or transitively on such a cycle are ineligible. Missing, malformed, mismatched or revoked dependencies make their dependents ineligible. Records without dependencies can be eligible.
Return the eligible IDs sorted by descending seq and then ascending JavaScript code-unit string order (not locale order), truncated to request.limit. Inputs may appear in any order. Eligibility must use ALL records, not just the top limit. Return [] when none qualify.`;
const memory=`Retained project findings from earlier verification work: bind evidence to the complete source/contract/evaluator context, since source identity alone is insufficient. A previously accepted record can later be revoked; retained dependents need to be reconsidered. Preserve failure evidence rather than assuming a saved 'passed' string is proof. These are engineering lessons, not test answers or an implementation.`;
function oracle(records,req,revoked){
 const counts=new Map(); for(const r of records)if(r&&typeof r.id==='string'&&r.id)counts.set(r.id,(counts.get(r.id)||0)+1);
 const candidates=records.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&typeof r.id==='string'&&r.id&&counts.get(r.id)===1&&Array.isArray(r.deps)&&r.deps.every(d=>typeof d==='string'&&d)&&Number.isSafeInteger(r.seq)&&r.seq>=0&&r.state==='verified'&&fields.every(f=>r[f]===req[f])&&!revoked.includes(r.id));
 const eligible=new Set(); let changed=true;while(changed){changed=false;for(const r of candidates)if(!eligible.has(r.id)&&r.deps.every(d=>eligible.has(d))){eligible.add(r.id);changed=true;}}
 return candidates.filter(r=>eligible.has(r.id)).sort((a,b)=>b.seq-a.seq||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,req.limit).map(r=>r.id);
}
function cases(){const out=[];const add=(name,records,revoked=[],req=request)=>out.push({name,records,request:req,revoked,expected:oracle(records,req,revoked)});
 add('empty',[]);add('sorting',[rec('z'),rec('A'),rec('a'),rec('new',[],9)]);add('forward-dependency',[rec('b',['a'],8),rec('a')]);add('transitive-revocation',[rec('a'),rec('b',['a']),rec('c',['b'])],['a']);add('missing',[rec('b',['missing'])]);add('self-cycle',[rec('a',['a'])]);add('cycle-dependents',[rec('a',['b']),rec('b',['a']),rec('c',['b']),rec('good')]);add('invalid-duplicate',[rec('a'),{id:'a'},rec('b',['a'])]);add('zero-limit',[rec('a')],[],{...request,limit:0});add('full-before-limit',[rec('root'),rec('best',['root'],99)],[],{...request,limit:1});add('repeated-dependency',[rec('a'),rec('b',['a','a'])]);
 for(const f of fields)add('mismatch-'+f,[rec('a',[],1,{[f]:'wrong'}),rec('b',['a'])]);
 add('malformed',[null,[],false,3,'a',{},rec('x',[],1,{seq:1.5}),rec('y',[],1,{deps:[null]}),rec('z',[],1,{state:'pending'}),rec('ok')]);
 let state=38903417;const rnd=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*n)};
 for(let i=0;i<120;i++){const records=[];for(let j=0;j<12;j++){const deps=Array.from({length:rnd(3)},()=>`r${rnd(14)}`);records.push(rec(`r${j}`,deps,rnd(10),rnd(7)===0?{source:'old'}:{}));}if(rnd(3)===0)records.push({id:`r${rnd(12)}`});const revoked=Array.from({length:rnd(3)},()=>`r${rnd(12)}`);add('generated-'+i,records,revoked,{...request,limit:rnd(11)});}
 return out;}
if(process.argv[2]==='freeze'){
 const protocol={schema:'single-paired-coding-pilot-v1',prompt,memory,limits:{tools:0,revisions:0,output_words:1000},assignment:'One fresh agent per arm, same inherited model; paired pilot, not randomized or replicated.',cases:cases()};
 await fs.writeFile(path.join(dir,'agent-transfer-protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
 console.log('frozen cases',protocol.cases.length,'sha256',hash(JSON.stringify(protocol)));
}else{
 const bytes=await fs.readFile(path.join(dir,'agent-transfer-protocol.json'));const protocol=JSON.parse(bytes);const results={};
 for(const arm of ['without_memory','with_memory']){const source=await fs.readFile(path.join(dir,`agent-transfer-${arm}.txt`),'utf8');const failures=[];let mutations=0;
 for(const c of protocol.cases){const inputs=JSON.stringify([c.records,c.request,c.revoked]);const context=vm.createContext({inputs});try{const result=vm.runInContext(`${source}\nconst args=JSON.parse(inputs); const before=JSON.stringify(args); const value=selectEvidence(...args); JSON.stringify({value,mutated:JSON.stringify(args)!==before});`,context,{timeout:1000});const parsed=JSON.parse(result);if(parsed.mutated)mutations++;assert.deepEqual(parsed.value,c.expected);assert.equal(parsed.mutated,false);}catch(e){failures.push({case:c.name,error:e.message});}}
 results[arm]={correct:protocol.cases.length-failures.length,total:protocol.cases.length,mutations,failures,answer_sha256:hash(source),output_words:source.trim().split(/\s+/).length};}
 const report={schema:protocol.schema,protocol_sha256:hash(bytes),evaluator_sha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),results,accuracy_difference:(results.with_memory.correct-results.without_memory.correct)/protocol.cases.length,conclusion:'One paired coding pilot; actual task correctness, no evidence of population-level learning. Both arms receive identical full specification; memory adds prior engineering findings only. No source edits or retries after test feedback.'};
 await fs.writeFile(path.join(dir,'agent-transfer-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
