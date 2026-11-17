import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { approvalNeeded } from "./safety.js";
import { executeTool, TOOL_DEFS } from "./tools.js";

/**
 * Minimal MCP server over stdio (JSON-RPC 2.0, no dependencies).
 * Exposes the same tools as the CLI. Write tools are refused here unless
 * approvalMode is "auto" — there is no human in the loop to approve them,
 * so the safe default is to say no and point at the CLI.
 */
export async function runMcpServer(workspace: string): Promise<void> {
  const cfg = loadConfig(workspace);
  const audit = (entry: Record<string, unknown>): void => {
    try {
      const dir = join(workspace, ".incipient");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "audit.log"), `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // Best-effort.
    }
  };
  const ctx = { root: workspace, audit };
  const rl = createInterface({ input: process.stdin, terminal: false });
  const send = (payload: unknown): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      continue;
    }
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "incipient", version: "0.1.0" },
        },
      });
    } else if (msg.method === "ping") {
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOL_DEFS } });
    } else if (msg.method === "tools/call") {
      const name = msg.params?.name ?? "";
      const args = msg.params?.arguments ?? {};
      const decision = approvalNeeded(name, args, cfg.approvalMode);
      if (decision !== "allow") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [
              {
                type: "text",
                text: `refused: ${name} needs approval (mode: ${cfg.approvalMode}). Run it from the INCIPIENT CLI, or set approvalMode to "auto".`,
              },
            ],
            isError: true,
          },
        });
        continue;
      }
      const result = await executeTool(ctx, name, args);
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: result.output }], isError: !result.ok },
      });
    } else if (msg.method?.startsWith("notifications/")) {
      // No response for notifications.
    } else if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
    }
  }
}
