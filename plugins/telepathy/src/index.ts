/**
 * index.ts — Telepathy harness as a real opencode plugin.
 *
 * Reference: Meta-Harness (Yoonho Lee et al.) — the harness is the runtime
 * surface around the agent: the tools it can call, the permissions that gate
 * them, and the context it runs in. That surface lives here, using opencode's
 * native plugin API.
 *
 * Truth lives in the hosts:
 *   - Buzz          → channels, threads, canvas (the human-visible surface)
 *   - Agent Manager → sessions, tasks, reservations (execution)
 *   - git           → accepted revisions (an "accepted artifact" is a merged commit)
 *
 * opencode-native features used here:
 *   - `tool`                  → the Telepathy tool surface (draft-first writes)
 *   - `permission.ask`        → human gate: publishing always requires approval
 *   - `shell.env`             → inject Buzz credentials into the agent's shell
 *   - `tool.execute.after`    → clean result titles in the UI
 *   - `experimental.chat.system.transform` → inject the operating rules
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  telepathyChannels,
  telepathyPost,
  telepathyReply,
  telepathyAcknowledge,
  telepathyResolve,
  telepathyArtifact,
} from "./tools.js";

const TELEPATHY_SYSTEM = [
  "Telepathy is Intuitxn's human context layer. Humans (Shubham, Om, Kush) are the visible authors and owners of every post, reply, acknowledgement, and resolution.",
  "You compose on their behalf, but write tools draft by default: present the composed content for review and only send when draft:false is set and the human asked.",
  "Every useful post answers: what changed, why it matters, and what you need from the team.",
  "Mention someone only when they need to act. Acknowledge important posts instead of replying when no answer is required. Resolve a question or ask only with a written outcome — never infer completion from an agent stopping.",
  "Never fabricate authorship, never expose agent transcripts, prompts, tool calls, or secrets, and never post anything a human did not ask for.",
].join(" ");

/** Write tools publish externally, so they always route through the human gate. */
const WRITE_TOOLS = new Set([
  "telepathy_post",
  "telepathy_reply",
  "telepathy_acknowledge",
  "telepathy_resolve",
  "telepathy_artifact",
]);

/** Buzz env vars to forward from the plugin process into the agent's shell. */
const BUZZ_ENV_KEYS = ["BUZZ_PRIVATE_KEY", "BUZZ_RELAY_URL", "BUZZ_AUTH_TAG", "BUZZ_BIN"] as const;

const TOOL_TITLES: Record<string, string> = {
  telepathy_channels: "Buzz channels",
  telepathy_post: "Telepathy post",
  telepathy_reply: "Telepathy reply",
  telepathy_acknowledge: "Telepathy acknowledgement",
  telepathy_resolve: "Telepathy resolution",
  telepathy_artifact: "Telepathy artifact",
};

const telepathyPlugin: Plugin = async (_input) => {
  return {
    tool: {
      telepathy_channels: telepathyChannels,
      telepathy_post: telepathyPost,
      telepathy_reply: telepathyReply,
      telepathy_acknowledge: telepathyAcknowledge,
      telepathy_resolve: telepathyResolve,
      telepathy_artifact: telepathyArtifact,
    },

    // Human gate: any external publish requires explicit approval.
    "permission.ask": async (input, output) => {
      const patterns = input.pattern
        ? Array.isArray(input.pattern)
          ? input.pattern
          : [input.pattern]
        : [];
      const isWrite = patterns.some(
        (p) => typeof p === "string" && WRITE_TOOLS.has(p),
      );
      if (isWrite) output.status = "ask";
    },

    // Forward Buzz credentials into the agent's shell so `buzz` works there too.
    "shell.env": async (_input, output) => {
      for (const key of BUZZ_ENV_KEYS) {
        const value = process.env[key];
        if (value) output.env[key] = value;
      }
    },

    // Clean titles on Telepathy tool results.
    "tool.execute.after": async (input, output) => {
      const title = TOOL_TITLES[input.tool];
      if (title && !output.title) output.title = title;
    },

    // Harness surface: inject the operating rules into the agent's system context.
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(TELEPATHY_SYSTEM);
    },
  };
};

export default telepathyPlugin;
