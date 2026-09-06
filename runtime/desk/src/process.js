import { spawn } from 'node:child_process';
export function execute(command, args, { cwd, input, env = process.env, timeout = 120000, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', pending = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000).unref(); finish(Error(`${command} timed out; inspect existing execution before retry`)); }, timeout);
    child.on('error', error => finish(error));
    child.stdout.on('data', chunk => {
      out += chunk; pending += chunk;
      while (pending.includes('\n')) { const i = pending.indexOf('\n'); onLine?.(pending.slice(0, i)); pending = pending.slice(i + 1); }
      if (out.length > 16 * 1024 * 1024) { child.kill(); finish(Error('Runtime output limit reached')); }
    });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-65536); });
    child.on('close', code => { if (pending) onLine?.(pending); finish(null, { code, stdout: out, stderr: err }); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export async function checked(command, args, options) {
  const r = await execute(command, args, options);
  if (r.code !== 0) throw Error(`${command} exited ${r.code}: ${r.stderr.slice(-1500)}`);
  return r.stdout.trim();
}
