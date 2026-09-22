#!/usr/bin/env node
// Transport adapter only: executable core logic remains in Bend.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function options(argv) {
  const out={server:'http://127.0.0.1:4096',timeout:120000};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i]?.replace(/^--/,'');
    if(!['server','directory','prompt','output','timeout'].includes(key)||!argv[i+1])throw Error('Expected --server URL --directory DIR --prompt FILE --output NEW_PRIVATE_DIR [--timeout MS]');
    out[key]=argv[i+1];
  }
  const u=new URL(out.server);
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Server must be an IP-literal loopback URL without credentials or path');
  for(const k of ['directory','prompt','output']){if(!out[k])throw Error('Missing --'+k);out[k]=path.resolve(out[k]);}
  out.timeout=Number(out.timeout);
  if(!Number.isInteger(out.timeout)||out.timeout<100||out.timeout>120000)throw Error('Timeout must be 100..120000 ms');
  out.server=u.origin;
  return out;
}

export function summarize(messages,started) {
  const assistants=messages.filter(x=>x.info?.role==='assistant');
  const last=assistants.at(-1)?.info;
  const tokens={input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0};
  let cost=0;const calls=[];const text=[];
  for(const m of assistants){const t=m.info.tokens??{};
    for(const k of ['input','output','reasoning'])tokens[k]+=t[k]??0;
    tokens.cacheRead+=t.cache?.read??0;tokens.cacheWrite+=t.cache?.write??0;cost+=m.info.cost??0;
    for(const p of m.parts??[]){if(p.type==='tool')calls.push({tool:p.tool,status:p.state?.status});if(p.type==='text')text.push(p.text);}
  }
  return {finished:Boolean(last?.time?.completed&&last.finish!=='tool-calls'),model:last?.modelID,provider:last?.providerID,finish:last?.finish,error:last?.error,tokens,cost,toolCalls:calls.length,calls,elapsedMs:Date.now()-started,text:text.join('\n')};
}

export async function delegate(opts) {
  const prompt=await fs.readFile(opts.prompt,'utf8');
  // Refuse existing output so concurrent callers cannot overwrite evidence.
  await fs.mkdir(opts.output,{mode:0o700});
  const save=(name,value)=>fs.writeFile(path.join(opts.output,name),typeof value==='string'?value:JSON.stringify(value,null,2),{mode:0o600});
  const started=Date.now();let session;let messages=[];let summary;
  const deadline=started+opts.timeout;
  async function api(endpoint,body,abort=false){
    const remaining=abort?5000:Math.max(1,deadline-Date.now());
    const r=await fetch(opts.server+endpoint+'?directory='+encodeURIComponent(opts.directory),{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(remaining,10000)),redirect:'error'});
    if(!r.ok)throw Error('OpenCode HTTP '+r.status+' at '+endpoint.replace(/ses_[^/]+/g,'SESSION'));
    const text=await r.text();return text?JSON.parse(text):null;
  }
  try {
    await save('prompt.txt',prompt);
    session=await api('/session',{title:'Shared-learning delegated task'});
    await save('session.json',{id:session.id,directory:opts.directory,started});
    const names=await api('/experimental/tool/ids');
    const tools=Object.fromEntries(names.map(n=>[n,n==='bash']));
    // Omit model and agent: use the server's existing default configuration.
    await api('/session/'+session.id+'/prompt_async',{tools,parts:[{type:'text',text:prompt}]});
    while(Date.now()<deadline){
      messages=await api('/session/'+session.id+'/message');
      summary=summarize(messages,started);
      if(summary.error)throw Error('OpenCode agent failed (details retained privately)');
      if(summary.finished){await save('messages.json',messages);await save('answer.txt',summary.text);await save('result.json',{...summary,session:session.id,status:'completed'});return {...summary,session:session.id,status:'completed'};}
      await new Promise(r=>setTimeout(r,Math.min(500,Math.max(0,deadline-Date.now()))));
    }
    throw Error('OpenCode task deadline exceeded');
  } catch(error) {
    let aborted=false;
    if(session?.id){try{await api('/session/'+session.id+'/abort',{},true);aborted=true;}catch{}}
    const result={...summarize(messages,started),session:session?.id,status:'failed',message:error.message,abortRequested:aborted};
    await save('messages.json',messages);await save('result.json',result);
    throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {const result=await delegate(options(process.argv.slice(2)));const {text,error,...metrics}=result;console.log(JSON.stringify(metrics));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
