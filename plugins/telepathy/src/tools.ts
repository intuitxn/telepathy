/**
 * tools.ts — Telepathy tool surface.
 *
 * Each tool maps 1:1 to the human product (PRODUCT.md): Posts, Replies,
 * Acknowledgements, Resolutions — plus the hidden artifact/review gate.
 *
 * Boundary rule: write tools DRAFT by default. The agent composes content for a
 * human to review; it sends only when `draft: false` is passed and the human
 * asked. Humans remain the visible authors; agent traffic stays underneath.
 */

import { z } from "zod";
import { tool } from "./tool.js";
import { runBuzz, resolveChannel } from "./buzz.js";



const POST_TYPES = ["update", "decision", "question", "announcement"] as const;
const HEADINGS: Record<(typeof POST_TYPES)[number], string> = {
  update: "Update",
  decision: "Decision",
  question: "Question",
  announcement: "Announcement",
};

function draftNote(): string {
  return "\n\n---\n_draft — not sent. Review and resend with draft: false to publish._";
}

function composePost(
  type: (typeof POST_TYPES)[number],
  title: string,
  body: string,
  mentions: string[] = [],
): string {
  const mentionLine =
    mentions.length > 0 ? `\n\nMentions: ${mentions.map((m) => `@${m}`).join(" ")}` : "";
  return `## ${HEADINGS[type]}: ${title}\n\n${body}${mentionLine}`;
}

/** Pubkeys are passed via `--mention` for reliable notify; names stay as @Name text. */
function isPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value) || value.startsWith("npub1");
}

/** Expand mention values into repeatable `--mention` flags for pubkeys. */
function mentionFlags(mentions: string[]): string[] {
  const flags: string[] = [];
  for (const m of mentions) {
    if (isPubkey(m)) flags.push("--mention", m);
  }
  return flags;
}

export const telepathyChannels = tool({
  description:
    "List Buzz channels this identity can see, so you can pick the right channel for a Telepathy post or reply.",
  args: {},
  async execute() {
    const r = await runBuzz(["channels", "list"]);
    if (!r.ok) {
      return { title: "telepathy_channels", output: r.error ?? r.stderr, metadata: { ok: false } };
    }
    return {
      title: "Buzz channels",
      output: JSON.stringify(r.json, null, 2),
      metadata: { ok: true },
    };
  },
});

export const telepathyPost = tool({
  description:
    "Compose a human-visible Telepathy post (update, decision, question, or announcement) to a Buzz channel. Drafts by default so a human can review before it is published; pass draft:false to send. A post answers: what changed, why it matters, what you need.",
  args: {
    channel: z.string().describe("Buzz channel UUID or name (see telepathy_channels)"),
    type: z.enum(POST_TYPES).describe("Post kind"),
    title: z.string().describe("Short title"),
    body: z.string().describe("Markdown body: what changed, why it matters, what you need"),
    mention: z
      .array(z.string())
      .optional()
      .describe("Pubkeys or member names to notify (only people who need to act)"),
    draft: z.boolean().optional().describe("Default true: return the draft for review. false sends it."),
  },
  async execute(args) {
    const resolved = args.draft !== false
      ? { ok: true as const, channelId: args.channel }
      : await resolveChannel(args.channel);
    if (!resolved.ok) return { title: "telepathy_post", output: resolved.error, metadata: { ok: false } };

    const content = composePost(args.type, args.title, args.body, args.mention ?? []);

    if (args.draft !== false) {
      return {
        title: `Draft ${HEADINGS[args.type]}`,
        output: `${content}${draftNote()}`,
        metadata: { ok: true, draft: true, channel: resolved.channelId, type: args.type },
      };
    }

    const sent = await runBuzz(
      ["messages", "send", "--channel", resolved.channelId, ...mentionFlags(args.mention ?? []), "--content", "-"],
      { stdin: content },
    );
    if (!sent.ok) {
      return { title: "telepathy_post", output: sent.error ?? sent.stderr, metadata: { ok: false } };
    }
    return {
      title: `Posted ${HEADINGS[args.type]}`,
      output: `Posted to ${resolved.channelId}\n\n${content}`,
      metadata: { ok: true, draft: false, event: sent.json },
    };
  },
});

export const telepathyReply = tool({
  description:
    "Reply to a post or thread in a Buzz channel. Drafts by default; pass draft:false to send. Use for focused human discussion that adds information, disagrees, or asks for clarification.",
  args: {
    channel: z.string().describe("Buzz channel UUID or name"),
    to: z.string().describe("Event ID of the post/thread to reply to"),
    body: z.string().describe("Markdown reply body"),
    draft: z.boolean().optional().describe("Default true: return the draft. false sends it."),
  },
  async execute(args) {
    const resolved = args.draft !== false
      ? { ok: true as const, channelId: args.channel }
      : await resolveChannel(args.channel);
    if (!resolved.ok) return { title: "telepathy_reply", output: resolved.error, metadata: { ok: false } };

    if (args.draft !== false) {
      return {
        title: "Draft reply",
        output: `${args.body}${draftNote()}`,
        metadata: { ok: true, draft: true, channel: resolved.channelId, replyTo: args.to },
      };
    }

    const sent = await runBuzz(
      ["messages", "send", "--channel", resolved.channelId, "--reply-to", args.to, "--content", "-"],
      { stdin: args.body },
    );
    if (!sent.ok) return { title: "telepathy_reply", output: sent.error ?? sent.stderr, metadata: { ok: false } };
    return {
      title: "Replied",
      output: `Replied to ${args.to}\n\n${args.body}`,
      metadata: { ok: true, event: sent.json },
    };
  },
});

export const telepathyAcknowledge = tool({
  description:
    "Acknowledge a post with an emoji reaction so the author knows the context landed, without adding feed noise. Use instead of a reply when no answer is required.",
  args: {
    event: z.string().describe("Event ID of the post to acknowledge"),
    draft: z.boolean().optional(),
    emoji: z.string().optional().describe("Emoji to react with (default ✅)"),
  },
  async execute(args) {
    const emoji = args.emoji ?? "✅";
    if (args.draft !== false) return { title: "Draft acknowledgement", output: `React ${emoji} to ${args.event}`, metadata: { ok: true, draft: true } };
    const r = await runBuzz(["reactions", "add", "--event", args.event, "--emoji", emoji]);
    if (!r.ok) {
      return { title: "telepathy_acknowledge", output: r.error ?? r.stderr, metadata: { ok: false } };
    }
    return {
      title: `Acknowledged ${emoji}`,
      output: `Reacted ${emoji} to ${args.event}`,
      metadata: { ok: true, event: r.json },
    };
  },
});

export const telepathyResolve = tool({
  description:
    "Close a question or ask with a written outcome. Drafts by default; pass draft:false to send. Do not infer completion from an agent stopping — only resolve with an accepted outcome.",
  args: {
    channel: z.string().describe("Buzz channel UUID or name"),
    to: z.string().describe("Event ID of the post/thread being resolved"),
    outcome: z.enum(["completed", "no_change"]).describe("Resolution outcome"),
    summary: z.string().describe("The written outcome: what was accepted, or why no change was required"),
    owner: z.string().optional().describe("Accountable human owner"),
    draft: z.boolean().optional().describe("Default true: return the draft. false sends it."),
  },
  async execute(args) {
    const resolved = args.draft !== false
      ? { ok: true as const, channelId: args.channel }
      : await resolveChannel(args.channel);
    if (!resolved.ok) return { title: "telepathy_resolve", output: resolved.error, metadata: { ok: false } };

    const outcome = args.outcome === "completed" ? "Resolved — completed" : "Resolved — no change";
    const ownerLine = args.owner ? `\n\nOwner: ${args.owner}` : "";
    const content = `**${outcome}**\n\n${args.summary}${ownerLine}`;

    if (args.draft !== false) {
      return {
        title: "Draft resolution",
        output: `${content}${draftNote()}`,
        metadata: { ok: true, draft: true, channel: resolved.channelId, replyTo: args.to },
      };
    }

    const sent = await runBuzz(
      ["messages", "send", "--channel", resolved.channelId, "--reply-to", args.to, "--content", "-"],
      { stdin: content },
    );
    if (!sent.ok) return { title: "telepathy_resolve", output: sent.error ?? sent.stderr, metadata: { ok: false } };
    return {
      title: "Resolved",
      output: `Resolved ${args.to}\n\n${content}`,
      metadata: { ok: true, event: sent.json },
    };
  },
});

export const telepathyArtifact = tool({
  description:
    "Draft a review request for a candidate artifact. The accepted revision is a git commit, so pass the exact SHA. Drafts by default; a named human accepts the exact revision before anything is treated as done.",
  args: {
    channel: z.string().describe("Buzz channel UUID or name"),
    title: z.string().describe("Artifact title"),
    revision: z.string().describe("Exact git SHA of the candidate revision"),
    summary: z.string().describe("What this artifact is and how it was verified"),
    url: z.string().optional().describe("Link to the artifact or build output"),
    draft: z.boolean().optional().describe("Default true: return the draft. false sends it."),
  },
  async execute(args) {
    const resolved = args.draft !== false
      ? { ok: true as const, channelId: args.channel }
      : await resolveChannel(args.channel);
    if (!resolved.ok) return { title: "telepathy_artifact", output: resolved.error, metadata: { ok: false } };

    const urlLine = args.url ? `\n\nLink: ${args.url}` : "";
    const content = `## Candidate artifact: ${args.title}\n\nRevision: \`${args.revision}\`\n\n${args.summary}${urlLine}\n\nNeeds review — acceptance is a human confirming this exact revision.`;

    if (args.draft !== false) {
      return {
        title: "Draft artifact review",
        output: `${content}${draftNote()}`,
        metadata: { ok: true, draft: true, channel: resolved.channelId, revision: args.revision },
      };
    }

    const sent = await runBuzz(
      ["messages", "send", "--channel", resolved.channelId, "--content", "-"],
      { stdin: content },
    );
    if (!sent.ok) return { title: "telepathy_artifact", output: sent.error ?? sent.stderr, metadata: { ok: false } };
    return {
      title: "Artifact review requested",
      output: `Posted review request to ${resolved.channelId}\n\n${content}`,
      metadata: { ok: true, event: sent.json },
    };
  },
});
