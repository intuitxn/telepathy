import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../dist/index.js';
async function load() {
  const tools = new Map(); let gate;
  await plugin.setup({ permission: { hook: async (_, fn) => { gate = fn; } }, tool: { transform: async fn => fn({ add: tool => tools.set(tool.name, tool) }) } });
  return { tools, gate };
}
test('v2 tools draft offline even with a channel name and draft:false input', async () => {
  const { tools } = await load();
  assert.equal(tools.size, 11);
  const result = await tools.get('telepathy_post').execute({ channel: 'team', type: 'update', title: 'Test', body: 'A draft.', draft: false });
  assert.equal(result.metadata.draft, true);
  assert.match(result.content, /A draft/);
  const ack = await tools.get('telepathy_acknowledge').execute({ event: 'test' });
  assert.equal(ack.metadata.draft, true);
});
test('every send tool requires the publication action and the hook escalates allow', async () => {
  const { tools, gate } = await load();
  for (const [name, tool] of tools) if (name.endsWith('_send')) assert.equal(tool.options.permission, 'telepathy_publish');
  const e = { action: 'telepathy_publish', effect: 'allow' }; await gate(e); assert.equal(e.effect, 'ask');
});
