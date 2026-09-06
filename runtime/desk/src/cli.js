#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { home, ROOT, config, store, get, list, createArtifact, approveArtifact, exportArtifact, newJob } from './core.js';
import { queueMessage, sendMessage, poll, acceptEvents, notify, buzz } from './buzz.js';
import { runJob, acceptJob, landJob } from './jobs.js';
import { connect, cliPath, runtimeEnv } from './runtime.js';
import { checked } from './process.js';
const [command = 'help', ...args] = process.argv.slice(2);
const print = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const help = `intuitxn — discuss, build, write

npm run setup                          Prepare this machine (preserves settings)
npm run doctor                         Check installed tools and connections
npm run opencode                       Open the shared runtime
npm run desk -- new report "Title"      Create a report/announcement/blog/proposal/writing draft
npm run desk -- list                    List drafts and jobs
npm run desk -- review ID "Reviewer"    Record review of the exact artifact text
npm run desk -- export ID               Export reviewed Markdown and a receipt locally
npm run desk -- job request.json        Queue a job with owner, repository, runtime, request, acceptance
npm run desk -- run ID                  Execute one job in a separate worktree
npm run desk -- accept ID REVIEWER       Record human acceptance of a reviewed job
npm run desk -- show job ID             Inspect a job and its session/worktree
npm run desk -- poll                    Import explicit requests from configured Buzz channels
npm run desk -- watch                   Poll every 15s; imported jobs stay queued
npm run desk -- queue CHANNEL FILE      Prepare a forum post without sending
npm run desk -- queue-artifact CHANNEL ID  Prepare the reviewed artifact for Buzz
npm run desk -- reply CHANNEL EVENT FILE  Prepare a forum reply without sending
npm run desk -- show outbox ID          Review exact destination, content and digest
npm run desk -- send ID DIGEST          Send that reviewed message once
npm run desk -- stop                    Stop this workspace's OpenCode service

Settings: .local/config.json. State: .local/ (private, ignored by Git).
Public exports are files, not a deployment. No background job runs or messages are automatic.`;
async function main() {
  if (command === 'help') return print(help);
  if (command === 'opencode') {
    const child = spawn(cliPath(), args.length ? args : [ROOT], { cwd: ROOT, env: runtimeEnv(), stdio: 'inherit' });
    child.on('error', e => { console.error(e.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; }); return;
  }
  if (command === 'doctor') {
    const result = { settings: existsSync(join(home(), 'config.json')), buzzIdentity: Boolean(process.env.BUZZ_PRIVATE_KEY), buzzMembership: 'not checked' };
    for (const [name, cmd, flags] of [['node','node',['--version']],['codex','codex',['--version']],['opencode',cliPath(),['--version']],['buzz',process.env.BUZZ_BIN || 'buzz',['--help']]]) {
      try { const text = await checked(cmd, flags); result[name] = name === 'buzz' ? 'installed' : text; } catch { result[name] = 'missing'; }
    }
    if (result.buzzIdentity) { try { const channels = await buzz(['channels','list']); result.buzzMembership = Array.isArray(channels) ? `connected; ${channels.length} visible channels` : 'unexpected response'; } catch (e) { result.buzzMembership = e.message; } }
    if (result.settings) {
      const client = await connect(); await client.plugin.awaitActivation({ location: { directory: ROOT } });
      result.health = await client.health.get();
      result.agents = (await client.agent.list({ location: { directory: ROOT } })).data.map(a => a.id);
      result.plugins = (await client.plugin.list({ location: { directory: ROOT } })).data.filter(p => p.id.includes('telepathy')).map(p => ({ id: p.id, state: p.state }));
      if (!result.plugins.some(p => p.id === 'intuitxn.telepathy' && p.state.status === 'active')) process.exitCode = 1;
      result.modelsAvailable = (await client.model.list({ location: { directory: ROOT } })).data.length;
    }
    print(result); return;
  }
  if (command === 'stop') {
    Object.assign(process.env, runtimeEnv()); const { Service } = await import('@opencode-ai/client/service'); await Service.stop(); return print('Workspace OpenCode service stopped.');
  }
  const db = store();
  try {
    if (command === 'new') return print(createArtifact(db, args[0], args.slice(1).join(' ')));
    if (command === 'list') return print({ artifacts: list(db,'artifacts'), jobs: list(db,'jobs'), outbox: list(db,'outbox') });
    if (command === 'show') return print(get(db, { job:'jobs', artifact:'artifacts', outbox:'outbox' }[args[0]], args[1]));
    if (command === 'review') return print(approveArtifact(db, args[0], args.slice(1).join(' ')));
    if (command === 'export') return print(exportArtifact(db, args[0]));
    if (command === 'job') return print(newJob(db, JSON.parse(readFileSync(args[0], 'utf8'))));
    if (command === 'run') return print(await runJob(db, args[0], config()));
    if (command === 'accept') return print(acceptJob(db, args[0], args.slice(1).join(' ')));
    if (command === 'queue-artifact') {
      const exported = exportArtifact(db, args[1]);
      return print(queueMessage(db, { channel: args[0], text: readFileSync(exported.file, 'utf8') }));
    }
    if (command === 'queue') return print(queueMessage(db, { channel: args[0], text: readFileSync(args[1], 'utf8') }));
    if (command === 'reply') return print(queueMessage(db, { channel: args[0], replyTo: args[1], text: readFileSync(args[2], 'utf8') }));
    if (command === 'send') return print(await sendMessage(db, args[0], args[1]));
    if (command === 'poll' || command === 'watch') {
      const cfg = config();
      if (!cfg.channels.length || !cfg.authorizedPubkeys.length) throw Error('Add intake channels and authorized pubkeys to .local/config.json first.');
      do {
        const { jobs, events } = await poll(db, cfg);
        print(jobs);
        for (const job of jobs) {
          const owner = cfg.reviewerNames?.[job.owner] ?? job.owner.slice(0, 8);
          await notify(db, { channel: job.channel, replyTo: job.sourceEvent, text: `## Update: job queued\n\nJob \`${job.id}\`\nRequest: ${job.request.split('\n')[0].slice(0, 160)}\nOwner: ${owner}\nAcceptance: ${job.acceptance.slice(0, 200)}` });
          if (cfg.autoRun) {
            try {
              const result = await runJob(db, job.id, cfg);
              await notify(db, { channel: job.channel, replyTo: job.sourceEvent, text: `## Update: candidate ready\n\nJob \`${job.id}\`\nFiles: ${result.status || '(none)'}\nBase: ${result.base}\n\nReply \`accept\` in this thread to land it (copy the changes, commit, push origin and buzz).` });
            } catch (error) {
              await notify(db, { channel: job.channel, replyTo: job.sourceEvent, text: `## Update: needs attention\n\nJob \`${job.id}\` failed: ${String(error.message).slice(0, 300)}` });
            }
          }
        }
        for (const acc of acceptEvents(db, cfg, events)) {
          try {
            const landed = await landJob(db, acc.jobId, acc.reviewer);
            await notify(db, { channel: acc.channel, replyTo: acc.eventId, text: `## Resolution: landed\n\nJob \`${landed.id}\` accepted by ${landed.reviewer}\nCommit \`${landed.commit}\` pushed to ${landed.pushed.join(', ') || 'no remotes'}\nFiles: ${landed.landedFiles.join(', ')}` });
          } catch (error) {
            await notify(db, { channel: acc.channel, replyTo: acc.eventId, text: `## Resolution: could not land\n\nJob \`${acc.jobId}\`: ${String(error.message).slice(0, 300)}` });
          }
        }
        if (command === 'watch') await new Promise(resolve => setTimeout(resolve, Math.max(5, cfg.pollSeconds) * 1000));
      } while (command === 'watch');
      return;
    }
    throw Error('Unknown command. Run npm run desk -- help');
  } finally { db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
