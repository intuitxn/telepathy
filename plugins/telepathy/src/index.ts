import { Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import * as definitions from "./tools.js";

const names: Record<string, string> = {
  telepathyChannels: "telepathy_channels", telepathyPost: "telepathy_post",
  telepathyReply: "telepathy_reply", telepathyAcknowledge: "telepathy_acknowledge",
  telepathyResolve: "telepathy_resolve", telepathyArtifact: "telepathy_artifact",
};

export default Plugin.define({
  id: "intuitxn.telepathy",
  async setup(ctx) {
    await ctx.permission.hook("evaluate", (event) => {
      if (event.action === "telepathy_publish") {
        event.effect = "ask";
        event.message = "Review this Buzz publication before sending.";
      }
    });
    await ctx.tool.transform((editor) => {
      for (const [key, definition] of Object.entries(definitions)) {
        const name = names[key];
        if (!name) continue;
        const isRead = key === "telepathyChannels";
        editor.add({
          name, description: isRead ? definition.description : `Draft only. ${definition.description}`,
          input: z.object(definition.args), options: { permission: isRead ? "telepathy_read" : "telepathy_draft" },
          execute: async (input) => {
            const result = await (definition.execute as (args: unknown) => Promise<{ output: string; metadata: Record<string, unknown> }>)({ ...input, draft: true });
            return { content: result.output, metadata: result.metadata };
          },
        });
        if (!isRead) editor.add({
          name: `${name}_send`, description: `Publish to Buzz after explicit human review. ${definition.description}`,
          input: z.object(definition.args), options: { permission: "telepathy_publish" },
          execute: async (input) => {
            const result = await (definition.execute as (args: unknown) => Promise<{ output: string; metadata: Record<string, unknown> }>)({ ...input, draft: false });
            return { content: result.output, metadata: result.metadata };
          },
        });
      }
    });
  },
});
