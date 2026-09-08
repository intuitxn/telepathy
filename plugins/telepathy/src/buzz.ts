/**
 * buzz.ts — thin wrapper over the Buzz CLI.
 *
 * The plugin is a real opencode plugin, not a parallel harness. State lives in
 * Buzz (channels/threads/canvas), Agent Manager (sessions/tasks/reservations),
 * and git (accepted revisions). This module only shells out to `buzz` and
 * normalizes its JSON-in/JSON-out contract.
 *
 * Exit codes (Buzz CLI): 0 ok · 1 input/not-found · 2 relay/network · 3 auth ·
 * 4 other · 5 write conflict.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BuzzErrorCategory =
  | "input"
  | "network"
  | "auth"
  | "conflict"
  | "other";

export type BuzzResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Parsed stdout JSON when the command succeeded and returned JSON. */
  json?: unknown;
  error?: string;
  category?: BuzzErrorCategory;
};

const BUZZ_BIN = process.env.BUZZ_BIN ?? "buzz";
const DEFAULT_RELAY = "http://localhost:3000";

// Auto-load the plugin's .env (BUZZ_PRIVATE_KEY / BUZZ_RELAY_URL) so the
// harness works without the operator exporting them before launching opencode.
const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

function loadEnvFile(): void {
  if (process.env.__TELEPATHY_ENV_LOADED) return;
  process.env.__TELEPATHY_ENV_LOADED = "1";
  try {
    if (!existsSync(ENV_PATH)) return;
    const raw = readFileSync(ENV_PATH, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rawValue = m[2];
      if (key === undefined || rawValue === undefined) continue;
      let value = rawValue.trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env is optional; process env wins when present.
  }
}
loadEnvFile();

function categoryFromExit(code: number): BuzzErrorCategory {
  switch (code) {
    case 1:
      return "input";
    case 2:
      return "network";
    case 3:
      return "auth";
    case 5:
      return "conflict";
    default:
      return "other";
  }
}

/** Whether the CLI can authenticate. Never echoes the secret. */
export function buzzConfigured(): {
  configured: boolean;
  missing: string[];
  relay: string;
} {
  const missing: string[] = [];
  if (!process.env.BUZZ_PRIVATE_KEY) missing.push("BUZZ_PRIVATE_KEY");
  return {
    configured: missing.length === 0,
    missing,
    relay: process.env.INTUITXN_NETWORK || process.env.BUZZ_RELAY_URL || DEFAULT_RELAY,
  };
}

export function buzzConfigHint(): string {
  const cfg = buzzConfigured();
  if (cfg.configured) return "";
  return (
    `Buzz is not configured (relay ${cfg.relay}). Missing: ${cfg.missing.join(", ")}. ` +
    `Set BUZZ_PRIVATE_KEY (hex or nsec) and optionally INTUITXN_NETWORK, then retry. ` +
    `Buzz Desktop reports the workspace relay; see the Buzz CLI skill for details.`
  );
}

/**
 * Run `buzz <args>` and normalize the result. Pass `stdin` for long bodies
 * (`--content -`) so shell parsing cannot alter the content.
 */
export function runBuzz(
  args: string[],
  opts: { stdin?: string } = {},
): Promise<BuzzResult> {
  const cfg = buzzConfigured();
  if (!cfg.configured) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: buzzConfigHint(),
      category: "auth",
    });
  }

  return new Promise((resolve) => {
    const child = spawn(BUZZ_BIN, args, {
      env: {
        ...process.env,
        BUZZ_RELAY_URL: process.env.INTUITXN_NETWORK || process.env.BUZZ_RELAY_URL || DEFAULT_RELAY,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        error: `Could not run '${BUZZ_BIN}': ${err.message}`,
        category: "network",
      });
    });

    child.on("close", (code) => {
      let json: unknown;
      try {
        if (stdout.trim()) json = JSON.parse(stdout);
      } catch {
        /* non-JSON output is fine for some commands */
      }

      const isWrite = ["send", "add"].includes(args[1] ?? "");
      if (code === 0 && isWrite && (!json || (json as { accepted?: boolean }).accepted !== true)) {
        resolve({ ok: false, exitCode: code, stdout, stderr, json, error: "Relay did not confirm delivery (accepted: true).", category: "other" });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, exitCode: code, stdout, stderr, json });
        return;
      }

      // Errors are JSON on stderr: {"error": category, "message": detail}
      let message = stderr.trim() || stdout.trim();
      let category = categoryFromExit(code ?? 4);
      try {
        const parsed = JSON.parse(stderr);
        if (parsed && typeof parsed === "object") {
          const e = parsed as { error?: string; message?: string };
          if (e.message) message = e.message;
          if (e.error) category = e.error as BuzzErrorCategory;
        }
      } catch {
        /* keep raw stderr */
      }

      resolve({
        ok: false,
        exitCode: code,
        stdout,
        stderr,
        json,
        error: message,
        category,
      });
    });

    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a channel argument to a channel UUID. Passes UUIDs through; looks up
 * names via `buzz channels list`.
 */
export async function resolveChannel(
  channel: string,
): Promise<{ ok: true; channelId: string } | { ok: false; error: string }> {
  if (UUID_RE.test(channel)) return { ok: true, channelId: channel };

  const list = await runBuzz(["channels", "list"]);
  if (!list.ok) {
    return { ok: false, error: list.error ?? list.stderr };
  }

  const channels = Array.isArray(list.json) ? (list.json as unknown[]) : [];
  const match = channels.find((c) => {
    const rec = c as { channel_id?: string; name?: string };
    return (
      rec.name === channel ||
      (typeof rec.channel_id === "string" && rec.channel_id === channel)
    );
  });

  if (!match) {
    return {
      ok: false,
      error: `Channel '${channel}' not found. Use telepathy_channels to list channels.`,
    };
  }

  const rec = match as { channel_id?: string; name?: string };
  if (typeof rec.channel_id !== "string" || !rec.channel_id) {
    return { ok: false, error: `Channel '${channel}' has no channel_id.` };
  }
  return { ok: true, channelId: rec.channel_id };
}
