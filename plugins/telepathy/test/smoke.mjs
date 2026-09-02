// smoke.mjs — load the built plugin and exercise the draft/gate paths offline.
import plugin from "../dist/index.js";

const hooks = await plugin({}, {});
const tools = hooks.tool ?? {};

const names = Object.keys(tools).sort();
console.log("tools:", names.join(", "));

const expected = [
  "telepathy_acknowledge",
  "telepathy_artifact",
  "telepathy_channels",
  "telepathy_post",
  "telepathy_reply",
  "telepathy_resolve",
];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) {
  console.error("FAIL: missing tools", missing);
  process.exit(1);
}

// 1) Draft path — UUID channel resolves locally, no network.
const uuid = "11111111-1111-4111-8111-111111111111";
const draft = await tools.telepathy_post.execute({
  channel: uuid,
  type: "decision",
  title: "Smoke test",
  body: "what changed / why / needed",
  mention: ["Om"],
});
if (!draft.metadata?.draft) {
  console.error("FAIL: expected draft, got", draft);
  process.exit(1);
}
console.log("✓ draft path:", draft.title, "| mentions in body:", draft.output.includes("@Om"));

// 2) Send path without Buzz creds → graceful guidance, no raw auth error.
const sent = await tools.telepathy_post.execute({
  channel: uuid,
  type: "update",
  title: "send test",
  body: "x",
  draft: false,
});
if (sent.metadata?.ok !== false || !String(sent.output).includes("BUZZ_PRIVATE_KEY")) {
  console.error("FAIL: expected graceful config guidance, got", sent);
  process.exit(1);
}
console.log("✓ send path fails gracefully without BUZZ_PRIVATE_KEY");

// 3) permission.ask gates all write tools to "ask".
for (const t of ["telepathy_post", "telepathy_reply", "telepathy_resolve", "telepathy_artifact", "telepathy_acknowledge"]) {
  const output = { status: "allow" };
  await hooks["permission.ask"]({ pattern: t, type: "tool", title: "x" }, output);
  if (output.status !== "ask") {
    console.error(`FAIL: ${t} not gated`, output);
    process.exit(1);
  }
}
console.log("✓ permission.ask gates all write tools to 'ask'");

// 4) shell.env forwards Buzz config.
const env = { env: {} };
await hooks["shell.env"]({}, env);
console.log("✓ shell.env hook present (forwarded keys:", Object.keys(env.env).length, ")");

console.log("\nAll smoke tests passed.");
