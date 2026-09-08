import { execute } from './process.js';
import { get, put, list, hash, now, newJob } from './core.js';
export async function buzz(args, input) {
  if (!process.env.BUZZ_PRIVATE_KEY) throw Error('Buzz is not connected. Launch from the managed Buzz runtime, or configure the service identity in its environment.');
  const result = await execute(process.env.BUZZ_BIN || 'buzz', args, { input, timeout: 30000, env: { ...process.env, BUZZ_RELAY_URL: process.env.INTUITXN_NETWORK || process.env.BUZZ_RELAY_URL || 'https://intuitxn.communities.buzz.xyz' } });
  if (result.code !== 0) throw Error(`Buzz exited ${result.code}; check relay connectivity and identity membership`);
  try { return JSON.parse(result.stdout); } catch { throw Error('Buzz returned invalid JSON'); }
}
export function queueMessage(db, { channel, text, replyTo, forum = true, mentions = [] }) {
  if (!channel?.trim() || !text?.trim()) throw Error('Channel and content are required');
  if (Buffer.byteLength(text) > 65536) throw Error('Buzz content exceeds 64 KB');
  const digest = hash(JSON.stringify({ channel, text, replyTo, forum, mentions }));
  const existing = db.prepare('SELECT id,data,state FROM outbox WHERE id=?').get(digest);
  if (existing) return get(db, 'outbox', digest);
  return put(db, 'outbox', { id: digest, digest, channel, text, replyTo, forum, mentions, state: 'draft', created: now() });
}
export async function sendMessage(db, id, digest, transport = buzz) {
  const message = get(db, 'outbox', id);
  if (digest !== message.digest) throw Error('Review the exact destination and content hash before sending');
  const claim = db.prepare("UPDATE outbox SET state='sending' WHERE id=? AND state='draft'").run(id);
  if (claim.changes !== 1) throw Error('Message already sent or delivery is uncertain; reconcile before retrying');
  try {
    const args = ['messages','send','--channel',message.channel,'--kind',message.forum ? (message.replyTo ? '45003' : '45001') : '9','--content','-'];
    if (message.replyTo) args.push('--reply-to', message.replyTo);
    for (const pubkey of message.mentions) args.push('--mention', pubkey);
    const receipt = await transport(args, message.text);
    if (receipt?.accepted !== true || !receipt.event_id) throw Error('Relay did not confirm accepted delivery');
    return put(db, 'outbox', { ...message, state: 'sent', receipt, sentAt: now() });
  } catch (error) {
    put(db, 'outbox', { ...message, state: 'uncertain', error: String(error.message) });
    throw error;
  }
}
export function ingest(db, cfg, channel, events) {
  const jobs = [];
  for (const event of events) {
    if (!cfg.authorizedPubkeys.includes(event.pubkey) || !event.content?.startsWith('/intuitxn ')) continue;
    if (!/^[a-f0-9]{64}$/i.test(event.id || '')) continue;
    let input;
    try { input = JSON.parse(event.content.slice('/intuitxn '.length)); } catch { continue; }
    if (!input.request || !input.acceptance) continue;
    const repository = cfg.repositories[input.repository ?? 0];
    if (!repository) continue;
    const root = event.tags?.find(t => t[0] === 'e' && t[3] === 'root')?.[1] || event.id;
    if (!['codex', 'opencode'].includes(input.runtime || cfg.runtime)) continue;
    jobs.push(newJob(db, { source: `${channel}:${event.id}`, channel, sourceEvent: event.id, threadRoot: root, requester: event.pubkey, owner: event.pubkey, repository, runtime: input.runtime || cfg.runtime, request: input.request, acceptance: input.acceptance }));
  }
  return jobs;
}
export async function poll(db, cfg, transport = buzz) {
  const imported = []; const allEvents = [];
  for (const channel of cfg.channels) {
    const stamp = db.prepare('SELECT stamp FROM cursors WHERE channel=?').get(channel)?.stamp ?? cfg.since;
    let events; let limit = 100;
    for (;;) {
      events = await transport(['messages','get','--channel',channel,'--since',String(Math.max(0, stamp - 1)),'--limit',String(limit)]);
      if (!Array.isArray(events)) throw Error('Unexpected Buzz message list');
      if (events.length < limit) break;
      if (limit >= 10000) throw Error('Buzz page saturated; cursor unchanged. Narrow the intake window before continuing.');
      limit *= 10;
    }
    // Re-read the overlap on every poll; the unique source constraint deduplicates it.
    imported.push(...ingest(db, cfg, channel, events));
    allEvents.push(...events);
    const stamps = events.map(e => e.created_at).filter(Number.isFinite);
    const latest = Math.max(stamp, ...stamps);
    db.prepare('INSERT INTO cursors VALUES (?,?) ON CONFLICT(channel) DO UPDATE SET stamp=excluded.stamp').run(channel, latest);
  }
  return { jobs: imported, events: allEvents };
}

export function acceptEvents(db, cfg, events) {
  const open = list(db, 'jobs').filter(j => j.state === 'needs_review');
  const found = [];
  for (const event of events) {
    if (!cfg.authorizedPubkeys.includes(event.pubkey)) continue;
    if (typeof event.content !== 'string') continue;
    if (!/^accept\b/i.test(event.content.trim())) continue;
    const root = event.tags?.find(t => t[0] === 'e' && (t[3] === 'root' || t[3] === 'reply'))?.[1];
    if (!root) continue;
    const job = open.find(j => j.threadRoot === root || j.sourceEvent === root);
    if (!job) continue;
    const reviewer = cfg.reviewerNames?.[event.pubkey] ?? event.pubkey.slice(0, 8);
    found.push({ jobId: job.id, reviewer, eventId: event.id, channel: job.channel });
  }
  return found;
}

export async function notify(db, { channel, replyTo, text }, transport = buzz) {
  const message = queueMessage(db, { channel, replyTo, forum: true, text });
  if (message.state === 'sent') return message;
  try { return await sendMessage(db, message.id, message.digest, transport); }
  catch { return message; } // stays draft; reconciled later
}
